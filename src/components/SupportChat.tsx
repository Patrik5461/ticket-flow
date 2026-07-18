import { useEffect, useRef, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { sendSupportMessageFn, supportEnabledFn } from '../server/support-chat'
import type { ChatMessage } from '../server/support-chat'

const GREETING: ChatMessage = {
  role: 'assistant',
  text: 'Ahoj! Som podporný asistent Ticketio. Pomôžem ti s objednávkou vstupeniek. Na overenie budem potrebovať tvoj e-mail a číslo objednávky (napr. ABCD1234).',
}

/** Public buyer support chat. Hidden in the dashboard/admin and when the AI key
 *  is not configured. The Anthropic key never reaches the client — messages go
 *  through the sendSupportMessageFn server proxy. */
export function SupportChat() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const hidden =
    pathname.startsWith('/app') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/register')

  useEffect(() => {
    if (hidden) return
    supportEnabledFn()
      .then((r) => setEnabled(r.enabled))
      .catch(() => setEnabled(false))
  }, [hidden])

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages, open])

  if (hidden || !enabled) return null

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    const next = [...messages, { role: 'user' as const, text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const res = await sendSupportMessageFn({ data: { messages: next } })
      setMessages([...next, { role: 'assistant', text: res.reply }])
    } catch {
      setMessages([
        ...next,
        {
          role: 'assistant',
          text: 'Nastala chyba. Skúste to prosím znova o chvíľu.',
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[90]">
      {open ? (
        <div className="flex h-[30rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
            <span className="font-display text-sm font-semibold text-ink-100">
              Podpora Ticketio
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-ink-400 hover:text-ink-100"
              aria-label="Zavrieť"
            >
              ✕
            </button>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === 'user' ? 'text-right' : 'text-left'}
              >
                <span
                  className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-accent text-white'
                      : 'bg-ink-800 text-ink-100'
                  }`}
                >
                  {m.text}
                </span>
              </div>
            ))}
            {busy && (
              <div className="text-left">
                <span className="inline-block rounded-2xl bg-ink-800 px-3 py-2 text-sm text-ink-400">
                  píše…
                </span>
              </div>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
            className="flex gap-2 border-t border-ink-800 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Napíšte správu…"
              className="flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              →
            </button>
          </form>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-2xl transition hover:opacity-90"
          aria-label="Podpora"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" />
          </svg>
        </button>
      )}
    </div>
  )
}
