/**
 * Venue picker for the seat-map editor and the event form.
 *
 * A plain <select> stops working once the shared library lands (~460 halls), so
 * this is a searchable combobox: type to filter by name OR address, arrow keys
 * to move, Enter to pick. Options are split into the same two groups a native
 * <optgroup> pair would give — "Moje miesta" first, then "Verejné haly".
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { filterVenues, splitVenues } from '../lib/venue-library'
import type { VenueOption } from '../lib/venue-library'

/** How many matches to render at once — a 460-row list is nobody's friend. */
const MAX_VISIBLE = 50

type Group = { label: string; venues: VenueOption[] }

/** Flattened, so keyboard navigation walks one list across both groups. */
type Row =
  | { kind: 'header'; label: string }
  | { kind: 'option'; venue: VenueOption; index: number }

function buildRows(groups: Group[]): { rows: Row[]; options: VenueOption[] } {
  const rows: Row[] = []
  const options: VenueOption[] = []
  for (const g of groups) {
    if (g.venues.length === 0) continue
    rows.push({ kind: 'header', label: g.label })
    for (const v of g.venues) {
      rows.push({ kind: 'option', venue: v, index: options.length })
      options.push(v)
    }
  }
  return { rows, options }
}

export function VenueCombobox({
  venues,
  value,
  onChange,
  label = 'Miesto konania',
  placeholder = 'Hľadajte podľa názvu alebo adresy…',
  disabled = false,
}: {
  venues: VenueOption[]
  value: string | null
  onChange: (id: string | null) => void
  label?: string
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  const selected = venues.find((v) => v.id === value) ?? null

  const { rows, options, truncated } = useMemo(() => {
    const { own, library } = splitVenues(filterVenues(venues, query))
    // Cap each group on its own: capping the merged list would let a long run
    // of own venues push every library hall off the end.
    const shownOwn = own.slice(0, MAX_VISIBLE)
    const shownLibrary = library.slice(0, MAX_VISIBLE)
    return {
      ...buildRows([
        { label: 'Moje miesta', venues: shownOwn },
        { label: 'Verejné haly', venues: shownLibrary },
      ]),
      truncated:
        own.length - shownOwn.length + (library.length - shownLibrary.length),
    }
  }, [venues, query])

  // A shrinking result list must not leave the highlight past the end.
  useEffect(() => {
    setActive((a) => (a < options.length ? a : 0))
  }, [options.length])

  // Click outside closes and discards the half-typed query.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector(`[data-opt="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const pick = (v: VenueOption) => {
    onChange(v.id)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return setOpen(true)
      if (options.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a + step + options.length) % options.length)
      return
    }
    if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      // Enter on an empty result list must not commit anything.
      if (active < options.length) pick(options[active])
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
      return
    }
  }

  return (
    <div ref={boxRef} className="relative text-sm">
      <span className="mb-1 block text-gray-600">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          // Closed, the input reads as the current selection; open, it is the
          // search box and starts empty so the whole list is reachable.
          value={open ? query : (selected?.name ?? '')}
          placeholder={selected ? placeholder : '— vyberte —'}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          className="w-72 rounded-md border px-3 py-2 text-sm disabled:bg-gray-100"
        />
        {selected && !disabled && (
          <button
            type="button"
            aria-label="Zrušiť výber"
            onClick={() => {
              onChange(null)
              setQuery('')
            }}
            className="rounded-md border px-2 py-2 text-xs text-gray-500 hover:bg-gray-50"
          >
            ✕
          </button>
        )}
      </div>

      {selected?.address && !open && (
        <p className="mt-1 w-72 truncate text-xs text-gray-400">
          {selected.address}
        </p>
      )}

      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-96 overflow-auto rounded-md border bg-white py-1 shadow-lg"
        >
          {rows.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-500">Nič sa nenašlo.</li>
          )}
          {rows.map((row) =>
            row.kind === 'header' ? (
              <li
                key={`h:${row.label}`}
                role="presentation"
                className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-400"
              >
                {row.label}
              </li>
            ) : (
              <li
                key={row.venue.id}
                role="option"
                data-opt={row.index}
                aria-selected={row.venue.id === value}
                // onMouseDown, not onClick: mousedown fires before the input's
                // blur, so the list is still mounted when the pick lands.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(row.venue)
                }}
                onMouseEnter={() => setActive(row.index)}
                className={`cursor-pointer px-3 py-1.5 ${
                  row.index === active ? 'bg-gray-100' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{row.venue.name}</span>
                  {row.venue.readOnly && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-500">
                      verejná
                    </span>
                  )}
                </div>
                {row.venue.address && (
                  <div className="truncate text-xs text-gray-400">
                    {row.venue.address}
                  </div>
                )}
              </li>
            ),
          )}
          {truncated > 0 && (
            <li className="px-3 pb-1 pt-2 text-xs text-gray-400">
              …a ďalších {truncated}. Spresnite hľadanie.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
