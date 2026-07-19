import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  listApiKeysFn,
  createApiKeyFn,
  revokeApiKeyFn,
  listWebhooksFn,
  createWebhookFn,
  deleteWebhookFn,
  WEBHOOK_EVENTS,
} from '../server/dashboard'
import type { ApiKeySummary, WebhookSummary } from '../server/dashboard'

export const Route = createFileRoute('/app/developers')({
  loader: async (): Promise<{
    keys: ApiKeySummary[]
    webhooks: WebhookSummary[]
  }> => {
    const [keys, webhooks] = await Promise.all([
      listApiKeysFn(),
      listWebhooksFn(),
    ])
    return { keys, webhooks }
  },
  component: DevelopersPage,
})

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Bratislava',
  }).format(new Date(iso))
}

function DevelopersPage() {
  const { keys, webhooks } = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await createApiKeyFn({
        data: { name: name.trim() || 'API kľúč' },
      })
      if ('error' in res) {
        setError((res as { error: string }).error)
      } else {
        setCreated(res.key)
        setName('')
        router.invalidate()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    if (
      !confirm(
        'Naozaj zrušiť tento kľúč? Aplikácie, ktoré ho používajú, prestanú fungovať.',
      )
    )
      return
    await revokeApiKeyFn({ data: { id } })
    router.invalidate()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API kľúče</h1>
        <p className="mt-1 text-sm text-gray-500">
          Prístup k verejnému REST API (<code>/api/v1</code>). Dokumentácia na{' '}
          <a href="/developers" className="text-indigo-600 underline">
            /developers
          </a>
          .
        </p>
      </div>

      {created && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="text-sm font-medium text-green-800">
            Nový kľúč — skopírujte si ho teraz, znova sa nezobrazí:
          </div>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 font-mono text-sm">
            {created}
          </code>
          <button
            onClick={() => setCreated(null)}
            className="mt-2 text-xs text-green-700 underline"
          >
            Skryť
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-sm text-gray-600">Názov kľúča</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="napr. Web integrácia"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
        <button
          onClick={create}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Vytvoriť kľúč
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm table-cards">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-2">Názov</th>
              <th className="px-4 py-2">Kľúč</th>
              <th className="px-4 py-2">Naposledy použitý</th>
              <th className="px-4 py-2">Vytvorený</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b last:border-0">
                <td className="px-4 py-2">{k.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-600">
                  {k.keyPrefix}…
                </td>
                <td className="px-4 py-2 text-gray-600">{fmt(k.lastUsedAt)}</td>
                <td className="px-4 py-2 text-gray-600">{fmt(k.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  {k.revokedAt ? (
                    <span className="text-xs text-gray-400">Zrušený</span>
                  ) : (
                    <button
                      onClick={() => revoke(k.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Zrušiť
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  Zatiaľ žiadne API kľúče.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <WebhooksSection webhooks={webhooks} />
    </div>
  )
}

function WebhooksSection({ webhooks }: { webhooks: WebhookSummary[] }) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([...WEBHOOK_EVENTS])
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = (ev: string) =>
    setEvents((cur) =>
      cur.includes(ev) ? cur.filter((e) => e !== ev) : [...cur, ev],
    )

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await createWebhookFn({ data: { url: url.trim(), events } })
      if ('error' in res) {
        setError((res as { error: string }).error)
      } else {
        setSecret(res.secret)
        setUrl('')
        router.invalidate()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Naozaj odstrániť tento webhook endpoint?')) return
    await deleteWebhookFn({ data: { id } })
    router.invalidate()
  }

  return (
    <div className="space-y-4 border-t pt-8">
      <div>
        <h2 className="text-xl font-bold">Webhooky</h2>
        <p className="mt-1 text-sm text-gray-500">
          Notifikácie na váš server pri udalostiach. Payload je podpísaný
          hlavičkou <code>X-Ticketio-Signature</code>.
        </p>
      </div>

      {secret && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="text-sm font-medium text-green-800">
            Podpisový tajný kľúč — uložte si ho, znova sa nezobrazí:
          </div>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 font-mono text-sm">
            {secret}
          </code>
          <button
            onClick={() => setSecret(null)}
            className="mt-2 text-xs text-green-700 underline"
          >
            Skryť
          </button>
        </div>
      )}

      <div className="space-y-3 rounded-lg border bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-sm text-gray-600">Endpoint URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://vasa-app.sk/webhooks/ticketio"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
        <div className="flex flex-wrap gap-3">
          {WEBHOOK_EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={events.includes(ev)}
                onChange={() => toggle(ev)}
              />
              <code>{ev}</code>
            </label>
          ))}
        </div>
        <button
          onClick={create}
          disabled={busy || !url.trim() || events.length === 0}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Pridať webhook
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm table-cards">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-2">URL</th>
              <th className="px-4 py-2">Udalosti</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {webhooks.map((w) => (
              <tr key={w.id} className="border-b last:border-0">
                <td className="px-4 py-2 font-mono text-xs break-all">
                  {w.url}
                </td>
                <td className="px-4 py-2 text-gray-600">
                  {w.events.join(', ')}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => remove(w.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Odstrániť
                  </button>
                </td>
              </tr>
            ))}
            {webhooks.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                  Zatiaľ žiadne webhooky.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
