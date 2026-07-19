import { createFileRoute } from '@tanstack/react-router'
import { useState, useMemo } from 'react'
import { FileText, Plus, Save, X, Eye, Pencil } from 'lucide-react'
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
          <h1 className="font-display text-2xl font-bold text-ink-100 sm:text-3xl">
            Obsah stránok
          </h1>
          <p className="mt-1 text-sm text-ink-400">
            Editovateľné texty verejných stránok (VOP, GDPR, cookies, …).
            Markdown: nadpisy, odstavce, zoznamy, **tučné**, *kurzíva*, odkazy.
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:brightness-110"
        >
          <Plus size={16} />
          Nový blok
        </button>
      </div>

      <section className="table-cards overflow-hidden rounded-2xl border border-ink-800 bg-ink-900/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-800 text-left text-xs uppercase tracking-wider text-ink-500">
              <th className="px-4 py-3 font-medium">Kľúč</th>
              <th className="px-4 py-3 font-medium">Názov</th>
              <th className="px-4 py-3 font-medium">Naposledy zmenené</th>
              <th className="px-4 py-3 font-medium">Kým</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className="border-b border-ink-800/70 last:border-b-0 hover:bg-ink-800/40"
              >
                <td data-label="Kľúč" className="px-4 py-3">
                  <span className="inline-flex items-center gap-2 font-mono text-xs text-ink-200">
                    <FileText size={13} className="text-ink-500" />
                    {r.key}
                  </span>
                </td>
                <td data-label="Názov" className="px-4 py-3 text-ink-100">
                  {r.title}
                </td>
                <td
                  data-label="Naposledy"
                  className="px-4 py-3 text-ink-400"
                >
                  {fmt(r.updatedAt)}
                </td>
                <td data-label="Kým" className="px-4 py-3 text-ink-400">
                  {r.updatedByEmail ?? '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => openExisting(r.key)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-200 transition hover:border-accent hover:text-accent"
                  >
                    <Pencil size={12} />
                    Upraviť
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-ink-500"
                >
                  Zatiaľ žiadne bloky. Kliknite na „Nový blok" vyššie.
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
  const dirty = useMemo(
    () =>
      key !== state.key || title !== state.title || body !== state.body,
    [key, title, body, state.key, state.title, state.body],
  )
  const canSave = keyValid && title.trim().length > 0 && !saving && dirty

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
    <section className="rounded-2xl border border-ink-800 bg-ink-900/40">
      <div className="flex items-center justify-between gap-3 border-b border-ink-800 px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
            {state.isNew ? <Plus size={16} /> : <Pencil size={16} />}
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-semibold text-ink-100">
              {state.isNew ? 'Nový blok' : `Úprava: ${state.key}`}
            </h2>
            {dirty && (
              <span className="text-[11px] font-medium uppercase tracking-wider text-amber-400">
                • Neuložené zmeny
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Zavrieť"
          className="grid h-9 w-9 place-items-center rounded-lg border border-ink-700 text-ink-300 transition hover:border-ink-500 hover:text-ink-100"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-ink-200">
              Kľúč (URL slug)
            </span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={!state.isNew}
              placeholder="napr. obchodne-podmienky"
              className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 font-mono text-sm text-ink-100 outline-none transition focus:border-accent disabled:opacity-60"
            />
            {state.isNew && !keyValid && key.length > 0 && (
              <span className="mt-1 block text-xs text-red-400">
                Len malé písmená, číslice a pomlčky.
              </span>
            )}
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-ink-200">
              Názov
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Zobrazený nadpis stránky"
              className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm text-ink-100 outline-none transition focus:border-accent"
            />
          </label>
        </div>

        <div>
          <div className="mb-2 flex gap-1.5 md:hidden">
            <button
              onClick={() => setTab('edit')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === 'edit'
                  ? 'bg-accent text-ink-950'
                  : 'border border-ink-700 text-ink-300'
              }`}
            >
              <Pencil size={12} /> Editor
            </button>
            <button
              onClick={() => setTab('preview')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === 'preview'
                  ? 'bg-accent text-ink-950'
                  : 'border border-ink-700 text-ink-300'
              }`}
            >
              <Eye size={12} /> Náhľad
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className={tab === 'edit' ? '' : 'hidden md:block'}>
              <div className="mb-1.5 hidden items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ink-500 md:flex">
                <Pencil size={12} /> Markdown
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={20}
                className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-3 font-mono text-sm text-ink-100 outline-none transition focus:border-accent"
                placeholder="# Nadpis&#10;&#10;Odstavec s **tučným** a [odkazom](https://…)."
              />
            </div>
            <div className={tab === 'preview' ? '' : 'hidden md:block'}>
              <div className="mb-1.5 hidden items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ink-500 md:flex">
                <Eye size={12} /> Náhľad
              </div>
              <div className="min-h-[420px] rounded-lg border border-ink-800 bg-ink-950 p-5">
                <div className="space-y-4 leading-relaxed text-ink-200">
                  {body.trim() ? (
                    <Markdown source={body} />
                  ) : (
                    <p className="text-ink-500">Náhľad sa zobrazí tu.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {err && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {err}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-ink-700 px-4 py-2.5 text-sm font-medium text-ink-200 transition hover:border-ink-500 hover:text-ink-100"
          >
            Zrušiť
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save size={15} />
            {saving ? 'Ukladám…' : 'Uložiť'}
          </button>
        </div>
      </div>
    </section>
  )
}
