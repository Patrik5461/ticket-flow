import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/developers')({
  head: () => ({
    meta: [
      { title: 'API pre vývojárov — Ticketio' },
      {
        name: 'description',
        content:
          'Dokumentácia verejného REST API Ticketio: autentifikácia, endpointy, rate limit a webhooky s overením podpisu.',
      },
    ],
  }),
  component: DevelopersDocs,
})

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-ink-700 bg-ink-900 p-4 text-sm text-ink-200">
      <code>{children}</code>
    </pre>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 mb-3 font-display text-xl font-semibold text-ink-100">
      {children}
    </h2>
  )
}

const ENDPOINTS: [string, string][] = [
  ['GET', '/api/v1/me'],
  ['GET', '/api/v1/events'],
  ['GET', '/api/v1/events/{id}'],
  ['GET', '/api/v1/events/{id}/tickets'],
  ['GET', '/api/v1/orders'],
]

function DevelopersDocs() {
  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link
          to="/"
          className="text-sm text-ink-300 transition hover:text-ink-100"
        >
          ← Späť na hlavnú stránku
        </Link>
        <h1 className="mt-6 font-display text-3xl font-bold">
          API pre vývojárov
        </h1>
        <p className="mt-3 text-ink-300">
          Verejné REST API pre organizátorov. Strojovo čitateľná špecifikácia:{' '}
          <a href="/api/v1/openapi.json" className="text-accent underline">
            /api/v1/openapi.json
          </a>
          .
        </p>

        <H2>Autentifikácia</H2>
        <p className="text-ink-300">
          Vytvorte si API kľúč v sekcii{' '}
          <Link to="/app/developers" className="text-accent underline">
            portál → API
          </Link>{' '}
          a posielajte ho v hlavičke <code>Authorization</code>:
        </p>
        <Code>
          {`curl -H "Authorization: Bearer tik_live_..." \\
  https://ticketio.sk/api/v1/events`}
        </Code>
        <p className="text-sm text-ink-400">
          Limit je 120 požiadaviek za minútu na kľúč (hlavičky{' '}
          <code>X-RateLimit-*</code>). Sumy sú v centoch, mena EUR.
        </p>

        <H2>Endpointy</H2>
        <div className="overflow-x-auto rounded-lg border border-ink-700">
          <table className="w-full text-sm">
            <tbody>
              {ENDPOINTS.map(([m, p]) => (
                <tr key={p} className="border-b border-ink-800 last:border-0">
                  <td className="px-4 py-2 font-mono text-accent">{m}</td>
                  <td className="px-4 py-2 font-mono text-ink-200">{p}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-ink-400">
          Zoznamové endpointy podporujú <code>limit</code> (max 100),{' '}
          <code>offset</code>, <code>status</code>; <code>/orders</code> aj{' '}
          <code>event_id</code>.
        </p>

        <H2>Webhooky</H2>
        <p className="text-ink-300">
          Zaregistrujte endpoint v portáli a odoberajte udalosti{' '}
          <code>order.paid</code> a <code>ticket.checked_in</code>. Každá
          požiadavka je podpísaná hlavičkou <code>X-Ticketio-Signature</code> vo
          formáte <code>t=&lt;unix&gt;,v1=&lt;hex&gt;</code>, kde podpis je
          HMAC-SHA256 z <code>{'`${t}.${telo}`'}</code> s vaším tajným kľúčom.
        </p>
        <Code>
          {`// Node.js — overenie podpisu
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(rawBody, header, secret) {
  const [tPart, v1Part] = header.split(',')
  const t = tPart.slice(2)          // "t=" prefix
  const sig = v1Part.slice(3)       // "v1=" prefix
  const expected = createHmac('sha256', secret)
    .update(t + '.' + rawBody)
    .digest('hex')
  const a = Buffer.from(sig), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}`}
        </Code>
        <p className="text-sm text-ink-400">
          Doručenie sa opakuje pri chybe (do 6 pokusov). Telo obsahuje{' '}
          <code>{'{ id, type, created, data }'}</code>.
        </p>
      </div>
    </div>
  )
}
