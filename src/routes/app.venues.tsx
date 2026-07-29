import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listVenuesFn,
  createVenueFn,
  listSeatMapsFn,
  getSeatMapFn,
  saveSeatMapFn,
  deleteSeatMapFn,
} from '../server/venues'
import type { VenueRow, SeatMapSummary } from '../server/venues'
import {
  contentBounds,
  fitViewport,
  generateSeats,
  zoomViewport,
} from '../lib/seating'
import type {
  SeatType,
  GeneratedSeat,
  SeatMapLayout,
  Viewport,
} from '../lib/seating'

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
  const router = useRouter()
  const [venues, setVenues] = useState<VenueRow[]>(initial)
  const [venueId, setVenueId] = useState<string | null>(initial[0]?.id ?? null)
  const [newVenue, setNewVenue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Venue whose editor should open by itself right after creation, so that
  // "+ Pridať miesto" lands the user straight in the seat-map editor.
  const [autoNewMapFor, setAutoNewMapFor] = useState<string | null>(null)

  const selectVenue = (id: string | null) => {
    setAutoNewMapFor(null)
    setVenueId(id)
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
          ? [...venues, { id: res.id, name, address: null, createdAt: '' }]
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
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Miesto konania</span>
            <select
              value={venueId ?? ''}
              onChange={(e) => selectVenue(e.target.value || null)}
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
      </section>

      {venueId && (
        <SeatMaps
          key={venueId}
          venueId={venueId}
          autoNewMap={autoNewMapFor === venueId}
        />
      )}
    </div>
  )
}

function SeatMaps({
  venueId,
  autoNewMap,
}: {
  venueId: string
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
  const [error, setError] = useState<string | null>(null)

  // Load existing map
  useEffect(() => {
    if (!seatMapId) {
      setName('Nová mapa')
      return
    }
    void getSeatMapFn({ data: { seatMapId } }).then((res) => {
      if ('error' in res) return setError(res.error)
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
    setError(null)
    try {
      await doSave()
    } catch (e) {
      setError(
        `Mapu sa nepodarilo uložiť: ${
          e instanceof Error ? e.message : 'neznáma chyba'
        }`,
      )
    } finally {
      setSaving(false)
    }
  }

  const doSave = async () => {
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
    if ('error' in res) return setError(res.error)
    onClose()
  }

  const removeMap = async () => {
    if (!seatMapId || !confirm('Zmazať túto mapu?')) return
    const res = await deleteSeatMapFn({ data: { seatMapId } })
    if ('error' in res) return setError(res.error)
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

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}

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
        fitKey={`${seatMapId ?? 'new'}:${level}`}
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

/** Client (screen px) → SVG user units, letterboxing included. */
function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: clientX, y: clientY }
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

/** Rendered pixels per SVG unit — the divisor for turning drags into units. */
function pixelsPerUnit(svg: SVGSVGElement) {
  const ctm = svg.getScreenCTM()
  return ctm && ctm.a !== 0 ? ctm.a : 1
}

function Canvas({
  seats,
  fitKey,
  preview,
  selSector,
  onSelect,
  onMoveSector,
}: {
  seats: WorkSeat[]
  /** Changing this refits the view (switching level or opening another map). */
  fitKey: string
  preview: boolean
  selSector: string | null
  onSelect: (s: string | null) => void
  onMoveSector?: (sector: string, dx: number, dy: number) => void
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [view, setView] = useState<Viewport>(() =>
    fitViewport(contentBounds(seats), 0),
  )
  const [space, setSpace] = useState(false)
  const [panning, setPanning] = useState(false)

  // Live gesture state lives in refs: pointer moves must not wait for a render.
  const gesture = useRef<
    | { kind: 'pan'; id: number; x: number; y: number; moved: boolean }
    | { kind: 'sector'; id: number; sector: string; x: number; y: number }
    | null
  >(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchDist = useRef<number | null>(null)
  const hovering = useRef(false)
  const spaceRef = useRef(false)

  const seatsRef = useRef(seats)
  seatsRef.current = seats

  /** Frame the content, matching the container's aspect so nothing letterboxes. */
  const fit = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect()
    const aspect = rect && rect.height > 0 ? rect.width / rect.height : 0
    setView(fitViewport(contentBounds(seatsRef.current), aspect))
  }, [])

  const zoomBy = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      setView((v) => {
        const svg = svgRef.current
        const anchor =
          svg && clientX !== undefined && clientY !== undefined
            ? clientToSvg(svg, clientX, clientY)
            : undefined
        return zoomViewport(v, factor, anchor)
      })
    },
    [],
  )

  // Refit when the map or level changes, and once seats first appear.
  const hadSeats = useRef(seats.length > 0)
  useEffect(() => {
    hadSeats.current = seatsRef.current.length > 0
    fit()
  }, [fitKey, fit])
  useEffect(() => {
    if (!hadSeats.current && seats.length > 0) fit()
    hadSeats.current = seats.length > 0
  }, [seats.length, fit])

  // Wheel must be a non-passive listener, otherwise preventDefault is ignored
  // and the page scrolls instead of the map zooming.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      zoomBy(Math.exp(delta * 0.0015), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  // Space holds the canvas in pan mode, like every other editor.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return
      if (hovering.current) e.preventDefault()
      spaceRef.current = true
      setSpace(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceRef.current = false
      setSpace(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const startPan = (e: React.PointerEvent, fromBackground: boolean) => {
    svgRef.current?.setPointerCapture(e.pointerId)
    gesture.current = {
      kind: 'pan',
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: !fromBackground,
    }
    setPanning(true)
  }

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchDist.current = null
    const g = gesture.current
    if (g && g.id === e.pointerId) {
      // A background press that never moved is a click: clear the selection.
      if (g.kind === 'pan' && !g.moved) onSelect(null)
      gesture.current = null
      setPanning(false)
    }
    const svg = svgRef.current
    if (svg?.hasPointerCapture(e.pointerId))
      svg.releasePointerCapture(e.pointerId)
  }

  const color = (s: WorkSeat) =>
    preview
      ? s.seat_type === 'blocked'
        ? '#9ca3af'
        : '#22c55e'
      : SEAT_COLORS[s.seat_type]

  const cursor = space || panning ? 'grabbing' : 'default'

  return (
    <div className="relative rounded-md border bg-ink-950">
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <CanvasButton onClick={() => zoomBy(1 / 1.3)} title="Priblížiť">
          +
        </CanvasButton>
        <CanvasButton onClick={() => zoomBy(1.3)} title="Oddialiť">
          −
        </CanvasButton>
        <CanvasButton onClick={fit} title="Prispôsobiť obrazovke">
          ⤢
        </CanvasButton>
      </div>

      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className="h-[26rem] w-full touch-none select-none"
        style={{ cursor }}
        onPointerEnter={() => (hovering.current = true)}
        onPointerLeave={() => (hovering.current = false)}
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pointers.current.size >= 2) {
            // Second finger down: hand over to pinch, drop any single-pointer
            // gesture so a sector does not travel with the pinch.
            gesture.current = null
            setPanning(false)
            return
          }
          // A seat sets its own gesture first (events bubble target-up).
          if (!gesture.current) startPan(e, true)
        }}
        onPointerMove={(e) => {
          const svg = svgRef.current
          if (!svg) return
          if (pointers.current.has(e.pointerId))
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

          if (pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()]
            const d = Math.hypot(a.x - b.x, a.y - b.y)
            if (pinchDist.current && d > 0)
              zoomBy(pinchDist.current / d, (a.x + b.x) / 2, (a.y + b.y) / 2)
            pinchDist.current = d
            return
          }

          const g = gesture.current
          if (!g || g.id !== e.pointerId) return
          const scale = pixelsPerUnit(svg)
          const dx = (e.clientX - g.x) / scale
          const dy = (e.clientY - g.y) / scale
          g.x = e.clientX
          g.y = e.clientY
          if (g.kind === 'pan') {
            if (dx !== 0 || dy !== 0) g.moved = true
            setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }))
          } else {
            onMoveSector?.(g.sector, dx, dy)
          }
        }}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        {/* Catches presses on empty space so panning works away from seats. */}
        <rect
          x={view.x}
          y={view.y}
          width={view.w}
          height={view.h}
          fill="transparent"
        />
        {seats.map((s) => (
          <circle
            key={s.cid}
            cx={s.x}
            cy={s.y}
            r={9}
            fill={color(s)}
            stroke={selSector === s.sector ? '#fff' : 'none'}
            strokeWidth={selSector === s.sector ? 1.5 : 0}
            style={{
              cursor:
                space || panning
                  ? 'grabbing'
                  : onMoveSector
                    ? 'move'
                    : 'pointer',
            }}
            onPointerDown={(e) => {
              if (pointers.current.size >= 1) return // pinch starting
              if (spaceRef.current || e.button === 1) return startPan(e, false)
              onSelect(s.sector)
              if (!onMoveSector) return
              svgRef.current?.setPointerCapture(e.pointerId)
              gesture.current = {
                kind: 'sector',
                id: e.pointerId,
                sector: s.sector,
                x: e.clientX,
                y: e.clientY,
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

function CanvasButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="h-7 w-7 rounded border border-white/20 bg-black/40 text-sm leading-none text-white hover:bg-black/60"
    >
      {children}
    </button>
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
