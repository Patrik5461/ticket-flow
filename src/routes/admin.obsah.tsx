import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  listContentFn,
  getContentAdminFn,
  updateContentFn,
} from '../server/content'
import type { ContentBlockMeta } from '../server/content'
import { Markdown } from '../components/Markdown'

export const Route = createFileRoute('/admin/obsah')({
  loader: async (): Promise<ContentBlockMeta[]> => {
    const res = await listContentFn()
    return 'error' in res ? [] : res
  },
  component: ContentAdmin,
})

const KEY_RE = /^[a-z0-9-]+$/

function fmt(iso: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Bratislava',
  }).format(new Date(iso))
}

interface EditorState {
  key: string
  title: string
  body: string
  isNew: boolean
}

function ContentAdmin() {
  const initial = Route.useLoaderData()
  const [rows, setRows] = useState<ContentBlockMeta[]>(initial)
  const [editor, setEditor] = useState<EditorState | null>(null)

  const reload = async () => {
    const res = await listContentFn()
    if (!('error' in res)) setRows(res)
  }

  const openExisting = async (key: string) => {
    const res = await getContentAdminFn({ data: { key } })
    if ('error' in res) {
      alert(res.error)
      return
    }
    setEditor({ key: res.key, title: res.title, body: res.body, isNew: false })
  }

  const openNew = () => setEditor({ key: '', title: '', body: '', isNew: true })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Obsah stránok</h1>
          <p className="mt-1 text-sm text-gray-500">
            Editovateľné texty verejných stránok (VOP, GDPR, cookies, …).
            Markdown: nadpisy, odstavce, zoznamy, **tučné**, *kurzíva*, odkazy.
          </p>
        </div>
        <button
          onClick={openNew}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          + Nový blok
        </button>
      </div>

      <section className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-2 font-medium">Kľúč</th>
              <th className="px-4 py-2 font-medium">Názov</th>
              <th className="px-4 py-2 font-medium">Naposledy zmenené</th>
              <th className="px-4 py-2 font-medium">Kým</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b last:border-b-0">
                <td className="px-4 py-2 font-mono text-xs">{r.key}</td>
                <td className="px-4 py-2">{r.title}</td>
                <td className="px-4 py-2 text-gray-500">{fmt(r.updatedAt)}</td>
                <td className="px-4 py-2 text-gray-500">
                  {r.updatedByEmail ?? '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => openExisting(r.key)}
                    className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-gray-50"
                  >
                    Upraviť
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  Zatiaľ žiadne bloky.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {editor && (
        <Editor
          state={editor}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null)
            await reload()
          }}
        />
      )}
    </div>
  )
}

function Editor({
  state,
  onClose,
  onSaved,
}: {
  state: EditorState
  onClose: () => void
  onSaved: () => void
}) {
  const [key, setKey] = useState(state.key)
  const [title, setTitle] = useState(state.title)
  const [body, setBody] = useState(state.body)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const keyValid = KEY_RE.test(key)
  const canSave = keyValid && title.trim().length > 0 && !saving

  const save = async () => {
    setErr(null)
    setSaving(true)
    const res = await updateContentFn({
      data: { key, title: title.trim(), body },
    })
    setSaving(false)
    if ('error' in res) setErr(res.error)
    else onSaved()
  }

  return (
    <section className="rounded-lg border bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {state.isNew ? 'Nový blok' : `Úprava: ${state.key}`}
        </h2>
        <button
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          Zavrieť
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">
            Kľúč (URL slug)
          </span>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={!state.isNew}
            placeholder="napr. obchodne-podmienky"
            className="w-full rounded-md border px-3 py-2 font-mono text-sm disabled:bg-gray-100 disabled:text-gray-500"
          />
          {state.isNew && !keyValid && key.length > 0 && (
            <span className="mt-1 block text-xs text-red-600">
              Len malé písmená, číslice a pomlčky.
            </span>
          )}
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Názov</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Zobrazený nadpis stránky"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex gap-2">
          {(['edit', 'preview'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                tab === t
                  ? 'bg-gray-900 text-white'
                  : 'border text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'edit' ? 'Text (Markdown)' : 'Náhľad'}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className={tab === 'edit' ? '' : 'hidden md:block'}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={20}
              className="w-full rounded-md border px-3 py-2 font-mono text-sm"
              placeholder="# Nadpis&#10;&#10;Odstavec s **tučným** a [odkazom](https://…)."
            />
          </div>
          <div
            className={`rounded-md border bg-ink-950 p-4 text-ink-100 ${
              tab === 'preview' ? '' : 'hidden md:block'
            }`}
          >
            <div className="space-y-4 leading-relaxed text-ink-300">
              {body.trim() ? (
                <Markdown source={body} />
              ) : (
                <p className="text-ink-500">Náhľad sa zobrazí tu.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={!canSave}
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? 'Ukladám…' : 'Uložiť'}
        </button>
        <button
          onClick={onClose}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Zrušiť
        </button>
      </div>
    </section>
  )
}
