import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  listPlatformAdminsFn,
  addPlatformAdminFn,
  removePlatformAdminFn,
} from '../server/admin-admins'
import type { PlatformAdminView } from '../server/admin-admins'
import { formatSk } from '../lib/datetime'

export const Route = createFileRoute('/admin/admins')({
  loader: async (): Promise<PlatformAdminView[]> => {
    const res = await listPlatformAdminsFn()
    return 'error' in res ? [] : res
  },
  component: AdminsPage,
})

function AdminsPage() {
  const admins = Route.useLoaderData()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const fmt = (iso: string) => formatSk(iso, 'dateTime', 'Europe/Bratislava')

  const add = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await addPlatformAdminFn({
        data: { email: email.trim(), note: note.trim() || null },
      })
      if ('error' in res) {
        setMsg({ ok: false, text: (res as { error: string }).error })
      } else {
        setMsg({ ok: true, text: 'Admin pridaný.' })
        setEmail('')
        setNote('')
        router.invalidate()
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: PlatformAdminView) => {
    if (!confirm(`Odobrať platform admina ${a.email}?`)) return
    const res = await removePlatformAdminFn({ data: { userId: a.userId } })
    if ('error' in res) {
      alert((res as { error: string }).error)
      return
    }
    router.invalidate()
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform admini</h1>
        <p className="mt-1 text-sm text-gray-500">
          Správcovia celej platformy. Posledného admina nemožno odobrať.
        </p>
      </div>

      {msg && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            msg.ok
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-4">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-gray-600">
            E-mail existujúceho užívateľa
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@ticketio.sk"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Poznámka</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </label>
        <button
          onClick={add}
          disabled={busy || !email.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Pridať admina
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm table-cards">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-2">E-mail</th>
              <th className="px-4 py-2">Poznámka</th>
              <th className="px-4 py-2">Pridaný</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.userId} className="border-b last:border-0">
                <td className="px-4 py-2 font-medium">{a.email}</td>
                <td className="px-4 py-2 text-gray-500">{a.note ?? '—'}</td>
                <td className="px-4 py-2 text-gray-500">{fmt(a.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => remove(a)}
                    disabled={admins.length <= 1}
                    className="text-xs text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-300"
                    title={
                      admins.length <= 1
                        ? 'Posledného admina nemožno odobrať'
                        : ''
                    }
                  >
                    Odobrať
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
