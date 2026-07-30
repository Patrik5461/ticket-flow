/**
 * Shared SVG canvas controls for both seat maps — the organizer's editor and the
 * buyer's picker. Owns the viewport (pan / wheel + pinch zoom anchored on the
 * pointer / fit-to-screen) and the pointer bookkeeping around it; the viewport
 * maths itself lives in `seating.ts` so it stays unit-testable.
 *
 * A consumer that needs its own drag (moving a sector, resizing an object) calls
 * `claim()` from the element's own pointerdown with a move handler — the hook
 * then keeps its hands off that pointer. A consumer that only needs taps calls
 * `tap()` instead, so dragging off the element still pans the map.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { contentBounds, fitViewport, zoomViewport } from './seating'
import type { Point, Viewport } from './seating'

/** Client (screen px) → SVG user units, letterboxing included. */
export function clientToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): Point {
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: clientX, y: clientY }
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

/** Rendered pixels per SVG unit — the divisor for turning drags into units. */
export function pixelsPerUnit(svg: SVGSVGElement): number {
  const ctm = svg.getScreenCTM()
  return ctm && ctm.a !== 0 ? ctm.a : 1
}

/** Travel (CSS px) a press may drift and still count as a tap, not a drag. */
export const TAP_SLOP_PX = 6

export interface CanvasViewport {
  svgRef: React.RefObject<SVGSVGElement | null>
  view: Viewport
  /** Ready-made `viewBox` attribute. */
  viewBox: string
  /** Rendered width in CSS px (0 before the first measure / while hidden). */
  pxWidth: number
  setView: React.Dispatch<React.SetStateAction<Viewport>>
  fit: () => void
  zoomBy: (factor: number, clientX?: number, clientY?: number) => void
  panning: boolean
  /** Space is held: the canvas is temporarily in pan mode (editor only). */
  space: boolean
  spaceRef: React.RefObject<boolean>
  toSvg: (clientX: number, clientY: number) => Point
  unitsPerPixel: () => number
  /** True when another pointer is already down, i.e. a pinch is starting. */
  otherPointerDown: () => boolean
  /** Force a pan for this pointer (space held, middle mouse button). */
  startPan: (e: React.PointerEvent) => void
  /** Take over this pointer with a custom drag; the hook will not pan. */
  claim: (
    e: React.PointerEvent,
    onMove: (e: React.PointerEvent) => void,
    onEnd?: () => void,
  ) => void
  /** Mark this press as a tap on `target` if it ends without real movement. */
  tap: (target: string) => void
  handlers: {
    onPointerEnter: () => void
    onPointerLeave: () => void
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
}

export interface CanvasViewportOptions {
  /** Content to frame on fit; pass seat coordinates plus object corners. */
  points: Point[]
  /** Changing this refits the view (another map, another level). */
  fitKey: string
  /** Hold space to pan, like a desktop editor. Off for the buyer map. */
  spacePan?: boolean
  /** A press that ended without movement; `null` means empty canvas. */
  onTap?: (target: string | null) => void
}

export function useCanvasViewport({
  points,
  fitKey,
  spacePan = false,
  onTap,
}: CanvasViewportOptions): CanvasViewport {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [view, setView] = useState<Viewport>(() =>
    fitViewport(contentBounds(points), 0),
  )
  const [space, setSpace] = useState(false)
  const [panning, setPanning] = useState(false)
  const [pxWidth, setPxWidth] = useState(0)

  const pointsRef = useRef(points)
  pointsRef.current = points
  const onTapRef = useRef(onTap)
  onTapRef.current = onTap

  const spaceRef = useRef(false)
  const hovering = useRef(false)
  const pointers = useRef(new Map<number, Point>())
  const pinchDist = useRef<number | null>(null)
  const pan = useRef<{
    id: number
    x: number
    y: number
    startX: number
    startY: number
    moved: boolean
    tapTarget: string | null
  } | null>(null)
  const custom = useRef<{
    id: number
    onMove: (e: React.PointerEvent) => void
    onEnd?: () => void
  } | null>(null)
  // Set by an element's pointerdown, consumed by the svg's — children bubble first.
  const pendingTap = useRef<string | null>(null)

  // Track the rendered width so the zoom readout and hit targets can reason in
  // real pixels. Reports 0 while the element is display:none.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setPxWidth(entries[0].contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** Frame the content, matching the container's aspect so nothing letterboxes. */
  const fit = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect()
    const aspect = rect && rect.height > 0 ? rect.width / rect.height : 0
    setView(fitViewport(contentBounds(pointsRef.current), aspect))
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

  // A canvas that was hidden (mobile overlay, a `display:none` breakpoint) has
  // no width to fit against, so refit as soon as it is measurable.
  const wasHidden = useRef(true)
  useEffect(() => {
    if (pxWidth <= 0) {
      wasHidden.current = true
      return
    }
    if (wasHidden.current) {
      wasHidden.current = false
      fit()
    }
  }, [pxWidth, fit])

  // Refit when the map changes, and once content first appears.
  const count = points.length
  const hadContent = useRef(count > 0)
  useEffect(() => {
    hadContent.current = pointsRef.current.length > 0
    fit()
  }, [fitKey, fit])
  useEffect(() => {
    if (!hadContent.current && count > 0) fit()
    hadContent.current = count > 0
  }, [count, fit])

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
    if (!spacePan) return
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
  }, [spacePan])

  const beginPan = (e: React.PointerEvent, tapTarget: string | null) => {
    svgRef.current?.setPointerCapture(e.pointerId)
    pan.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      tapTarget,
    }
    setPanning(true)
  }

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchDist.current = null

    const c = custom.current
    if (c && c.id === e.pointerId) {
      c.onEnd?.()
      custom.current = null
    }
    const p = pan.current
    if (p && p.id === e.pointerId) {
      // A press that never really moved is a tap, not a drag.
      if (!p.moved) onTapRef.current?.(p.tapTarget)
      pan.current = null
      setPanning(false)
    }
    const svg = svgRef.current
    if (svg?.hasPointerCapture(e.pointerId))
      svg.releasePointerCapture(e.pointerId)
  }

  const handlers = {
    onPointerEnter: () => {
      hovering.current = true
    },
    onPointerLeave: () => {
      hovering.current = false
    },
    onPointerDown: (e: React.PointerEvent) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const target = pendingTap.current
      pendingTap.current = null
      if (pointers.current.size >= 2) {
        // Second finger down: hand over to pinch and drop any single-pointer
        // gesture, so a sector does not travel with the pinch.
        custom.current?.onEnd?.()
        custom.current = null
        pan.current = null
        setPanning(false)
        return
      }
      // An element may already have claimed this pointer (children bubble first).
      if (custom.current?.id === e.pointerId) return
      beginPan(e, target)
    },
    onPointerMove: (e: React.PointerEvent) => {
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

      const c = custom.current
      if (c && c.id === e.pointerId) return c.onMove(e)

      const p = pan.current
      if (!p || p.id !== e.pointerId) return
      const scale = pixelsPerUnit(svg)
      const dx = (e.clientX - p.x) / scale
      const dy = (e.clientY - p.y) / scale
      p.x = e.clientX
      p.y = e.clientY
      // The view follows the finger from the first pixel, but a tap is only
      // cancelled past the slop — a touch never holds perfectly still.
      if (
        Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > TAP_SLOP_PX
      )
        p.moved = true
      if (dx !== 0 || dy !== 0) setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }))
    },
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
  }

  return {
    svgRef,
    view,
    viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`,
    pxWidth,
    setView,
    fit,
    zoomBy,
    panning,
    space,
    spaceRef,
    toSvg: (clientX, clientY) =>
      svgRef.current
        ? clientToSvg(svgRef.current, clientX, clientY)
        : { x: clientX, y: clientY },
    unitsPerPixel: () =>
      svgRef.current ? 1 / pixelsPerUnit(svgRef.current) : 1,
    otherPointerDown: () => pointers.current.size >= 1,
    startPan: (e) => {
      custom.current = null
      beginPan(e, null)
      // A deliberate pan is never a tap, however still the pointer is held.
      if (pan.current) pan.current.moved = true
    },
    claim: (e, onMove, onEnd) => {
      svgRef.current?.setPointerCapture(e.pointerId)
      pan.current = null
      custom.current = { id: e.pointerId, onMove, onEnd }
    },
    tap: (target) => {
      pendingTap.current = target
    },
    handlers,
  }
}
