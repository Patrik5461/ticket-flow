import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  adminListVenuesFn,
  adminGetVenueFn,
  adminGetSeatMapFn,
  adminSaveSeatMapFn,
  adminDeleteSeatMapFn,
  adminUpdateVenueFn,
  adminUnlockVenueFn,
  adminVenueHistoryFn,
} from '../server/admin-venues'
import type {
  AdminVenueList,
  AdminVenueDetail,
  AdminVenueHistoryEntry,
} from '../server/admin-venues'
import { SeatMapEditor } from '../components/SeatMapEditor'
import type { SeatMapEditorApi } from '../components/SeatMapEditor'

/**
 * Maintenance of the shared venue library. The halls here belong to no
 * organizer, so this page is the only place they can be corrected — see
 * src/server/admin-venues.ts for what the server does and does not allow.
 */
export const Route = createFileRoute('/admin/haly')({
  loader: async (): Promise<AdminVenueList> => {
    const res = await adminListVenuesFn({ data: {} })
    return 'error' in res ? { rows: [], total: 0 } : res
  },
  component: AdminVenuesPage,
})

const adminApi: SeatMapEditorApi = {
  get: (seatMapId) => adminGetSeatMapFn({ data: { seatMapId } }),
  save: (input) => adminSaveSeatMapFn({ data: input }),
  remove: (seatMapId) => adminDeleteSeatMapFn({ data: { seatMapId } }),
}

const IMPORT_NOTE =
  'Zmena platí hneď pre všetkých organizátorov a je trvalá: po uložení sa hala uzamkne, takže ju ďalší import z MaxiTicketu neprepíše.'

/** Bratislava time, the way the rest of the admin shows timestamps. */
function formatAt(iso: string): string {
  return new Date(iso).toLocaleString('sk-SK', {
    timeZone: 'Europe/Bratislava',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function AdminVenuesPage() {
  const initial = Route.useLoaderData()
  const [list, setList] = useState<AdminVenueList>(initial)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Search runs on the server: it matches without diacritics (see
  // adminListVenuesFn), which a client-side filter over one page could not do.
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await adminListVenuesFn({ data: { q: q.trim() } })
        if ('error' in res) setError(res.error)
        else {
          setError(null)
          setList(res)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Načítanie zlyhalo.')
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  if (openId) {
    return (
      <VenueDetail
        venueId={openId}
        onClose={() => {
          setOpenId(null)
          void adminListVenuesFn({ data: { q: q.trim() } }).then((res) => {
            if (!('error' in res)) setList(res)
          })
        }}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Haly v knižnici</h1>
        <p className="mt-1 text-sm text-gray-500">
          Verejné haly nepatria žiadnemu organizátorovi, takže ich nemá kto
          opraviť z organizátorskej sekcie. Tu sa upravujú — zmena je okamžite
          vidieť všetkým.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Hľadať podľa názvu alebo adresy…"
          className="w-72 rounded-md border px-3 py-2 text-sm"
        />
        <span className="text-xs text-gray-400">
          {loading
            ? 'Hľadám…'
            : list.total > list.rows.length
              ? `${list.rows.length} z ${list.total} hál — spresni hľadanie`
              : `${list.total} hál`}
        </span>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm table-cards">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-3">Hala</th>
              <th className="px-4 py-3 text-right">Mapy</th>
              <th className="px-4 py-3 text-right">Sedadlá</th>
              <th className="px-4 py-3">Stav</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {list.rows.map((v) => (
              <tr
                key={v.id}
                className="border-b last:border-0 hover:bg-gray-50"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-gray-400">
                    {v.address ?? 'bez adresy'}
                    {v.externalRef && ` · ${v.externalRef}`}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {v.mapCount}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {v.seatCount.toLocaleString('sk-SK')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {v.importLockedAt && (
                      <span
                        title={`Ručne upravená ${formatAt(v.importLockedAt)} — import ju preskakuje`}
                        className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
                      >
                        🔒 upravená
                      </span>
                    )}
                    {v.inUseMaps > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {v.inUseMaps} mapa v podujatí
                      </span>
                    )}
                    {!v.importLockedAt && v.inUseMaps === 0 && (
                      <span className="text-xs text-gray-400">voľná</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setOpenId(v.id)}
                    className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-gray-50"
                  >
                    Upraviť
                  </button>
                </td>
              </tr>
            ))}
            {list.rows.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  {q ? 'Nič nenájdené.' : 'Knižnica je prázdna.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function VenueDetail({
  venueId,
  onClose,
}: {
  venueId: string
  onClose: () => void
}) {
  const [venue, setVenue] = useState<AdminVenueDetail | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [history, setHistory] = useState<AdminVenueHistoryEntry[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const res = await adminGetVenueFn({ data: { id: venueId } })
    if ('error' in res) return setError(res.error)
    setError(null)
    setVenue(res)
    setName(res.name)
    setAddress(res.address ?? '')
    const hist = await adminVenueHistoryFn({ data: { id: venueId } })
    if (!('error' in hist)) setHistory(hist)
  }
  useEffect(() => {
    void load()
  }, [venueId])

  const unlock = async () => {
    if (
      !confirm(
        'Vrátiť halu pod import?\n\nPri najbližšom spustení importu sa prepíše z MaxiTicket exportu a ručné úpravy sa stratia.',
      )
    ) {
      return
    }
    setUnlocking(true)
    setNote(null)
    try {
      const res = await adminUnlockVenueFn({ data: { id: venueId } })
      if ('error' in res) return setError(res.error)
      setError(null)
      setNote('Hala je opäť pod importom.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uvoľnenie zlyhalo.')
    } finally {
      setUnlocking(false)
    }
  }

  const saveVenue = async () => {
    setSaving(true)
    setNote(null)
    try {
      const res = await adminUpdateVenueFn({
        data: { id: venueId, name: name.trim(), address: address.trim() },
      })
      if ('error' in res) return setError(res.error)
      setError(null)
      setNote('Uložené.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo.')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="space-y-4">
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          {IMPORT_NOTE}
        </p>
        <SeatMapEditor
          api={adminApi}
          venueId={venueId}
          seatMapId={editing.id}
          // The admin may write; only a map bound to an event stays locked, and
          // the editor derives that from `inUse` on its own.
          readOnly={false}
          inUseNote="Mapa sa už používa v podujatí — prepis by zmazal predané sedadlá, takže štruktúru meniť nemožno. Počkaj, kým podujatie skončí."
          onClose={() => {
            setEditing(null)
            void load()
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <button
        onClick={onClose}
        className="text-sm text-indigo-600 hover:underline"
      >
        ← Späť na zoznam hál
      </button>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {!venue ? (
        <p className="text-sm text-gray-500">Načítavam…</p>
      ) : (
        <>
          <section className="space-y-3 rounded-lg border bg-white p-4">
            <h2 className="text-lg font-semibold">Hala</h2>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-gray-600">Názov</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-72 rounded-md border px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-gray-600">Adresa</span>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-96 rounded-md border px-3 py-2 text-sm"
                />
              </label>
              <button
                onClick={saveVenue}
                disabled={saving || !name.trim()}
                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {saving ? 'Ukladám…' : 'Uložiť'}
              </button>
              {note && <span className="text-xs text-green-600">{note}</span>}
            </div>
            {venue.externalRef && (
              <p className="text-xs text-gray-400">
                Zdroj importu: {venue.externalRef}
              </p>
            )}

            {venue.importLockedAt ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-sm text-indigo-900">
                  <span className="font-medium">
                    🔒 Ručne upravená {formatAt(venue.importLockedAt)}.
                  </span>{' '}
                  Import z MaxiTicketu túto halu preskakuje, takže úpravy sú
                  trvalé. Uvoľnením ju vrátiš pod import — pri najbližšom behu
                  sa prepíše z exportu a tieto zmeny sa stratia.
                </p>
                <button
                  onClick={unlock}
                  disabled={unlocking}
                  className="shrink-0 rounded-md border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                >
                  {unlocking ? 'Uvoľňujem…' : 'Vrátiť pod import'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Halu spravuje import z MaxiTicketu. Prvou úpravou sa uzamkne a
                ďalší import ju už neprepíše.
              </p>
            )}
          </section>

          <section className="rounded-lg border bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Mapy</h2>
              <button
                onClick={() => setEditing({ id: null })}
                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
              >
                + Nová mapa
              </button>
            </div>
            {venue.maps.length === 0 ? (
              <p className="text-sm text-gray-500">Zatiaľ žiadne mapy.</p>
            ) : (
              <ul className="divide-y">
                {venue.maps.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between py-2"
                  >
                    <div>
                      <span className="font-medium">{m.name}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        {m.seatCount.toLocaleString('sk-SK')} sedadiel ·{' '}
                        {m.objectCount} objektov
                      </span>
                      {m.importLockedAt && (
                        <span
                          title={`Ručne upravená ${formatAt(m.importLockedAt)}`}
                          className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
                        >
                          🔒 upravená
                        </span>
                      )}
                      {m.inUse && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                          používa sa v podujatí
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setEditing({ id: m.id })}
                      className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-gray-50"
                    >
                      {m.inUse ? 'Zobraziť' : 'Upraviť'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-1 text-lg font-semibold">História úprav</h2>
            <p className="mb-3 text-xs text-gray-500">
              Kto a kedy halu menil. Vidno ju len tu v admine — organizátorom sa
              nezobrazuje nikde.
            </p>
            {history.length === 0 ? (
              <p className="text-sm text-gray-500">
                Zatiaľ žiadne úpravy — hala je presne taká, aká prišla z
                importu.
              </p>
            ) : (
              <ol className="divide-y text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-3 py-2">
                    <span className="w-36 shrink-0 tabular-nums text-xs text-gray-400">
                      {formatAt(h.at)}
                    </span>
                    <span className="font-medium">{h.label}</span>
                    {h.detail && (
                      <span className="text-gray-600">{h.detail}</span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">
                      {h.actorEmail}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  )
}
