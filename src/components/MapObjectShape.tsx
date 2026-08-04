/**
 * One drawing of the non-seated map objects, shared by the organizer's editor
 * and the buyer's seat picker so a hall looks the same on both sides.
 *
 * Presentation only — no geometry maths (that lives in src/lib/seating.ts) and
 * no data shaping. `kind` is read as a string on purpose: the layout may already
 * carry decorative kinds ('wall' | 'door' | 'text' | 'icon' | 'shape') that the
 * typed union does not name yet, and a decoration must never fall back to
 * looking like a sellable area.
 *
 * Drawing rules:
 * - 'stage'      → ellipse (that is what it is in the source halls)
 * - 'wall/door'  → a thin line, never a filled block. MIN_OBJECT_SIZE inflates a
 *                  14 px wall to 20, so the line thickness is capped and drawn
 *                  down the middle of the box instead of filling it.
 * - 'text'       → a caption with no fill and no outline
 * - 'icon'       → a small ring marker with a caption
 * - 'shape'      → a plain outline, no hatching (it is scenery, not stock)
 * - 'area'       → a rectangle; hatched + dashed when it sells by quantity
 */

import { objectCenter } from '../lib/seating'
import type { MapObject } from '../lib/seating'

export const AREA_HATCH_ID = 'areaHatch'

/** The hatch used to say "this block is not clicked". Render once per <svg>. */
export function AreaHatchPattern({ color = '#818cf8' }: { color?: string }) {
  return (
    <pattern
      id={AREA_HATCH_ID}
      width={10}
      height={10}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <line
        x1={0}
        y1={0}
        x2={0}
        y2={10}
        stroke={color}
        strokeWidth={2}
        opacity={0.5}
      />
    </pattern>
  )
}

const DECORATION = new Set(['wall', 'door', 'text', 'icon', 'shape'])

/** True for orientation elements that are never sold and never clicked. */
export function isDecoration(o: MapObject): boolean {
  return DECORATION.has(o.kind)
}

/** True for a capacity area: bought by quantity in the panel, not by clicking. */
export function isStandingArea(o: MapObject): boolean {
  return (o.kind as string) === 'area' && !!o.capacity
}

export const AREA_HINT = 'počet zadáte v paneli vpravo'

export function MapObjectShape({
  o,
  fill,
  stroke,
  textColor,
  selected = false,
  standing = false,
  showHint = true,
  labelSuffix = '',
  cursor,
  onPointerDown,
  children,
}: {
  o: MapObject
  fill: string
  stroke: string
  textColor: string
  selected?: boolean
  /** Sells by quantity → hatched, dashed and captioned. */
  standing?: boolean
  showHint?: boolean
  labelSuffix?: string
  cursor?: string
  onPointerDown?: (e: React.PointerEvent) => void
  /** e.g. a <title> tooltip from the caller. */
  children?: React.ReactNode
}) {
  const c = objectCenter(o)
  const kind = o.kind as string
  const fontSize = Math.max(10, Math.min(20, o.height / 4))
  const roomForHint = o.height >= fontSize * 3.4
  const interactive = !!onPointerDown && !isDecoration(o)
  const pointer = {
    pointerEvents: interactive ? 'all' : 'none',
    cursor,
  } as const

  const label = (
    y: number,
    text: string,
    size = fontSize,
    color = textColor,
    weight?: number,
  ) => (
    <text
      x={c.x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={size}
      fontWeight={weight}
      fill={color}
      style={{ pointerEvents: 'none' }}
    >
      {text}
    </text>
  )

  const wrap = (content: React.ReactNode) => (
    <g transform={`rotate(${o.rotation} ${c.x} ${c.y})`}>{content}</g>
  )

  // ---- decorations -------------------------------------------------------
  if (kind === 'text') {
    const size = Math.max(10, Math.min(26, o.height * 0.7))
    return wrap(label(c.y, o.label, size, textColor, 600))
  }

  if (kind === 'wall' || kind === 'door') {
    const horizontal = o.width >= o.height
    const thin = Math.max(2, Math.min(6, Math.min(o.width, o.height) * 0.35))
    const [x1, y1, x2, y2] = horizontal
      ? [o.x, c.y, o.x + o.width, c.y]
      : [c.x, o.y, c.x, o.y + o.height]
    return wrap(
      <>
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={stroke}
          strokeWidth={thin}
          strokeLinecap="round"
          strokeDasharray={
            kind === 'door' ? `${thin * 3} ${thin * 2}` : undefined
          }
          opacity={kind === 'door' ? 0.9 : 0.75}
          style={{ pointerEvents: 'none' }}
        />
        {kind === 'door' && o.label && (
          <text
            x={c.x}
            y={horizontal ? c.y - thin - 4 : c.y}
            textAnchor="middle"
            dominantBaseline={horizontal ? 'auto' : 'middle'}
            fontSize={Math.max(8, Math.min(14, thin * 3))}
            fill={textColor}
            style={{ pointerEvents: 'none' }}
          >
            {o.label}
          </text>
        )}
      </>,
    )
  }

  if (kind === 'icon') {
    const r = Math.max(4, Math.min(o.width, o.height) / 2)
    return wrap(
      <>
        <circle
          cx={c.x}
          cy={c.y}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          style={{ pointerEvents: 'none' }}
        />
        {o.label && label(c.y + r + 8, o.label, Math.max(8, r * 0.8))}
      </>,
    )
  }

  if (kind === 'shape') {
    return wrap(
      <>
        <rect
          x={o.x}
          y={o.y}
          width={o.width}
          height={o.height}
          rx={2}
          fill="none"
          stroke={stroke}
          strokeWidth={1.25}
          opacity={0.7}
          style={{ pointerEvents: 'none' }}
        />
        {o.label && label(c.y, o.label, Math.max(9, fontSize * 0.8))}
      </>,
    )
  }

  // ---- stage and sellable areas ------------------------------------------
  const stage = kind === 'stage'
  const body = stage ? (
    <ellipse
      cx={c.x}
      cy={c.y}
      rx={o.width / 2}
      ry={o.height / 2}
      fill={fill}
      stroke={selected ? '#fff' : stroke}
      strokeWidth={selected ? 2.5 : 1.5}
      style={pointer}
      onPointerDown={onPointerDown}
    >
      {children}
    </ellipse>
  ) : (
    <rect
      x={o.x}
      y={o.y}
      width={o.width}
      height={o.height}
      rx={4}
      fill={fill}
      stroke={selected ? '#fff' : stroke}
      strokeWidth={selected ? 2.5 : 1.5}
      strokeDasharray={standing && !selected ? '7 4' : undefined}
      style={pointer}
      onPointerDown={onPointerDown}
    >
      {children}
    </rect>
  )

  return wrap(
    <>
      {body}
      {standing && (
        <rect
          x={o.x}
          y={o.y}
          width={o.width}
          height={o.height}
          rx={4}
          fill={`url(#${AREA_HATCH_ID})`}
          style={{ pointerEvents: 'none' }}
        />
      )}
      {label(
        standing && roomForHint && showHint ? c.y - fontSize * 0.55 : c.y,
        `${o.label}${labelSuffix}`,
      )}
      {standing &&
        roomForHint &&
        showHint &&
        label(
          c.y + fontSize * 0.75,
          AREA_HINT,
          Math.max(8, fontSize * 0.62),
          '#a5b4fc',
        )}
    </>,
  )
}
