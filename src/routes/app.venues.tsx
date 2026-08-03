import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  listVenuesFn,
  createVenueFn,
  duplicateVenueFn,
  listSeatMapsFn,
  getSeatMapFn,
  saveSeatMapFn,
  deleteSeatMapFn,
} from '../server/venues'
import type { VenueRow, SeatMapSummary } from '../server/venues'
import { VenueCombobox } from '../components/VenueCombobox'
import { SeatMapEditor } from '../components/SeatMapEditor'
import type { SeatMapEditorApi } from '../components/SeatMapEditor'

/**
 * The organizer's own venues. Editing is scoped to them by the server; a
 * library hall opens in the same editor as a viewer, and the way to change one
 * is a private copy (or, for the platform admin, /admin/haly).
 */
const organizerApi: SeatMapEditorApi = {
  get: (seatMapId) => getSeatMapFn({ data: { seatMapId } }),
  save: (input) => saveSeatMapFn({ data: input }),
  remove: (seatMapId) => deleteSeatMapFn({ data: { seatMapId } }),
}

const LIBRARY_NOTE =
  'Mapa verejnej haly — len na prezeranie. Priradiť ju podujatiu môžete aj takto; na úpravy si halu duplikujte do svojich miest.'

export const Route = createFileRoute('/app/venues')({
  loader: async (): Promise<VenueRow[]> => {
    const res = await listVenuesFn()
    return 'error' in res ? [] : res
  },
  component: VenuesPage,
})

function VenuesPage() {
  const initial = Route.useLoaderData()
  const router = useRouter()
  const [venues, setVenues] = useState<VenueRow[]>(initial)
  const [venueId, setVenueId] = useState<string | null>(initial[0]?.id ?? null)
  const [newVenue, setNewVenue] = useState('')
  const [saving, setSaving] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Venue whose editor should open by itself right after creation, so that
  // "+ Pridať miesto" lands the user straight in the seat-map editor.
  const [autoNewMapFor, setAutoNewMapFor] = useState<string | null>(null)

  const selected = venues.find((v) => v.id === venueId) ?? null
  // Library halls belong to nobody: no rename, no delete, no map edits. The
  // way in is a private copy.
  const readOnly = selected?.readOnly ?? false

  const selectVenue = (id: string | null) => {
    setAutoNewMapFor(null)
    setVenueId(id)
  }

  const duplicate = async () => {
    if (!selected) return
    setError(null)
    setDuplicating(true)
    try {
      const res = await duplicateVenueFn({ data: { id: selected.id } })
      if ('error' in res) return setError(res.error)
      const list = await listVenuesFn()
      if (!('error' in list)) setVenues(list)
      setVenueId(res.id)
      setAutoNewMapFor(null)
      void router.invalidate()
    } catch (e) {
      setError(
        `Kópiu sa nepodarilo vytvoriť: ${
          e instanceof Error ? e.message : 'neznáma chyba'
        }`,
      )
    } finally {
      setDuplicating(false)
    }
  }

  const addVenue = async () => {
    const name = newVenue.trim()
    if (!name) return setError('Zadajte názov miesta.')
    setError(null)
    setSaving(true)
    try {
      const res = await createVenueFn({ data: { name } })
      if ('error' in res) return setError(res.error)
      // Refresh the select; if the refetch fails we still show the new venue
      // rather than leaving the user with an unchanged screen.
      const list = await listVenuesFn()
      setVenues(
        'error' in list
          ? [
              ...venues,
              // Display-only stand-in until the next successful refetch; a
              // just-created venue is always the caller's own and editable.
              {
                id: res.id,
                name,
                address: null,
                createdAt: '',
                organizerId: null,
                isPublic: false,
                readOnly: false,
              },
            ]
          : list,
      )
      setVenueId(res.id)
      setAutoNewMapFor(res.id)
      setNewVenue('')
      void router.invalidate()
    } catch (e) {
      setError(
        `Miesto sa nepodarilo vytvoriť: ${
          e instanceof Error ? e.message : 'neznáma chyba'
        }`,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Miesta a mapy sedadiel</h1>
        <p className="mt-1 text-sm text-gray-500">
          Znovupoužiteľné mapy hál. Sektory priradíte cenovým kategóriám až pri
          konkrétnom podujatí.
        </p>
      </div>

      <section className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <VenueCombobox
            venues={venues}
            value={venueId}
            onChange={selectVenue}
          />
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Nové miesto</span>
            <input
              value={newVenue}
              onChange={(e) => setNewVenue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addVenue()
              }}
              placeholder="napr. Mestské divadlo"
              className="rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={addVenue}
            disabled={saving}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? 'Vytváram…' : '+ Pridať miesto'}
          </button>
        </div>
        {error && (
          <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {readOnly && selected && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm text-blue-900">
              <span className="font-medium">Verejná hala.</span> Je spoločná pre
              všetkých organizátorov, preto ju nemožno premenovať, zmazať ani
              upraviť jej mapu. Jej mapu môžete bez kopírovania priradiť
              podujatiu — kópiu potrebujete len na úpravy.
            </p>
            <button
              onClick={duplicate}
              disabled={duplicating}
              className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {duplicating ? 'Kopírujem…' : 'Duplikovať do mojich miest'}
            </button>
          </div>
        )}
      </section>

      {venueId && (
        <SeatMaps
          key={venueId}
          venueId={venueId}
          readOnly={readOnly}
          autoNewMap={autoNewMapFor === venueId}
        />
      )}
    </div>
  )
}

function SeatMaps({
  venueId,
  readOnly,
  autoNewMap,
}: {
  venueId: string
  readOnly: boolean
  autoNewMap: boolean
}) {
  const [maps, setMaps] = useState<SeatMapSummary[]>([])
  // Keyed on venueId by the parent, so the initial value is enough — a fresh
  // venue mounts straight into an empty editor.
  const [editing, setEditing] = useState<{ id: string | null } | null>(
    autoNewMap ? { id: null } : null,
  )
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await listSeatMapsFn({ data: { venueId } })
      if ('error' in res) return setError(res.error)
      setError(null)
      setMaps(res)
    } catch (e) {
      setError(
        `Mapy sa nepodarilo načítať: ${
          e instanceof Error ? e.message : 'neznáma chyba'
        }`,
      )
    }
  }
  useEffect(() => {
    void load()
  }, [venueId])

  if (editing) {
    return (
      <SeatMapEditor
        api={organizerApi}
        venueId={venueId}
        seatMapId={editing.id}
        readOnly={readOnly}
        readOnlyNote={readOnly ? LIBRARY_NOTE : undefined}
        onClose={() => {
          setEditing(null)
          void load()
        }}
      />
    )
  }

  return (
    <section className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mapy</h2>
        {!readOnly && (
          <button
            onClick={() => setEditing({ id: null })}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            + Nová mapa
          </button>
        )}
      </div>
      {error && (
        <p className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {maps.length === 0 ? (
        <p className="text-sm text-gray-500">Zatiaľ žiadne mapy.</p>
      ) : (
        <ul className="divide-y">
          {maps.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2">
              <div>
                <span className="font-medium">{m.name}</span>
                <span className="ml-2 text-xs text-gray-400">
                  {m.seatCount} sedadiel {m.inUse && '· používa sa'}
                </span>
              </div>
              <button
                onClick={() => setEditing({ id: m.id })}
                className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-gray-50"
              >
                {readOnly ? 'Zobraziť' : 'Otvoriť'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
