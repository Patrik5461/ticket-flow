import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { createEventFn, uploadEventCoverFn } from '../server/dashboard'

export const Route = createFileRoute('/app/events/new')({ component: NewEvent })

const inputCls = 'w-full rounded-md border px-3 py-2'
const MAX_COVER_BYTES = 5 * 1024 * 1024

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

function CoverCardPreview({
  title,
  cover,
  startsAtLocal,
  venueName,
}: {
  title: string
  cover: string | null
  startsAtLocal: string
  venueName: string
}) {
  const dateLabel = startsAtLocal
    ? new Intl.DateTimeFormat('sk-SK', {
        day: '2-digit',
        month: 'short',
      }).format(new Date(startsAtLocal))
    : '—'
  return (
    <div className="w-full max-w-xs overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="aspect-[16/9] w-full bg-gray-100">
        {cover ? (
          <img
            src={cover}
            alt="Náhľad"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            16:9 cover
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-xs font-medium text-indigo-600">{dateLabel}</div>
        <div className="mt-0.5 line-clamp-2 font-semibold">
          {title || 'Názov podujatia'}
        </div>
        {venueName && (
          <div className="mt-0.5 text-xs text-gray-500">{venueName}</div>
        )}
      </div>
    </div>
  )
}

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
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [coverBusy, setCoverBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  const onCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Podporované sú len JPG, PNG a WebP.')
      return
    }
    if (file.size > MAX_COVER_BYTES) {
      setError('Obrázok je príliš veľký (max 5 MB).')
      return
    }
    setCoverBusy(true)
    setError(null)
    try {
      const dataUrl = await fileToDataUrl(file)
      const res = await uploadEventCoverFn({ data: { dataUrl } })
      if ('error' in res) setError((res as { error: string }).error)
      else setCoverUrl(res.url)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCoverBusy(false)
    }
  }

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
        coverUrl,
      },
    })
    if ('error' in res) {
      setError(res.error)
      setSaving(false)
      return
    }
    await navigate({
      to: '/app/events/$eventId',
      params: { eventId: res.eventId },
    })
  }

  return (
    <div className="max-w-3xl">
      <Link to="/app" className="text-sm text-indigo-600 hover:underline">
        ← Späť na podujatia
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Nové podujatie</h1>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_auto]">
        <form
          onSubmit={submit}
          className="space-y-4 rounded-lg border bg-white p-6"
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Názov *</span>
            <input
              required
              value={form.title}
              onChange={set('title')}
              className={inputCls}
            />
          </label>

          {/* Cover */}
          <div className="block">
            <span className="mb-1 block text-sm font-medium">
              Cover obrázok (16:9)
            </span>
            <div className="aspect-[16/9] w-full max-w-sm overflow-hidden rounded-md border bg-gray-50">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt="Cover"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-gray-400">
                  Zatiaľ bez obrázka
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <label className="inline-block cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50">
                {coverBusy
                  ? 'Nahrávam…'
                  : coverUrl
                    ? 'Nahradiť'
                    : 'Nahrať obrázok'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onCover}
                  disabled={coverBusy}
                  className="hidden"
                />
              </label>
              {coverUrl && (
                <button
                  type="button"
                  onClick={() => setCoverUrl(null)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Odstrániť
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-400">
              JPG, PNG alebo WebP, max 5 MB.
            </p>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Popis</span>
            <textarea
              value={form.description}
              onChange={set('description')}
              rows={4}
              className={inputCls}
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Miesto</span>
              <input
                value={form.venueName}
                onChange={set('venueName')}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Adresa</span>
              <input
                value={form.venueAddress}
                onChange={set('venueAddress')}
                className={inputCls}
              />
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
          <p className="text-xs text-gray-500">
            Časy sú v zóne Europe/Bratislava.
          </p>

          {error && (
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || coverBusy}
            className="rounded-md bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Vytváram…' : 'Vytvoriť podujatie'}
          </button>
        </form>

        {/* Live card preview */}
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Náhľad vo výpise
          </div>
          <CoverCardPreview
            title={form.title}
            cover={coverUrl}
            startsAtLocal={form.startsAtLocal}
            venueName={form.venueName}
          />
        </div>
      </div>
    </div>
  )
}
