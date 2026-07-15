import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { createEventFn } from '../server/dashboard'

export const Route = createFileRoute('/app/events/new')({ component: NewEvent })

const inputCls = 'w-full rounded-md border px-3 py-2'

function NewEvent() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    title: '',
    description: '',
    venueName: '',
    venueAddress: '',
    startsAtLocal: '',
    endsAtLocal: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    const res = await createEventFn({
      data: {
        title: form.title.trim(),
        description: form.description.trim() || null,
        venueName: form.venueName.trim() || null,
        venueAddress: form.venueAddress.trim() || null,
        startsAtLocal: form.startsAtLocal,
        endsAtLocal: form.endsAtLocal || null,
        timezone: 'Europe/Bratislava',
      },
    })
    if ('error' in res) {
      setError(res.error)
      setSaving(false)
      return
    }
    await navigate({ to: '/app/events/$eventId', params: { eventId: res.eventId } })
  }

  return (
    <div className="max-w-xl">
      <Link to="/app" className="text-sm text-indigo-600 hover:underline">
        ← Späť na podujatia
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Nové podujatie</h1>

      <form onSubmit={submit} className="mt-6 space-y-4 rounded-lg border bg-white p-6">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Názov *</span>
          <input required value={form.title} onChange={set('title')} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Popis</span>
          <textarea value={form.description} onChange={set('description')} rows={4} className={inputCls} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Miesto</span>
            <input value={form.venueName} onChange={set('venueName')} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Adresa</span>
            <input value={form.venueAddress} onChange={set('venueAddress')} className={inputCls} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Začiatok *</span>
            <input
              type="datetime-local"
              required
              value={form.startsAtLocal}
              onChange={set('startsAtLocal')}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Koniec</span>
            <input
              type="datetime-local"
              value={form.endsAtLocal}
              onChange={set('endsAtLocal')}
              className={inputCls}
            />
          </label>
        </div>
        <p className="text-xs text-gray-500">Časy sú v zóne Europe/Bratislava.</p>

        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Vytváram…' : 'Vytvoriť podujatie'}
        </button>
      </form>
    </div>
  )
}
