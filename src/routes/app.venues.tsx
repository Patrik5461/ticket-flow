import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  listVenuesFn,
  createVenueFn,
  listSeatMapsFn,
  getSeatMapFn,
  saveSeatMapFn,
  deleteSeatMapFn,
} from '../server/venues'
import type { VenueRow, SeatMapSummary } from '../server/venues'
import { generateSeats } from '../lib/seating'
import type { SeatType, GeneratedSeat, SeatMapLayout } from '../lib/seating'

export const Route = createFileRoute('/app/venues')({
  loader: async (): Promise<VenueRow[]> => {
    const res = await listVenuesFn()
    return 'error' in res ? [] : res
  },
  component: VenuesPage,
})

// A working seat carries a client id so we can move/delete before saving.
interface WorkSeat extends GeneratedSeat {
  cid: string
}

const SEAT_COLORS: Record<SeatType, string> = {
  standard: '#6366f1',
  wheelchair: '#0ea5e9',
  blocked: '#9ca3af',
}

let cidSeq = 0
const nextCid = () => `s${++cidSeq}`

function VenuesPage() {
  const initial = Route.useLoaderData()
  const [venues, setVenues] = useState<VenueRow[]>(initial)
  const [venueId, setVenueId] = useState<string | null>(initial[0]?.id ?? null)
  const [newVenue, setNewVenue] = useState('')

  const addVenue = async () => {
    const name = newVenue.trim()
    if (!name) return
    try {
      const res = await createVenueFn({ data: { name } })
      if ('error' in res) return alert(res.error)
      const list = await listVenuesFn()
      if (!('error' in list)) {
        setVenues(list)
        setVenueId(res.id)
      }
      setNewVenue('')
    } catch (e) {
      alert(
        `Miesto sa nepodarilo vytvoriť: ${
          e instanceof Error ? e.message : 'neznáma chyba'
        }`,
      )
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
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Miesto konania</span>
            <select
              value={venueId ?? ''}
              onChange={(e) => setVenueId(e.target.value || null)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">— vyberte —</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Nové miesto</span>
            <input
              value={newVenue}
              onChange={(e) => setNewVenue(e.target.value)}
              placeholder="napr. Mestské divadlo"
              className="rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={addVenue}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            + Pridať miesto
          </button>
        </div>
      </section>

      {venueId && <SeatMaps venueId={venueId} />}
    </div>
  )
}

function SeatMaps({ venueId }: { venueId: string }) {
  const [maps, setMaps] = useState<SeatMapSummary[]>([])
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)

  const load = async () => {
    const res = await listSeatMapsFn({ data: { venueId } })
    if (!('error' in res)) setMaps(res)
  }
  useEffect(() => {
    void load()
    setEditing(null)
  }, [venueId])

  if (editing) {
    return (
      <MapEditor
        venueId={venueId}
        seatMapId={editing.id}
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
        <button
          onClick={() => setEditing({ id: null })}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          + Nová mapa
        </button>
      </div>
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
                Otvoriť
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function MapEditor({
  venueId,
  seatMapId,
  onClose,
}: {
  venueId: string
  seatMapId: string | null
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [seats, setSeats] = useState<WorkSeat[]>([])
  const [level, setLevel] = useState('parter')
  const [preview, setPreview] = useState(false)
  const [inUse, setInUse] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selSector, setSelSector] = useState<string | null>(null)

  // Load existing map
  useEffect(() => {
    if (!seatMapId) {
      setName('Nová mapa')
      return
    }
    void getSeatMapFn({ data: { seatMapId } }).then((res) => {
      if ('error' in res) return alert(res.error)
      setName(res.name)
      setInUse(res.inUse)
      setSeats(
        res.seats.map((s) => ({
          cid: nextCid(),
          level: s.level,
          sector: s.sector,
          row_label: s.rowLabel,
          seat_number: s.seatNumber,
          x: s.x,
          y: s.y,
          seat_type: s.seatType,
        })),
      )
      const first = res.seats[0]?.level
      if (first) setLevel(first)
    })
  }, [seatMapId])

  const levels = useMemo(() => {
    const set = new Set(seats.map((s) => s.level))
    set.add(level)
    return [...set].sort()
  }, [seats, level])

  const levelSeats = seats.filter((s) => s.level === level)

  const save = async () => {
    setSaving(true)
    const res = await saveSeatMapFn({
      data: {
        seatMapId,
        venueId,
        name: name.trim() || 'Mapa',
        layout: buildLayout(seats),
        seats: seats.map((s) => ({
          level: s.level,
          levelOrder: levels.indexOf(s.level),
          sector: s.sector,
          rowLabel: s.row_label,
          seatNumber: s.seat_number,
          x: s.x,
          y: s.y,
          seatType: s.seat_type,
        })),
      },
    })
    setSaving(false)
    if ('error' in res) return alert(res.error)
    onClose()
  }

  const removeMap = async () => {
    if (!seatMapId || !confirm('Zmazať túto mapu?')) return
    const res = await deleteSeatMapFn({ data: { seatMapId } })
    if ('error' in res) return alert(res.error)
    onClose()
  }

  return (
    <section className="space-y-4 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border px-3 py-2 text-lg font-semibold"
        />
        <div className="flex gap-2">
          <button
            onClick={() => setPreview((p) => !p)}
            className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
          >
            {preview ? 'Editor' : 'Náhľad kupujúceho'}
          </button>
          {seatMapId && !inUse && (
            <button
              onClick={removeMap}
              className="rounded-md border px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              Zmazať
            </button>
          )}
          <button
            onClick={save}
            disabled={saving || inUse}
            className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            title={inUse ? 'Mapa sa používa v podujatí' : ''}
          >
            {saving ? 'Ukladám…' : 'Uložiť'}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Zavrieť
          </button>
        </div>
      </div>

      {inUse && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          Mapa sa používa v podujatí — štruktúru nemožno meniť. Vytvorte kópiu.
        </p>
      )}

      {/* Level tabs */}
      <div className="flex flex-wrap gap-2">
        {levels.map((lv) => (
          <button
            key={lv}
            onClick={() => setLevel(lv)}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              lv === level
                ? 'bg-gray-900 text-white'
                : 'border hover:bg-gray-50'
            }`}
          >
            {lv} ({seats.filter((s) => s.level === lv).length})
          </button>
        ))}
      </div>

      {!preview && !inUse && (
        <AddSectorForm
          level={level}
          onLevel={setLevel}
          existingBottom={Math.max(0, ...levelSeats.map((s) => s.y)) + 40}
          onAdd={(gen) =>
            setSeats((prev) => [
              ...prev,
              ...gen.map((g) => ({ ...g, cid: nextCid() })),
            ])
          }
        />
      )}

      <Canvas
        seats={levelSeats}
        preview={preview}
        selSector={selSector}
        onSelect={setSelSector}
        onMoveSector={
          preview || inUse
            ? undefined
            : (sector, dx, dy) =>
                setSeats((prev) =>
                  prev.map((s) =>
                    s.level === level && s.sector === sector
                      ? { ...s, x: s.x + dx, y: s.y + dy }
                      : s,
                  ),
                )
        }
      />

      {!preview && !inUse && selSector && (
        <SectorTools
          sector={selSector}
          onDelete={() => {
            setSeats((prev) =>
              prev.filter(
                (s) => !(s.level === level && s.sector === selSector),
              ),
            )
            setSelSector(null)
          }}
          onType={(t) =>
            setSeats((prev) =>
              prev.map((s) =>
                s.level === level && s.sector === selSector
                  ? { ...s, seat_type: t }
                  : s,
              ),
            )
          }
        />
      )}
    </section>
  )
}

function AddSectorForm({
  level,
  onLevel,
  existingBottom,
  onAdd,
}: {
  level: string
  onLevel: (l: string) => void
  existingBottom: number
  onAdd: (seats: GeneratedSeat[]) => void
}) {
  const [sector, setSector] = useState('')
  const [rows, setRows] = useState('10')
  const [perRow, setPerRow] = useState('20')
  const [style, setStyle] = useState<'alpha' | 'numeric'>('alpha')
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr')

  const add = () => {
    const sec = sector.trim()
    if (!sec) return
    const gen = generateSeats({
      level,
      sector: sec,
      rows: parseInt(rows, 10) || 0,
      seatsPerRow: parseInt(perRow, 10) || 0,
      rowLabelStyle: style,
      seatNumberDir: dir,
      originX: 0,
      originY: existingBottom,
    })
    onAdd(gen)
    setSector('')
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border bg-gray-50 p-3 text-sm">
      <label>
        <span className="mb-1 block text-xs text-gray-600">Úroveň</span>
        <input
          value={level}
          onChange={(e) => onLevel(e.target.value)}
          className="w-28 rounded border px-2 py-1"
        />
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-600">Sektor</span>
        <input
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          placeholder="napr. A"
          className="w-24 rounded border px-2 py-1"
        />
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-600">Radov</span>
        <input
          value={rows}
          onChange={(e) => setRows(e.target.value)}
          type="number"
          className="w-16 rounded border px-2 py-1"
        />
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-600">Miest/rad</span>
        <input
          value={perRow}
          onChange={(e) => setPerRow(e.target.value)}
          type="number"
          className="w-16 rounded border px-2 py-1"
        />
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-600">Rady</span>
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value as 'alpha' | 'numeric')}
          className="rounded border px-2 py-1"
        >
          <option value="alpha">A, B, C…</option>
          <option value="numeric">1, 2, 3…</option>
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-600">Číslovanie</span>
        <select
          value={dir}
          onChange={(e) => setDir(e.target.value as 'ltr' | 'rtl')}
          className="rounded border px-2 py-1"
        >
          <option value="ltr">zľava</option>
          <option value="rtl">sprava</option>
        </select>
      </label>
      <button
        onClick={add}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
      >
        Generovať sektor
      </button>
    </div>
  )
}

function SectorTools({
  sector,
  onDelete,
  onType,
}: {
  sector: string
  onDelete: () => void
  onType: (t: SeatType) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
      <span className="font-medium">Sektor {sector}:</span>
      {(['standard', 'wheelchair', 'blocked'] as const).map((t) => (
        <button
          key={t}
          onClick={() => onType(t)}
          className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
        >
          {t === 'standard'
            ? 'Štandard'
            : t === 'wheelchair'
              ? 'Vozík'
              : 'Blokované'}
        </button>
      ))}
      <button
        onClick={onDelete}
        className="ml-auto rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50"
      >
        Zmazať sektor
      </button>
    </div>
  )
}

function Canvas({
  seats,
  preview,
  selSector,
  onSelect,
  onMoveSector,
}: {
  seats: WorkSeat[]
  preview: boolean
  selSector: string | null
  onSelect: (s: string | null) => void
  onMoveSector?: (sector: string, dx: number, dy: number) => void
}) {
  const drag = useRef<{ sector: string; x: number; y: number } | null>(null)

  const bounds = useMemo(() => {
    if (seats.length === 0) return { minX: 0, minY: 0, w: 400, h: 200 }
    const xs = seats.map((s) => s.x)
    const ys = seats.map((s) => s.y)
    const minX = Math.min(...xs) - 20
    const minY = Math.min(...ys) - 20
    return {
      minX,
      minY,
      w: Math.max(...xs) - minX + 40,
      h: Math.max(...ys) - minY + 40,
    }
  }, [seats])

  const color = (s: WorkSeat) =>
    preview
      ? s.seat_type === 'blocked'
        ? '#9ca3af'
        : '#22c55e'
      : SEAT_COLORS[s.seat_type]

  return (
    <div className="overflow-auto rounded-md border bg-ink-950">
      <svg
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`}
        className="h-[26rem] w-full touch-none"
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
        onPointerMove={(e) => {
          if (!drag.current || !onMoveSector) return
          const svg = e.currentTarget
          const scale = bounds.w / svg.clientWidth
          const nx = e.clientX * scale
          const ny = e.clientY * scale
          const dx = nx - drag.current.x
          const dy = ny - drag.current.y
          drag.current.x = nx
          drag.current.y = ny
          onMoveSector(drag.current.sector, dx, dy)
        }}
      >
        {seats.map((s) => (
          <circle
            key={s.cid}
            cx={s.x}
            cy={s.y}
            r={9}
            fill={color(s)}
            stroke={selSector === s.sector ? '#fff' : 'none'}
            strokeWidth={selSector === s.sector ? 1.5 : 0}
            style={{ cursor: onMoveSector ? 'move' : 'pointer' }}
            onPointerDown={(e) => {
              onSelect(s.sector)
              if (onMoveSector) {
                const svg = e.currentTarget.ownerSVGElement!
                const scale = bounds.w / svg.clientWidth
                drag.current = {
                  sector: s.sector,
                  x: e.clientX * scale,
                  y: e.clientY * scale,
                }
              }
            }}
          >
            <title>{`${s.sector} ${s.row_label}${s.seat_number}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}

/** Bounding-box shapes per level for the buyer render (stored in layout jsonb). */
function buildLayout(seats: WorkSeat[]): SeatMapLayout {
  const byLevel = new Map<string, WorkSeat[]>()
  for (const s of seats) {
    const arr = byLevel.get(s.level) ?? []
    arr.push(s)
    byLevel.set(s.level, arr)
  }
  const levels = [...byLevel.entries()].sort().map(([key, ls], order) => {
    const bySector = new Map<string, WorkSeat[]>()
    for (const s of ls) {
      const a = bySector.get(s.sector) ?? []
      a.push(s)
      bySector.set(s.sector, a)
    }
    const shapes = [...bySector.entries()].map(([sector, ss]) => {
      const xs = ss.map((s) => s.x)
      const ys = ss.map((s) => s.y)
      const x = Math.min(...xs) - 12
      const y = Math.min(...ys) - 12
      return {
        sector,
        kind: 'rect' as const,
        x,
        y,
        width: Math.max(...xs) - x + 12,
        height: Math.max(...ys) - y + 12,
      }
    })
    const xs = ls.map((s) => s.x)
    const ys = ls.map((s) => s.y)
    return {
      key,
      name: key,
      order,
      canvas: {
        width: Math.max(...xs, 0) + 40,
        height: Math.max(...ys, 0) + 40,
      },
      shapes,
    }
  })
  return { levels }
}
