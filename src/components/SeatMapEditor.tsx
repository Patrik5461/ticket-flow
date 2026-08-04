/**
 * The seat-map editor: canvas, sector and object tools, undo/redo, save.
 *
 * Shared by the organizer's own venues (/app/venues) and the platform admin's
 * library halls (/admin/haly). The two differ only in WHO may write and WHAT
 * the write is allowed to touch, so the data calls arrive as `api` rather than
 * being imported here — the component never decides authorization, it only
 * renders what the caller's server functions permit.
 *
 * Geometry maths lives in src/lib/seating.ts; the drawing of the non-seated
 * objects is shared with the buyer's picker via MapObjectShape.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GRID_SIZE,
  LAYOUT_VERSION,
  angleFromCenter,
  orderedLevels,
  sectorNameError,
  centroid,
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
  SEAT_R,
  zoomPercentOf,
  rotatePoints,
  snap,
} from '../lib/seating'
import { useCanvasViewport } from '../lib/use-canvas-viewport'
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
import {
  AreaHatchPattern,
  MapObjectShape,
  isDecoration,
  isStandingArea,
} from './MapObjectShape'
import type { SeatMapDetail, SaveSeatMapInput } from '../server/venues'

/**
 * The three calls the editor makes. Both callers hand over their own server
 * functions: the organizer's own-venue ones, or the admin's library ones.
 */
export interface SeatMapEditorApi {
  get: (seatMapId: string) => Promise<SeatMapDetail | { error: string }>
  save: (input: SaveSeatMapInput) => Promise<{ id: string } | { error: string }>
  remove: (seatMapId: string) => Promise<{ ok: true } | { error: string }>
}

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

export function SeatMapEditor({
  api,
  venueId,
  seatMapId,
  readOnly,
  readOnlyNote,
  inUseNote,
  onClose,
}: {
  /** Where the map is read from and written to — see SeatMapEditorApi. */
  api: SeatMapEditorApi
  venueId: string
  seatMapId: string | null
  /** The editor becomes a viewer — no tools, no save, no delete. */
  readOnly: boolean
  /** Why it is read-only, shown in place of the editing tools. */
  readOnlyNote?: string
  /** Why a map bound to an event cannot be restructured; the way out differs
   *  for an organizer (duplicate it) and for an admin (wait for the event). */
  inUseNote?: string
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
  /**
   * An existing map is only editable once it has actually arrived. Saving what
   * a failed load left behind would write an empty map over a real one — the
   * editor always writes the whole map, so "nothing loaded" means "delete
   * everything".
   */
  const [loaded, setLoaded] = useState(seatMapId === null)
  /** True once anything has been changed, for the leave-without-saving guard. */
  const [dirty, setDirty] = useState(false)
  /**
   * The map's updated_at at load time, sent back on save so the server can
   * refuse to overwrite somebody else's newer version.
   */
  const [version, setVersion] = useState<string | null>(null)
  /**
   * level → its stored order, as loaded. Levels keep the order the map was
   * saved with instead of being re-sorted alphabetically on every save, which
   * used to shuffle the buyer's floor tabs (parter/balkón).
   */
  const [levelSeed, setLevelSeed] = useState<Record<string, number>>({})
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

  // Every mutation in this component goes through checkpoint() first, which
  // makes it the one honest place to notice that the map now differs from what
  // was loaded.
  const checkpoint = useCallback(() => {
    const h = history.current
    h.past.push(docRef.current)
    if (h.past.length > HISTORY_LIMIT) h.past.shift()
    h.future = []
    setDirty(true)
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
    void api
      .get(seatMapId)
      .then((res) => {
        if ('error' in res) return setError(res.error)
        setName(res.name)
        setInUse(res.inUse)
        setVersion(res.updatedAt)
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
        // Remember the stored order of every level so a save preserves it.
        const seed: Record<string, number> = {}
        for (const lv of layout.levels) seed[lv.key] = lv.order
        for (const s of res.seats)
          if (!(s.level in seed)) seed[s.level] = s.levelOrder
        setLevelSeed(seed)
        const first = res.seats[0]?.level ?? layout.levels[0]?.key
        if (first) setLevel(first)
        resetHistory()
        setDirty(false)
        setLoaded(true)
      })
      .catch((e: unknown) =>
        setError(
          `Mapu sa nepodarilo načítať: ${
            e instanceof Error ? e.message : 'neznáma chyba'
          }`,
        ),
      )
  }, [seatMapId])

  // Known levels keep their stored order; levels created in this session sort
  // after them by name.
  const levels = useMemo(
    () =>
      orderedLevels(
        [...seats.map((s) => s.level), ...objects.map((o) => o.level), level],
        levelSeed,
      ),
    [seats, objects, level, levelSeed],
  )

  // Memoized so the canvas can memoize below it: a fresh array every render
  // would make every sector group look changed and undo the whole point.
  const levelSeats = useMemo(
    () => seats.filter((s) => s.level === level),
    [seats, level],
  )
  const levelObjects = useMemo(
    () => objects.filter((o) => o.level === level),
    [objects, level],
  )
  // One gate for every mutation in this component — the tool panels, the canvas
  // drag handlers and the Delete key all key off it. `loaded` belongs here: an
  // editor showing a map that never arrived must not be able to write one.
  const editable = !preview && !inUse && !readOnly && loaded

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

  /**
   * Rename a sector on this level. Returns the reason it was refused, or null.
   *
   * The name is checked against every sector on the map, not just this level's:
   * event_sector_pricing keys a price by sector NAME alone, so two sectors
   * sharing one would silently share a price and a capacity count.
   */
  const renameSector = (from: string, to: string): string | null => {
    const next = to.trim()
    if (!next || next === from) return null
    const problem = sectorNameError(
      next,
      seats.map((s) => s.sector),
    )
    if (problem) return problem
    checkpoint()
    setSeats((prev) =>
      prev.map((s) =>
        s.level === level && s.sector === from ? { ...s, sector: next } : s,
      ),
    )
    setSel({ kind: 'sector', sector: next })
    return null
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

  // A map is minutes to hours of work and lives only in this component until it
  // is saved, so a reload or a closed tab has to ask first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const close = () => {
    if (dirty && !confirm('Máte neuložené zmeny. Naozaj zavrieť bez uloženia?'))
      return
    onClose()
  }

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
    const res = await api.save({
      seatMapId,
      venueId,
      name: name.trim() || 'Mapa',
      // Sent back exactly as loaded: the server refuses the write if the map
      // has been saved by somebody else in the meantime.
      updatedAt: version,
      layout: buildLayout(seats, objects, levels),
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
    })
    if ('error' in res) return setError(res.error)
    onClose()
  }

  const removeMap = async () => {
    if (!seatMapId || !confirm('Zmazať túto mapu?')) return
    const res = await api.remove(seatMapId)
    if ('error' in res) return setError(res.error)
    onClose()
  }

  return (
    <section className="space-y-4 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {readOnly ? (
          <h2 className="px-1 py-2 text-lg font-semibold">{name}</h2>
        ) : (
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setDirty(true)
            }}
            className="rounded-md border px-3 py-2 text-lg font-semibold"
          />
        )}
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
          {seatMapId && !inUse && !readOnly && loaded && (
            <button
              onClick={removeMap}
              className="rounded-md border px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              Zmazať
            </button>
          )}
          {!readOnly && (
            <button
              onClick={save}
              disabled={saving || inUse || !loaded}
              className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              title={
                inUse
                  ? 'Mapa sa používa v podujatí'
                  : !loaded
                    ? 'Mapa sa ešte nenačítala'
                    : ''
              }
            >
              {saving ? 'Ukladám…' : 'Uložiť'}
            </button>
          )}
          <button
            onClick={close}
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

      {readOnly
        ? readOnlyNote && (
            <p className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
              {readOnlyNote}
            </p>
          )
        : inUse && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              {inUseNote ??
                'Mapa sa používa v podujatí — štruktúru nemožno meniť. Vytvorte kópiu.'}
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
            // Across every level on purpose, though the DB constraint is
            // per level: a price is mapped to a sector by NAME in
            // event_sector_pricing, so two sectors called "A" on different
            // floors would share one price and one capacity count.
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
          key={selSector}
          sector={selSector}
          seatCount={sectorSeats(selSector).length}
          onRename={(to) => renameSector(selSector, to)}
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
    // Same rules as the rename, from one definition: '#' is the namespace the
    // event bridge uses for standing areas, and names are unique per map.
    const problem = sectorNameError(sec, existingSectors)
    if (problem) return setWarn(problem)
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
  onRename,
  onDelete,
  onDuplicate,
  onRotate,
  onRespace,
  onType,
}: {
  sector: string
  seatCount: number
  /** Returns the reason the rename was refused, or null when it went through. */
  onRename: (to: string) => string | null
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
  const [draftName, setDraftName] = useState(sector)
  const [renameWarn, setRenameWarn] = useState<string | null>(null)

  const rename = () => setRenameWarn(onRename(draftName))

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
      <label className="font-medium">
        Sektor{' '}
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') rename()
            if (e.key === 'Escape') setDraftName(sector)
          }}
          title="Premenovať sektor"
          className="w-28 rounded border px-2 py-1 font-medium"
        />{' '}
        <span className="text-xs font-normal text-gray-500">
          ({seatCount} sedadiel)
        </span>
      </label>
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
      {renameWarn && (
        <p className="w-full text-xs text-red-600">{renameWarn}</p>
      )}
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
  // Pan / zoom / pinch / fit are shared with the buyer map; only the editing
  // gestures below are specific to this canvas.
  const points = useMemo(
    () => [...seats, ...objectPoints(objects)],
    [seats, objects],
  )
  const vp = useCanvasViewport({
    points,
    fitKey,
    spacePan: true,
    // A press on empty canvas that never moved clears the selection.
    onTap: (target) => {
      if (target === null) onSelect(null)
    },
  })
  const { view } = vp

  const objectsRef = useRef(objects)
  objectsRef.current = objects
  const gridRef = useRef(grid)
  gridRef.current = grid
  /** The sector being dragged and how far, until the drag is committed. */
  const [drag, setDrag] = useState<{
    sector: string
    dx: number
    dy: number
  } | null>(null)

  // Seats are drawn one <g> per sector so a drag can move the whole group with
  // a transform, and so React skips the sectors whose props did not change.
  const bySector = useMemo(() => {
    const groups = new Map<string, WorkSeat[]>()
    for (const s of seats) {
      const arr = groups.get(s.sector)
      if (arr) arr.push(s)
      else groups.set(s.sector, [s])
    }
    return [...groups.entries()]
  }, [seats])

  useEffect(() => {
    viewRef.current = view
  }, [view, viewRef])

  // A press that never moves is only a selection, so the undo checkpoint waits
  // for the first actual change — otherwise clicking a seat would burn a step
  // and "undo" would appear to do nothing.
  const edited = useRef(false)
  const beginEdit = () => {
    if (edited.current) return
    edited.current = true
    onGestureStart?.()
  }

  // Stable identity, so React.memo can skip the sector groups that did not
  // change: an inline handler would differ on every render and defeat it.
  const seatDownRef = useRef<(e: React.PointerEvent, sector: string) => void>(
    () => {},
  )
  seatDownRef.current = (e, sector) => {
    if (vp.otherPointerDown()) return // pinch starting
    if (vp.spaceRef.current || e.button === 1) return vp.startPan(e)
    onSelect({ kind: 'sector', sector })
    if (!onMoveSector) return
    edited.current = false
    dragSector(e, sector)
  }
  const onSeatDown = useCallback(
    (e: React.PointerEvent, sector: string) => seatDownRef.current(e, sector),
    [],
  )

  const grabbing = vp.space || vp.panning
  const editing = !!onPatchObject
  const selObjectId = selection?.kind === 'object' ? selection.id : null
  const selSector = selection?.kind === 'sector' ? selection.sector : null
  const selected = objects.find((o) => o.id === selObjectId) ?? null
  // Handles are sized off the viewport so they stay grabbable at any zoom.
  const hs = view.w / 90
  const zoomPercent = zoomPercentOf(view.w, vp.pxWidth)

  /**
   * Drag a sector: measure from the press so snapping cannot eat small moves.
   *
   * The drag only moves the sector's <g> by a transform; the seats themselves
   * are rewritten once, on release. Rewriting them per pointermove meant a new
   * array of every seat on the map on every frame — on an 11 604-seat arena
   * that is a stall per mouse move, and the sectors that are not being dragged
   * were re-rendered too.
   */
  const dragSector = (e: React.PointerEvent, sector: string) => {
    const startX = e.clientX
    const startY = e.clientY
    let dx = 0
    let dy = 0
    vp.claim(
      e,
      (ev) => {
        const g = gridRef.current
        const upp = vp.unitsPerPixel()
        const nextX = snap((ev.clientX - startX) * upp, g)
        const nextY = snap((ev.clientY - startY) * upp, g)
        if (nextX === dx && nextY === dy) return
        beginEdit()
        dx = nextX
        dy = nextY
        setDrag({ sector, dx, dy })
      },
      () => {
        setDrag(null)
        if (dx !== 0 || dy !== 0) onMoveSector?.(sector, dx, dy)
      },
    )
  }

  return (
    <div className="relative rounded-md border bg-ink-950">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <span
          className="mr-1 rounded border border-white/20 bg-black/40 px-2 py-1 text-xs tabular-nums text-white/80"
          title="Priblíženie"
        >
          {zoomPercent}%
        </span>
        <CanvasButton onClick={() => vp.zoomBy(1 / 1.3)} title="Priblížiť">
          +
        </CanvasButton>
        <CanvasButton onClick={() => vp.zoomBy(1.3)} title="Oddialiť">
          −
        </CanvasButton>
        <CanvasButton onClick={vp.fit} title="Prispôsobiť obrazovke">
          ⤢
        </CanvasButton>
      </div>

      <svg
        ref={vp.svgRef}
        viewBox={vp.viewBox}
        className="h-[26rem] w-full touch-none select-none"
        style={{ cursor: grabbing ? 'grabbing' : 'default' }}
        {...vp.handlers}
      >
        <defs>
          <AreaHatchPattern />
        </defs>

        {/* Catches presses on empty space so panning works away from seats. */}
        <rect
          x={view.x}
          y={view.y}
          width={view.w}
          height={view.h}
          fill="transparent"
        />

        {/* Stage, areas and decorations sit under the seats — they are the room,
            not the goods. Walls, doors, captions and icons are drawn but never
            grabbed: they only orient the buyer. */}
        {objects.map((o) => {
          const st = objectStyle(o, preview)
          const isSel = o.id === selObjectId
          // Standing areas sell by quantity, never by clicking a spot on them —
          // hatched and dashed so they do not read as one big clickable seat.
          const standing = isStandingArea(o)
          return (
            <MapObjectShape
              key={o.id}
              o={o}
              selected={isSel}
              standing={standing}
              fill={st.fill}
              stroke={st.stroke}
              textColor={st.text}
              labelSuffix={o.capacity ? ` · ${o.capacity} miest` : ''}
              cursor={grabbing ? 'grabbing' : editing ? 'move' : 'default'}
              onPointerDown={(e) => {
                if (vp.otherPointerDown()) return // pinch starting
                if (vp.spaceRef.current || e.button === 1) return vp.startPan(e)
                onSelect({ kind: 'object', id: o.id })
                if (!onPatchObject) return
                edited.current = false
                const origin = { x: o.x, y: o.y }
                const startSvg = vp.toSvg(e.clientX, e.clientY)
                vp.claim(e, (ev) => {
                  const pt = vp.toSvg(ev.clientX, ev.clientY)
                  const g = gridRef.current
                  beginEdit()
                  onPatchObject(o.id, {
                    x: snap(origin.x + pt.x - startSvg.x, g),
                    y: snap(origin.y + pt.y - startSvg.y, g),
                  })
                })
              }}
            >
              <title>
                {o.label}
                {o.capacity
                  ? ` — kapacita ${o.capacity}, kupuje sa počtom v paneli vpravo, nie klikom na mapu`
                  : ''}
              </title>
            </MapObjectShape>
          )
        })}

        {bySector.map(([sector, group]) => (
          <SectorSeats
            key={sector}
            sector={sector}
            seats={group}
            preview={preview}
            selected={selSector === sector}
            cursor={grabbing ? 'grabbing' : onMoveSector ? 'move' : 'pointer'}
            offset={drag?.sector === sector ? drag : null}
            onPointerDown={onSeatDown}
          />
        ))}

        {/* Resize + rotate handles for the selected object, drawn last (on top). */}
        {editing && selected && !isDecoration(selected) && (
          <ObjectHandles
            object={selected}
            size={hs}
            onGrab={(e, handle) => {
              if (vp.otherPointerDown()) return
              if (vp.spaceRef.current || e.button === 1) return vp.startPan(e)
              onSelect({ kind: 'object', id: selected.id })
              edited.current = false
              const pt = vp.toSvg(e.clientX, e.clientY)
              if (handle === 'rotate') {
                const startAngle = angleFromCenter(selected, pt)
                const startRotation = selected.rotation
                vp.claim(e, (ev) => {
                  const live = objectsRef.current.find(
                    (o) => o.id === selected.id,
                  )
                  if (!live) return
                  const g = gridRef.current
                  const raw =
                    startRotation +
                    (angleFromCenter(live, vp.toSvg(ev.clientX, ev.clientY)) -
                      startAngle)
                  beginEdit()
                  onPatchObject(selected.id, {
                    // With the grid on, rotation clicks into 15° steps.
                    rotation: normalizeAngle(
                      g > 0 ? Math.round(raw / 15) * 15 : raw,
                    ),
                  })
                })
                return
              }
              vp.claim(e, (ev) => {
                const live = objectsRef.current.find(
                  (o) => o.id === selected.id,
                )
                if (!live) return
                const { x, y, width, height } = resizeObject(
                  live,
                  handle,
                  vp.toSvg(ev.clientX, ev.clientY),
                  gridRef.current,
                )
                beginEdit()
                onPatchObject(selected.id, { x, y, width, height })
              })
            }}
          />
        )}
      </svg>
    </div>
  )
}

/**
 * One sector's seats, as a group that can be moved with a transform.
 *
 * Memoized on purpose: the big halls in the library run to five figures of
 * seats, and without this every pointermove anywhere on the canvas re-rendered
 * all of them. Dragging a sector now re-renders only that sector (its `offset`
 * changed) and moving an object re-renders none of them.
 *
 * There is one <title> for the whole sector rather than one per seat — ten
 * thousand tooltip nodes cost real memory and say nothing the sector tools do
 * not already show.
 */
const SectorSeats = memo(function SectorSeats({
  sector,
  seats,
  preview,
  selected,
  cursor,
  offset,
  onPointerDown,
}: {
  sector: string
  seats: WorkSeat[]
  preview: boolean
  selected: boolean
  cursor: string
  /** Live drag displacement, applied without touching the seat coordinates. */
  offset: { dx: number; dy: number } | null
  onPointerDown: (e: React.PointerEvent, sector: string) => void
}) {
  return (
    <g
      transform={offset ? `translate(${offset.dx} ${offset.dy})` : undefined}
      style={{ cursor }}
      onPointerDown={(e) => onPointerDown(e, sector)}
    >
      <title>{`Sektor ${sector} — ${seats.length} sedadiel`}</title>
      {seats.map((s) => (
        <circle
          key={s.cid}
          cx={s.x}
          cy={s.y}
          r={SEAT_R}
          fill={
            preview
              ? s.seat_type === 'blocked'
                ? '#9ca3af'
                : '#22c55e'
              : SEAT_COLORS[s.seat_type]
          }
          stroke={selected ? '#fff' : 'none'}
          strokeWidth={selected ? 1.5 : 0}
        />
      ))}
    </g>
  )
})

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
function buildLayout(
  seats: WorkSeat[],
  objects: WorkObject[],
  /** Level keys in the order the editor shows them — see `levels`. */
  levelOrder: string[],
): SeatMapLayout {
  const present = new Set([
    ...seats.map((s) => s.level),
    ...objects.map((o) => o.level),
  ])
  // Follow the editor's order (which starts from the map's stored order) rather
  // than re-sorting alphabetically; anything unknown to it goes last.
  const keys = [
    ...levelOrder.filter((k) => present.has(k)),
    ...[...present].filter((k) => !levelOrder.includes(k)).sort(),
  ]

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
