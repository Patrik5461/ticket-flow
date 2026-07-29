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
  GRID_SIZE,
  LAYOUT_VERSION,
  angleFromCenter,
  areaPricingKey,
  centroid,
  contentBounds,
  fitViewport,
  generateSeats,
  migrateLayout,
  nextCopyName,
  nextObjectId,
  normalizeAngle,
  respaceSector,
  objectCenter,
  objectCorners,
  objectPoints,
  resizeObject,
  rotatePoints,
  snap,
  zoomViewport,
} from '../lib/seating'
import type {
  SeatType,
  GeneratedSeat,
  MapObject,
  MapObjectKind,
  ResizeHandle,
  RespaceOptions,
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

/** Objects are stored per level in the layout; in the editor they carry it. */
interface WorkObject extends MapObject {
  level: string
}

/** What the sector/object tool panel is currently pointed at. */
type Selection =
  { kind: 'sector'; sector: string } | { kind: 'object'; id: string } | null

const SEAT_COLORS: Record<SeatType, string> = {
  standard: '#6366f1',
  wheelchair: '#0ea5e9',
  blocked: '#9ca3af',
}

let cidSeq = 0
const nextCid = () => `s${++cidSeq}`

const DEFAULT_SEAT_GAP = 28
const DEFAULT_ROW_GAP = 32
/** How many editor steps undo can walk back. */
const HISTORY_LIMIT = 40

const numOr = (raw: string, fallback: number) => {
  const n = parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Everything undo/redo restores — the geometry, not the viewport or selection. */
interface EditorDoc {
  seats: WorkSeat[]
  objects: WorkObject[]
}

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
  const [objects, setObjects] = useState<WorkObject[]>([])
  const [level, setLevel] = useState('parter')
  const [preview, setPreview] = useState(false)
  const [inUse, setInUse] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sel, setSel] = useState<Selection>(null)
  const [snapOn, setSnapOn] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The canvas owns the viewport; new objects are dropped where the user is
  // actually looking, so this mirrors it without re-rendering the editor.
  const viewRef = useRef<Viewport | null>(null)

  // --- undo/redo -----------------------------------------------------------
  // Snapshots are taken *before* a change lands, and a continuous gesture
  // checkpoints once at pointer-down, so dragging a sector across the canvas
  // costs one undo step rather than one per mouse move.
  const docRef = useRef<EditorDoc>({ seats, objects })
  docRef.current = { seats, objects }
  const history = useRef<{ past: EditorDoc[]; future: EditorDoc[] }>({
    past: [],
    future: [],
  })
  const [histSize, setHistSize] = useState({ undo: 0, redo: 0 })
  const syncHist = () =>
    setHistSize({
      undo: history.current.past.length,
      redo: history.current.future.length,
    })

  const checkpoint = useCallback(() => {
    const h = history.current
    h.past.push(docRef.current)
    if (h.past.length > HISTORY_LIMIT) h.past.shift()
    h.future = []
    syncHist()
  }, [])

  const restore = (doc: EditorDoc) => {
    setSeats(doc.seats)
    setObjects(doc.objects)
    setSel(null)
  }

  const undo = useCallback(() => {
    const h = history.current
    const prev = h.past.pop()
    if (!prev) return
    h.future.push(docRef.current)
    restore(prev)
    syncHist()
  }, [])

  const redo = useCallback(() => {
    const h = history.current
    const next = h.future.pop()
    if (!next) return
    h.past.push(docRef.current)
    restore(next)
    syncHist()
  }, [])

  // Loading a map is the baseline, not an undoable step.
  const resetHistory = () => {
    history.current = { past: [], future: [] }
    syncHist()
  }

  // --- keyboard ------------------------------------------------------------
  const selRef = useRef<Selection>(sel)
  selRef.current = sel
  const editableRef = useRef(true)

  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const s = selRef.current
        if (!s || !editableRef.current) return
        e.preventDefault()
        if (s.kind === 'sector') deleteSectorRef.current(s.sector)
        else deleteObjectRef.current(s.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // The delete handlers close over current state, so reach them through refs
  // rather than re-binding the key listener on every edit.
  const deleteSectorRef = useRef<(s: string) => void>(() => {})
  const deleteObjectRef = useRef<(id: string) => void>(() => {})

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
      // Older maps carry no objects at all — the migration fills them in.
      const layout = migrateLayout(res.layout)
      setObjects(
        layout.levels.flatMap((lv) =>
          lv.objects.map((o) => ({ ...o, level: lv.key })),
        ),
      )
      const first = res.seats[0]?.level ?? layout.levels[0]?.key
      if (first) setLevel(first)
      resetHistory()
    })
  }, [seatMapId])

  const levels = useMemo(() => {
    const set = new Set(seats.map((s) => s.level))
    for (const o of objects) set.add(o.level)
    set.add(level)
    return [...set].sort()
  }, [seats, objects, level])

  const levelSeats = seats.filter((s) => s.level === level)
  const levelObjects = objects.filter((o) => o.level === level)
  const editable = !preview && !inUse

  const selSector = sel?.kind === 'sector' ? sel.sector : null
  const selObject =
    sel?.kind === 'object'
      ? (objects.find((o) => o.id === sel.id) ?? null)
      : null

  const grid = snapOn ? GRID_SIZE : 0
  editableRef.current = editable

  // --- objects -------------------------------------------------------------

  const addObject = (kind: MapObjectKind) => {
    checkpoint()
    const v = viewRef.current
    const width = kind === 'stage' ? 240 : 200
    const height = kind === 'stage' ? 60 : 140
    const cx = v ? v.x + v.w / 2 : 0
    const cy = v ? v.y + v.h / 2 : 0
    const obj: WorkObject = {
      id: nextObjectId(objects.map((o) => o.id)),
      level,
      kind,
      label: kind === 'stage' ? 'Pódium' : 'Plocha',
      x: snap(cx - width / 2, grid),
      y: snap(cy - height / 2, grid),
      width,
      height,
      rotation: 0,
      capacity: null,
    }
    setObjects((prev) => [...prev, obj])
    setSel({ kind: 'object', id: obj.id })
  }

  const patchObject = (id: string, patch: Partial<MapObject>) =>
    setObjects((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    )

  const duplicateObject = (id: string) => {
    const src = objects.find((o) => o.id === id)
    if (!src) return
    checkpoint()
    const copy: WorkObject = {
      ...src,
      id: nextObjectId(objects.map((o) => o.id)),
      label: nextCopyName(
        objects.map((o) => o.label),
        src.label,
      ),
      x: src.x + 24,
      y: src.y + 24,
    }
    setObjects((prev) => [...prev, copy])
    setSel({ kind: 'object', id: copy.id })
  }

  const deleteObject = (id: string) => {
    const o = objects.find((x) => x.id === id)
    if (!o || !confirm(`Zmazať „${o.label}"?`)) return
    checkpoint()
    setObjects((prev) => prev.filter((x) => x.id !== id))
    setSel(null)
  }

  // --- sectors -------------------------------------------------------------

  const sectorSeats = (sector: string) =>
    seats.filter((s) => s.level === level && s.sector === sector)

  const rotateSector = (sector: string, deg: number) => {
    const target = sectorSeats(sector)
    if (target.length === 0) return
    checkpoint()
    const pivot = centroid(target)
    const moved = new Map(
      rotatePoints(target, deg, pivot).map((s) => [s.cid, s]),
    )
    setSeats((prev) => prev.map((s) => moved.get(s.cid) ?? s))
  }

  const duplicateSector = (sector: string) => {
    const src = sectorSeats(sector)
    if (src.length === 0) return
    checkpoint()
    const copyName = nextCopyName(
      [...new Set(seats.map((s) => s.sector))],
      sector,
    )
    // Drop the copy clear of the original so both stay visible.
    const dx =
      Math.max(...src.map((s) => s.x)) - Math.min(...src.map((s) => s.x)) + 60
    setSeats((prev) => [
      ...prev,
      ...src.map((s) => ({
        ...s,
        cid: nextCid(),
        sector: copyName,
        x: s.x + dx,
      })),
    ])
    setSel({ kind: 'sector', sector: copyName })
  }

  const respace = (sector: string, opts: RespaceOptions) => {
    if (sectorSeats(sector).length === 0) return
    checkpoint()
    // Respace only the sector on this level; the lib keys off sector name, so
    // scope it here to avoid touching a same-named sector on another level.
    const onLevel = new Set(sectorSeats(sector).map((s) => s.cid))
    const relaid = new Map(
      respaceSector(
        seats.filter((s) => onLevel.has(s.cid)),
        sector,
        opts,
      ).map((s) => [s.cid, s]),
    )
    setSeats((prev) => prev.map((s) => relaid.get(s.cid) ?? s))
  }

  const deleteSector = (sector: string) => {
    const n = sectorSeats(sector).length
    if (!confirm(`Zmazať sektor „${sector}" a jeho ${n} sedadiel?`)) return
    checkpoint()
    setSeats((prev) =>
      prev.filter((s) => !(s.level === level && s.sector === sector)),
    )
    setSel(null)
  }

  deleteSectorRef.current = deleteSector
  deleteObjectRef.current = deleteObject

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
        layout: buildLayout(seats, objects),
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
          {editable && (
            <div className="flex gap-1">
              <button
                onClick={undo}
                disabled={histSize.undo === 0}
                title="Späť (Ctrl/Cmd+Z)"
                aria-label="Späť"
                className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-40"
              >
                ↶
              </button>
              <button
                onClick={redo}
                disabled={histSize.redo === 0}
                title="Znova (Ctrl/Cmd+Shift+Z)"
                aria-label="Znova"
                className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-40"
              >
                ↷
              </button>
            </div>
          )}
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
            {lv} ({seats.filter((s) => s.level === lv).length}
            {objects.some((o) => o.level === lv) &&
              ` + ${objects.filter((o) => o.level === lv).length} obj.`}
            )
          </button>
        ))}
      </div>

      {editable && (
        <>
          <AddSectorForm
            level={level}
            onLevel={setLevel}
            existingBottom={
              Math.max(
                0,
                ...levelSeats.map((s) => s.y),
                ...levelObjects.map((o) => o.y + o.height),
              ) + 40
            }
            existingSectors={[...new Set(seats.map((s) => s.sector))]}
            onAdd={(gen) => {
              checkpoint()
              setSeats((prev) => [
                ...prev,
                ...gen.map((g) => ({ ...g, cid: nextCid() })),
              ])
            }}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              onClick={() => addObject('stage')}
              className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
            >
              + Pódium
            </button>
            <button
              onClick={() => addObject('area')}
              className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
            >
              + Plocha (státie)
            </button>
            <label className="ml-2 inline-flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={snapOn}
                onChange={(e) => setSnapOn(e.target.checked)}
              />
              Prichytávať k mriežke ({GRID_SIZE})
            </label>
          </div>
        </>
      )}

      <Canvas
        seats={levelSeats}
        objects={levelObjects}
        fitKey={`${seatMapId ?? 'new'}:${level}`}
        preview={preview}
        selection={sel}
        grid={grid}
        viewRef={viewRef}
        onSelect={setSel}
        onGestureStart={checkpoint}
        onMoveSector={
          !editable
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
        onPatchObject={!editable ? undefined : patchObject}
      />

      {editable && selSector && (
        <SectorTools
          sector={selSector}
          seatCount={sectorSeats(selSector).length}
          onDelete={() => deleteSector(selSector)}
          onDuplicate={() => duplicateSector(selSector)}
          onRotate={(deg) => rotateSector(selSector, deg)}
          onRespace={(opts) => respace(selSector, opts)}
          onType={(t) => {
            checkpoint()
            setSeats((prev) =>
              prev.map((s) =>
                s.level === level && s.sector === selSector
                  ? { ...s, seat_type: t }
                  : s,
              ),
            )
          }}
        />
      )}

      {editable && selObject && (
        <ObjectTools
          object={selObject}
          onBeforeEdit={checkpoint}
          onPatch={(patch) => patchObject(selObject.id, patch)}
          onDuplicate={() => duplicateObject(selObject.id)}
          onDelete={() => deleteObject(selObject.id)}
        />
      )}
    </section>
  )
}

function AddSectorForm({
  level,
  onLevel,
  existingBottom,
  existingSectors,
  onAdd,
}: {
  level: string
  onLevel: (l: string) => void
  existingBottom: number
  existingSectors: string[]
  onAdd: (seats: GeneratedSeat[]) => void
}) {
  const [sector, setSector] = useState('')
  const [rows, setRows] = useState('10')
  const [perRow, setPerRow] = useState('20')
  const [style, setStyle] = useState<'alpha' | 'numeric'>('alpha')
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr')
  const [seatGap, setSeatGap] = useState(String(DEFAULT_SEAT_GAP))
  const [rowGap, setRowGap] = useState(String(DEFAULT_ROW_GAP))
  const [curve, setCurve] = useState('0')
  const [warn, setWarn] = useState<string | null>(null)

  const add = () => {
    const sec = sector.trim()
    if (!sec) return
    // '#' is the namespace the event bridge uses for standing areas.
    if (sec.startsWith(areaPricingKey(''))) {
      return setWarn('Názov sektora nesmie začínať znakom „#".')
    }
    if (existingSectors.includes(sec)) {
      return setWarn(`Sektor „${sec}" už existuje.`)
    }
    setWarn(null)
    const gen = generateSeats({
      level,
      sector: sec,
      rows: parseInt(rows, 10) || 0,
      seatsPerRow: parseInt(perRow, 10) || 0,
      rowLabelStyle: style,
      seatNumberDir: dir,
      seatGapX: numOr(seatGap, DEFAULT_SEAT_GAP),
      rowGapY: numOr(rowGap, DEFAULT_ROW_GAP),
      curveDepth: numOr(curve, 0),
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
      <SpacingFields
        seatGap={seatGap}
        rowGap={rowGap}
        curve={curve}
        onSeatGap={setSeatGap}
        onRowGap={setRowGap}
        onCurve={setCurve}
      />
      <button
        onClick={add}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
      >
        Generovať sektor
      </button>
      {warn && <p className="w-full text-xs text-red-600">{warn}</p>}
    </div>
  )
}

/** Row/seat spacing and curvature — shared by the generator and sector tools. */
function SpacingFields({
  seatGap,
  rowGap,
  curve,
  onSeatGap,
  onRowGap,
  onCurve,
}: {
  seatGap: string
  rowGap: string
  curve: string
  onSeatGap: (v: string) => void
  onRowGap: (v: string) => void
  onCurve: (v: string) => void
}) {
  return (
    <>
      <label>
        <span className="mb-1 block text-xs text-gray-600">Rozostup miest</span>
        <input
          value={seatGap}
          onChange={(e) => onSeatGap(e.target.value)}
          type="number"
          min={8}
          className="w-20 rounded border px-2 py-1"
        />
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-600">Rozostup radov</span>
        <input
          value={rowGap}
          onChange={(e) => onRowGap(e.target.value)}
          type="number"
          min={8}
          className="w-20 rounded border px-2 py-1"
        />
      </label>
      <label title="0 = rovné rady; vyššia hodnota ohne rady okolo pódia">
        <span className="mb-1 block text-xs text-gray-600">Zakrivenie</span>
        <input
          value={curve}
          onChange={(e) => onCurve(e.target.value)}
          type="number"
          min={0}
          className="w-20 rounded border px-2 py-1"
        />
      </label>
    </>
  )
}

function ToolButton({
  onClick,
  children,
  danger,
}: {
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs hover:bg-gray-50 ${
        danger ? 'text-red-600 hover:bg-red-50' : ''
      }`}
    >
      {children}
    </button>
  )
}

function SectorTools({
  sector,
  seatCount,
  onDelete,
  onDuplicate,
  onRotate,
  onRespace,
  onType,
}: {
  sector: string
  seatCount: number
  onDelete: () => void
  onDuplicate: () => void
  onRotate: (deg: number) => void
  onRespace: (opts: RespaceOptions) => void
  onType: (t: SeatType) => void
}) {
  const [open, setOpen] = useState(false)
  const [seatGap, setSeatGap] = useState(String(DEFAULT_SEAT_GAP))
  const [rowGap, setRowGap] = useState(String(DEFAULT_ROW_GAP))
  const [curve, setCurve] = useState('0')

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
      <span className="font-medium">
        Sektor {sector}{' '}
        <span className="text-xs font-normal text-gray-500">
          ({seatCount} sedadiel)
        </span>
        :
      </span>
      {(['standard', 'wheelchair', 'blocked'] as const).map((t) => (
        <ToolButton key={t} onClick={() => onType(t)}>
          {t === 'standard'
            ? 'Štandard'
            : t === 'wheelchair'
              ? 'Vozík'
              : 'Blokované'}
        </ToolButton>
      ))}
      <span className="ml-2 text-xs text-gray-500">Otočiť:</span>
      {[-90, -15, 15, 90].map((deg) => (
        <ToolButton key={deg} onClick={() => onRotate(deg)}>
          {deg > 0 ? `+${deg}°` : `${deg}°`}
        </ToolButton>
      ))}
      <ToolButton onClick={onDuplicate}>Duplikovať</ToolButton>
      <ToolButton onClick={() => setOpen((o) => !o)}>
        Rozostupy{open ? ' ▴' : ' ▾'}
      </ToolButton>
      <span className="ml-auto" />
      <ToolButton onClick={onDelete} danger>
        Zmazať sektor
      </ToolButton>
      {open && (
        <div className="flex w-full flex-wrap items-end gap-2 border-t pt-2">
          <SpacingFields
            seatGap={seatGap}
            rowGap={rowGap}
            curve={curve}
            onSeatGap={setSeatGap}
            onRowGap={setRowGap}
            onCurve={setCurve}
          />
          <ToolButton
            onClick={() =>
              onRespace({
                seatGapX: numOr(seatGap, DEFAULT_SEAT_GAP),
                rowGapY: numOr(rowGap, DEFAULT_ROW_GAP),
                curveDepth: numOr(curve, 0),
              })
            }
          >
            Prepočítať sektor
          </ToolButton>
          <p className="w-full text-xs text-gray-500">
            Rady a čísla sedadiel zostanú, zmenia sa len súradnice. Sektor
            zostane ukotvený v ľavom hornom rohu.
          </p>
        </div>
      )}
    </div>
  )
}

function ObjectTools({
  object,
  onBeforeEdit,
  onPatch,
  onDuplicate,
  onDelete,
}: {
  object: MapObject
  /** Called once as a field gains focus, so typing costs one undo step. */
  onBeforeEdit: () => void
  onPatch: (patch: Partial<MapObject>) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border p-2 text-sm">
      <label>
        <span className="mb-1 block text-xs text-gray-600">
          {object.kind === 'stage' ? 'Pódium' : 'Plocha'} — názov
        </span>
        <input
          value={object.label}
          onFocus={onBeforeEdit}
          onChange={(e) => onPatch({ label: e.target.value })}
          className="w-40 rounded border px-2 py-1"
        />
      </label>
      {object.kind === 'area' && (
        <label>
          <span className="mb-1 block text-xs text-gray-600">
            Kapacita (státie)
          </span>
          <input
            type="number"
            min={0}
            value={object.capacity ?? ''}
            placeholder="bez predaja"
            onFocus={onBeforeEdit}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              onPatch({ capacity: Number.isFinite(n) && n > 0 ? n : null })
            }}
            className="w-32 rounded border px-2 py-1"
          />
        </label>
      )}
      <label>
        <span className="mb-1 block text-xs text-gray-600">Otočenie (°)</span>
        <input
          type="number"
          value={Math.round(object.rotation)}
          onFocus={onBeforeEdit}
          onChange={(e) =>
            onPatch({
              rotation: normalizeAngle(parseInt(e.target.value, 10) || 0),
            })
          }
          className="w-20 rounded border px-2 py-1"
        />
      </label>
      <div className="flex items-center gap-2 pb-1">
        {[-90, -15, 15, 90].map((deg) => (
          <ToolButton
            key={deg}
            onClick={() => {
              onBeforeEdit()
              onPatch({ rotation: normalizeAngle(object.rotation + deg) })
            }}
          >
            {deg > 0 ? `+${deg}°` : `${deg}°`}
          </ToolButton>
        ))}
        <ToolButton onClick={onDuplicate}>Duplikovať</ToolButton>
      </div>
      {object.kind === 'area' && (
        <p className="w-full text-xs text-gray-500">
          Plocha s kapacitou sa pri podujatí priradí cenovej kategórii a predáva
          sa na počet — bez konkrétnych sedadiel. Bez kapacity je to len
          orientačný prvok mapy.
        </p>
      )}
      <div className="ml-auto pb-1">
        <ToolButton onClick={onDelete} danger>
          Zmazať
        </ToolButton>
      </div>
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
/** Editor colours for the non-seated objects drawn under the seats. */
const OBJECT_STYLE = {
  stage: { fill: '#475569', stroke: '#94a3b8', text: '#f8fafc' },
  area: { fill: 'rgba(99,102,241,0.18)', stroke: '#818cf8', text: '#c7d2fe' },
  areaSelling: {
    fill: 'rgba(34,197,94,0.16)',
    stroke: '#4ade80',
    text: '#bbf7d0',
  },
} as const

function objectStyle(o: MapObject, preview: boolean) {
  if (o.kind === 'stage') return OBJECT_STYLE.stage
  // In the buyer preview a standing area on sale reads like the green seats.
  return preview && o.capacity ? OBJECT_STYLE.areaSelling : OBJECT_STYLE.area
}

function Canvas({
  seats,
  objects,
  fitKey,
  preview,
  selection,
  grid,
  viewRef,
  onSelect,
  onGestureStart,
  onMoveSector,
  onPatchObject,
}: {
  seats: WorkSeat[]
  objects: WorkObject[]
  /** Changing this refits the view (switching level or opening another map). */
  fitKey: string
  preview: boolean
  selection: Selection
  /** Snap step in SVG units; 0 disables snapping. */
  grid: number
  /** Mirrors the live viewport so the editor can drop objects into view. */
  viewRef: React.MutableRefObject<Viewport | null>
  onSelect: (s: Selection) => void
  /** Fired once when a mutating drag begins, so undo records one step per drag. */
  onGestureStart?: () => void
  onMoveSector?: (sector: string, dx: number, dy: number) => void
  onPatchObject?: (id: string, patch: Partial<MapObject>) => void
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [view, setView] = useState<Viewport>(() =>
    fitViewport(contentBounds(seats), 0),
  )
  const [space, setSpace] = useState(false)
  const [panning, setPanning] = useState(false)
  // Rendered width in CSS px, so the zoom readout can be a real scale factor.
  const [pxWidth, setPxWidth] = useState(0)

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setPxWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Live gesture state lives in refs: pointer moves must not wait for a render.
  const gesture = useRef<
    | { kind: 'pan'; id: number; x: number; y: number; moved: boolean }
    | {
        kind: 'sector'
        id: number
        sector: string
        /** Client position where the drag started; deltas are measured from it
         *  so snapping cannot swallow sub-grid movements. */
        x: number
        y: number
        appliedX: number
        appliedY: number
      }
    | {
        kind: 'object'
        id: number
        objectId: string
        origin: { x: number; y: number }
        startSvg: { x: number; y: number }
      }
    | { kind: 'resize'; id: number; objectId: string; handle: ResizeHandle }
    | {
        kind: 'rotate'
        id: number
        objectId: string
        startAngle: number
        startRotation: number
      }
    | null
  >(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchDist = useRef<number | null>(null)
  const hovering = useRef(false)
  const spaceRef = useRef(false)

  const seatsRef = useRef(seats)
  seatsRef.current = seats
  const objectsRef = useRef(objects)
  objectsRef.current = objects
  const gridRef = useRef(grid)
  gridRef.current = grid

  useEffect(() => {
    viewRef.current = view
  }, [view, viewRef])

  /** Frame the content, matching the container's aspect so nothing letterboxes. */
  const fit = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect()
    const aspect = rect && rect.height > 0 ? rect.width / rect.height : 0
    setView(
      fitViewport(
        contentBounds([
          ...seatsRef.current,
          ...objectPoints(objectsRef.current),
        ]),
        aspect,
      ),
    )
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

  // Refit when the map or level changes, and once content first appears.
  const contentCount = seats.length + objects.length
  const hadContent = useRef(contentCount > 0)
  useEffect(() => {
    hadContent.current = seatsRef.current.length + objectsRef.current.length > 0
    fit()
  }, [fitKey, fit])
  useEffect(() => {
    if (!hadContent.current && contentCount > 0) fit()
    hadContent.current = contentCount > 0
  }, [contentCount, fit])

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

  // A press that never moves is only a selection, so the undo checkpoint waits
  // for the first actual change — otherwise clicking a seat would burn a step
  // and "undo" would appear to do nothing.
  const edited = useRef(false)
  const beginEdit = () => {
    if (edited.current) return
    edited.current = true
    onGestureStart?.()
  }

  /** Shared opener for the object gestures: capture the pointer and select. */
  const grabObject = (e: React.PointerEvent, o: WorkObject) => {
    onSelect({ kind: 'object', id: o.id })
    edited.current = false
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const color = (s: WorkSeat) =>
    preview
      ? s.seat_type === 'blocked'
        ? '#9ca3af'
        : '#22c55e'
      : SEAT_COLORS[s.seat_type]

  const cursor = space || panning ? 'grabbing' : 'default'
  const editing = !!onPatchObject
  const selObjectId = selection?.kind === 'object' ? selection.id : null
  const selSector = selection?.kind === 'sector' ? selection.sector : null
  const selected = objects.find((o) => o.id === selObjectId) ?? null
  // Handles are sized off the viewport so they stay grabbable at any zoom.
  const hs = view.w / 90
  // 100% = one canvas unit per CSS pixel.
  const zoomPercent = pxWidth > 0 ? Math.round((pxWidth / view.w) * 100) : 100

  return (
    <div className="relative rounded-md border bg-ink-950">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <span
          className="mr-1 rounded border border-white/20 bg-black/40 px-2 py-1 text-xs tabular-nums text-white/80"
          title="Priblíženie"
        >
          {zoomPercent}%
        </span>
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
          // A seat or object sets its own gesture first (events bubble target-up).
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
          const g2 = gridRef.current

          if (g.kind === 'pan') {
            const scale = pixelsPerUnit(svg)
            const dx = (e.clientX - g.x) / scale
            const dy = (e.clientY - g.y) / scale
            g.x = e.clientX
            g.y = e.clientY
            if (dx !== 0 || dy !== 0) g.moved = true
            setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }))
            return
          }

          if (g.kind === 'sector') {
            // Measure from the press, snap the total, then apply the remainder —
            // otherwise every sub-grid move would be rounded away and lost.
            const scale = pixelsPerUnit(svg)
            const wantX = snap((e.clientX - g.x) / scale, g2)
            const wantY = snap((e.clientY - g.y) / scale, g2)
            const dx = wantX - g.appliedX
            const dy = wantY - g.appliedY
            if (dx === 0 && dy === 0) return
            beginEdit()
            g.appliedX = wantX
            g.appliedY = wantY
            onMoveSector?.(g.sector, dx, dy)
            return
          }

          const target = objectsRef.current.find((o) => o.id === g.objectId)
          if (!target || !onPatchObject) return
          const pt = clientToSvg(svg, e.clientX, e.clientY)
          beginEdit()

          if (g.kind === 'object') {
            onPatchObject(g.objectId, {
              x: snap(g.origin.x + pt.x - g.startSvg.x, g2),
              y: snap(g.origin.y + pt.y - g.startSvg.y, g2),
            })
          } else if (g.kind === 'resize') {
            const { x, y, width, height } = resizeObject(
              target,
              g.handle,
              pt,
              g2,
            )
            onPatchObject(g.objectId, { x, y, width, height })
          } else {
            const delta = angleFromCenter(target, pt) - g.startAngle
            const raw = g.startRotation + delta
            onPatchObject(g.objectId, {
              // With the grid on, rotation clicks into 15° steps.
              rotation: normalizeAngle(
                g2 > 0 ? Math.round(raw / 15) * 15 : raw,
              ),
            })
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

        {/* Stage and areas sit under the seats — they are the room, not the goods. */}
        {objects.map((o) => {
          const c = objectCenter(o)
          const st = objectStyle(o, preview)
          const isSel = o.id === selObjectId
          const fontSize = Math.max(10, Math.min(20, o.height / 4))
          return (
            <g key={o.id} transform={`rotate(${o.rotation} ${c.x} ${c.y})`}>
              <rect
                x={o.x}
                y={o.y}
                width={o.width}
                height={o.height}
                rx={4}
                fill={st.fill}
                stroke={isSel ? '#fff' : st.stroke}
                strokeWidth={isSel ? 2.5 : 1.5}
                style={{
                  cursor:
                    space || panning
                      ? 'grabbing'
                      : editing
                        ? 'move'
                        : 'default',
                }}
                onPointerDown={(e) => {
                  if (pointers.current.size >= 1) return // pinch starting
                  if (spaceRef.current || e.button === 1)
                    return startPan(e, false)
                  if (!editing) return onSelect({ kind: 'object', id: o.id })
                  grabObject(e, o)
                  const svg = svgRef.current
                  gesture.current = {
                    kind: 'object',
                    id: e.pointerId,
                    objectId: o.id,
                    origin: { x: o.x, y: o.y },
                    startSvg: svg
                      ? clientToSvg(svg, e.clientX, e.clientY)
                      : { x: 0, y: 0 },
                  }
                }}
              >
                <title>
                  {o.label}
                  {o.capacity ? ` — kapacita ${o.capacity}` : ''}
                </title>
              </rect>
              <text
                x={c.x}
                y={c.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={fontSize}
                fill={st.text}
                style={{ pointerEvents: 'none' }}
              >
                {o.label}
                {o.capacity ? ` · ${o.capacity} miest` : ''}
              </text>
            </g>
          )
        })}

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
              onSelect({ kind: 'sector', sector: s.sector })
              if (!onMoveSector) return
              edited.current = false
              svgRef.current?.setPointerCapture(e.pointerId)
              gesture.current = {
                kind: 'sector',
                id: e.pointerId,
                sector: s.sector,
                x: e.clientX,
                y: e.clientY,
                appliedX: 0,
                appliedY: 0,
              }
            }}
          >
            <title>{`${s.sector} ${s.row_label}${s.seat_number}`}</title>
          </circle>
        ))}

        {/* Resize + rotate handles for the selected object, drawn last (on top). */}
        {editing && selected && (
          <ObjectHandles
            object={selected}
            size={hs}
            onGrab={(e, handle) => {
              if (pointers.current.size >= 1) return
              if (spaceRef.current || e.button === 1) return startPan(e, false)
              grabObject(e, selected)
              const svg = svgRef.current
              const pt = svg
                ? clientToSvg(svg, e.clientX, e.clientY)
                : { x: 0, y: 0 }
              gesture.current =
                handle === 'rotate'
                  ? {
                      kind: 'rotate',
                      id: e.pointerId,
                      objectId: selected.id,
                      startAngle: angleFromCenter(selected, pt),
                      startRotation: selected.rotation,
                    }
                  : {
                      kind: 'resize',
                      id: e.pointerId,
                      objectId: selected.id,
                      handle,
                    }
            }}
          />
        )}
      </svg>
    </div>
  )
}

const HANDLE_ORDER: ResizeHandle[] = ['nw', 'ne', 'se', 'sw']
const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  ne: 'nesw-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
}

function ObjectHandles({
  object,
  size,
  onGrab,
}: {
  object: MapObject
  size: number
  onGrab: (e: React.PointerEvent, handle: ResizeHandle | 'rotate') => void
}) {
  const corners = objectCorners(object)
  const c = objectCenter(object)
  // The rotate grip floats off the top edge, along the object's own "up".
  const top = {
    x: (corners[0].x + corners[1].x) / 2,
    y: (corners[0].y + corners[1].y) / 2,
  }
  const len = Math.hypot(top.x - c.x, top.y - c.y) || 1
  const grip = {
    x: top.x + ((top.x - c.x) / len) * size * 3,
    y: top.y + ((top.y - c.y) / len) * size * 3,
  }
  return (
    <g>
      <line
        x1={top.x}
        y1={top.y}
        x2={grip.x}
        y2={grip.y}
        stroke="#fff"
        strokeWidth={size / 6}
        style={{ pointerEvents: 'none' }}
      />
      <circle
        cx={grip.x}
        cy={grip.y}
        r={size / 1.6}
        fill="#fff"
        stroke="#111827"
        strokeWidth={size / 8}
        style={{ cursor: 'grab' }}
        onPointerDown={(e) => onGrab(e, 'rotate')}
      >
        <title>Otočiť</title>
      </circle>
      {HANDLE_ORDER.map((h, i) => (
        <rect
          key={h}
          x={corners[i].x - size / 2}
          y={corners[i].y - size / 2}
          width={size}
          height={size}
          fill="#fff"
          stroke="#111827"
          strokeWidth={size / 8}
          style={{ cursor: HANDLE_CURSOR[h] }}
          onPointerDown={(e) => onGrab(e, h)}
        >
          <title>Zmeniť veľkosť</title>
        </rect>
      ))}
    </g>
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

/**
 * Bounding-box shapes + objects per level for the buyer render (stored in the
 * layout jsonb). A level counts if it holds seats *or* objects — a standing-only
 * floor has no seats at all.
 */
function buildLayout(seats: WorkSeat[], objects: WorkObject[]): SeatMapLayout {
  const keys = [
    ...new Set([...seats.map((s) => s.level), ...objects.map((o) => o.level)]),
  ].sort()

  const levels = keys.map((key, order) => {
    const ls = seats.filter((s) => s.level === key)
    const os = objects.filter((o) => o.level === key)

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

    // The canvas has to cover rotated objects too, hence their corner points.
    const pts = [...ls, ...objectPoints(os)]
    return {
      key,
      name: key,
      order,
      canvas: {
        width: Math.max(0, ...pts.map((p) => p.x)) + 40,
        height: Math.max(0, ...pts.map((p) => p.y)) + 40,
      },
      shapes,
      objects: os.map(({ level: _level, ...o }) => o),
    }
  })
  return { version: LAYOUT_VERSION, levels }
}
