/**
 * AI support assistant proxy. The Anthropic key stays server-side (this is a
 * createServerFn — its handler + the ANTHROPIC_API_KEY are stripped from the
 * client bundle). The model may only call the three Block-1 support tools, which
 * enforce all security on the server; the prompt is not a security boundary.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getEnv } from '../lib/env'
import { lookupOrderFn, resendTicketsFn, requestEmailChangeFn } from './support'
import {
  supportDailyLimit,
  getTodaySupportCalls,
  bumpSupportUsage,
} from './support-usage'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOOL_LOOPS = 6
const MAX_MESSAGES = 30

const FALLBACK =
  'Ospravedlňujem sa, asistent je momentálne nedostupný. Kontaktujte prosím organizátora podujatia.'

// Served when the daily API-call limit is exhausted — a static, no-cost FAQ so
// buyers still get help without calling the model.
const FAQ_FALLBACK = `Asistent je dnes vyťažený, tu je zopár rýchlych odpovedí:

• Neprišla vstupenka? Skontrolujte priečinok Spam/Hromadné. Vstupenky posielame na e-mail zadaný pri objednávke — vždy sa dajú znovu poslať naň.
• Zadali ste zlý e-mail? Napíšte organizátorovi podujatia, vie ho zmeniť a vstupenky preposlať.
• Kde a kedy je podujatie? Detaily nájdete na stránke podujatia aj priamo vo vstupenke (PDF).
• Refundácia alebo reklamácia? Tie rieši priamo organizátor podujatia.

Ďakujeme za trpezlivosť, skúste asistenta znova neskôr.`

const SYSTEM_PROMPT = `Si podporný asistent platformy Ticketio (predaj vstupeniek na podujatia). Pomáhaš KUPUJÚCIM s ich objednávkami. Odpovedáš po slovensky, stručne a priateľsky.

Typické situácie: „neprišla mi vstupenka", „zle som zadal e-mail", „kedy/kde je podujatie", „ako sa tam dostanem".

Pravidlá (dôležité):
- Na overenie objednávky potrebuješ E-MAIL aj ČÍSLO OBJEDNÁVKY (ref, napr. ABCD1234). Slušne si vyžiadaj oboje, kým ti ich používateľ výslovne nenapíše. Nikdy si údaje nevymýšľaj a nehádaj.
- Nástroje volaj IBA s údajmi, ktoré ti používateľ výslovne poskytol v konverzácii.
- lookupOrder: zistí stav objednávky a podujatia. resendTickets: znovu odošle vstupenky — idú VŽDY na pôvodný e-mail objednávky, nikdy na inú adresu. requestEmailChange: ak chce používateľ zmeniť e-mail, vytvor žiadosť pre organizátora (ty e-mail nemeníš, len požiadaš o zmenu).
- NIKDY nesľubuj refundy, nevracaj peniaze a nemeň obsah objednávky — na to nemáš právomoc.
- Nevymýšľaj si údaje o podujatí; použi lookupOrder.
- Čokoľvek mimo rozsahu (refundy, reklamácie, zmena obsahu objednávky, spory) slušne odkáž na kontaktovanie organizátora podujatia.`

const TOOLS = [
  {
    name: 'lookupOrder',
    description:
      'Zisti stav objednávky a podujatia. Vyžaduje e-mail aj číslo objednávky (ref).',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'E-mail kupujúceho.' },
        orderRef: {
          type: 'string',
          description: 'Číslo objednávky, napr. ABCD1234.',
        },
      },
      required: ['email', 'orderRef'],
    },
  },
  {
    name: 'resendTickets',
    description:
      'Znovu odošle vstupenky na PÔVODNÝ e-mail objednávky. Vyžaduje e-mail aj ref.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        orderRef: { type: 'string' },
      },
      required: ['email', 'orderRef'],
    },
  },
  {
    name: 'requestEmailChange',
    description:
      'Vytvorí žiadosť o zmenu e-mailu objednávky (schvaľuje organizátor). Nič neodosiela.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Pôvodný e-mail objednávky.' },
        orderRef: { type: 'string' },
        newEmail: { type: 'string', description: 'Nový požadovaný e-mail.' },
      },
      required: ['email', 'orderRef', 'newEmail'],
    },
  },
]

type ToolInput = { email?: string; orderRef?: string; newEmail?: string }

async function execTool(name: string, input: ToolInput): Promise<unknown> {
  try {
    const email = String(input.email ?? '')
    const orderRef = String(input.orderRef ?? '')
    if (name === 'lookupOrder') {
      return await lookupOrderFn({ data: { email, orderRef } })
    }
    if (name === 'resendTickets') {
      return await resendTicketsFn({ data: { email, orderRef } })
    }
    if (name === 'requestEmailChange') {
      return await requestEmailChangeFn({
        data: { email, orderRef, newEmail: String(input.newEmail ?? '') },
      })
    }
    return { error: 'unknown tool' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'tool failed' }
  }
}

interface AnthropicBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: ToolInput
}

function textOf(content: AnthropicBlock[]): string {
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
    .trim()
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

async function runSupportChat(
  clientMessages: ChatMessage[],
): Promise<{ reply: string }> {
  const key = getEnv().ANTHROPIC_API_KEY
  if (!key) return { reply: FALLBACK }

  // Daily cost guard: once the configured cap is reached, serve the static FAQ
  // instead of calling the model.
  const limit = supportDailyLimit()
  if (limit > 0 && (await getTodaySupportCalls()) >= limit) {
    await bumpSupportUsage(0, 0, 1)
    return { reply: FAQ_FALLBACK }
  }

  const messages: { role: string; content: unknown }[] = clientMessages
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.text }))

  let apiCalls = 0
  let toolCalls = 0
  let reply = FALLBACK
  try {
    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      let data: { stop_reason?: string; content?: AnthropicBlock[] }
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages,
          }),
          signal: AbortSignal.timeout(30_000),
        })
        apiCalls++
        if (!res.ok) break
        data = await res.json()
      } catch {
        break
      }

      const content = data.content ?? []
      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content })
        const results = []
        for (const b of content) {
          if (b.type === 'tool_use' && b.name && b.id) {
            toolCalls++
            const r = await execTool(b.name, b.input ?? {})
            results.push({
              type: 'tool_result',
              tool_use_id: b.id,
              content: JSON.stringify(r),
            })
          }
        }
        messages.push({ role: 'user', content: results })
        continue
      }
      reply = textOf(content) || FALLBACK
      break
    }
  } finally {
    await bumpSupportUsage(apiCalls, toolCalls, reply === FALLBACK ? 1 : 0)
  }
  return { reply }
}

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(4000),
      }),
    )
    .min(1)
    .max(MAX_MESSAGES),
})

export const sendSupportMessageFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => chatSchema.parse(d))
  .handler(async ({ data }): Promise<{ reply: string }> => {
    return runSupportChat(data.messages)
  })

export const supportEnabledFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ enabled: boolean }> => {
    return { enabled: Boolean(getEnv().ANTHROPIC_API_KEY) }
  },
)
