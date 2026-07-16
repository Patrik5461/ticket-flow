import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  getOrganizerBrandingFn,
  updateBrandColorFn,
  uploadBrandLogoFn,
  removeBrandLogoFn,
  getOrganizerCompanyFn,
  updateOrganizerCompanyFn,
  listTeamMembersFn,
} from '../server/dashboard'
import type {
  OrganizerBranding,
  OrganizerCompany,
  TeamMember,
} from '../server/dashboard'

export const Route = createFileRoute('/app/settings')({
  loader: async (): Promise<{
    branding: OrganizerBranding
    company: OrganizerCompany
    team: TeamMember[]
  }> => {
    const [branding, company, team] = await Promise.all([
      getOrganizerBrandingFn(),
      getOrganizerCompanyFn(),
      listTeamMembersFn(),
    ])
    return { branding, company, team }
  },
  component: SettingsPage,
})

const MAX_LOGO_BYTES = 512 * 1024

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

function SettingsPage() {
  const { branding, company, team } = Route.useLoaderData()
  const router = useRouter()

  const [color, setColor] = useState(branding.brandColor ?? '#4f46e5')
  const [colorOn, setColorOn] = useState(Boolean(branding.brandColor))
  const [logoUrl, setLogoUrl] = useState(branding.brandLogoUrl)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const saveColor = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await updateBrandColorFn({
        data: { brandColor: colorOn ? color : null },
      })
      setMsg({ ok: true, text: 'Farba uložená.' })
      if (res.brandColor) setColor(res.brandColor)
      router.invalidate()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setMsg({ ok: false, text: 'Podporované sú len PNG a JPG.' })
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setMsg({ ok: false, text: 'Logo je príliš veľké (max 512 KB).' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const dataUrl = await fileToDataUrl(file)
      const res = await uploadBrandLogoFn({ data: { dataUrl } })
      setLogoUrl(res.brandLogoUrl)
      setMsg({ ok: true, text: 'Logo nahrané.' })
      router.invalidate()
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const removeLogo = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await removeBrandLogoFn()
      setLogoUrl(null)
      setMsg({ ok: true, text: 'Logo odstránené.' })
      router.invalidate()
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const accent = colorOn ? color : '#6b7280'

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold">Nastavenia</h1>

      <CompanySection company={company} />

      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Branding</h2>
          <p className="text-sm text-gray-500">
            Logo a farba sa použijú na PDF vstupenkách vašich podujatí.
          </p>
        </div>

        {msg && (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              msg.ok
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-6">
            {/* Logo */}
            <section className="rounded-lg border bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold">Logo</h2>
              {logoUrl ? (
                <div className="flex items-center gap-4">
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="h-14 max-w-[180px] object-contain"
                  />
                  <button
                    onClick={removeLogo}
                    disabled={busy}
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    Odstrániť
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Zatiaľ bez loga.</p>
              )}
              <label className="mt-3 inline-block cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50">
                {logoUrl ? 'Nahradiť logo' : 'Nahrať logo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={onFile}
                  disabled={busy}
                  className="hidden"
                />
              </label>
              <p className="mt-2 text-xs text-gray-400">
                PNG alebo JPG, max 512 KB.
              </p>
            </section>

            {/* Color */}
            <section className="rounded-lg border bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold">Akcentová farba</h2>
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={colorOn}
                  onChange={(e) => setColorOn(e.target.checked)}
                />
                Použiť vlastnú farbu
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  disabled={!colorOn}
                  className="h-9 w-12 cursor-pointer rounded border disabled:opacity-40"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  disabled={!colorOn}
                  className="w-28 rounded-md border px-2 py-1 font-mono text-sm disabled:opacity-40"
                />
                <button
                  onClick={saveColor}
                  disabled={busy}
                  className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Uložiť farbu
                </button>
              </div>
            </section>
          </div>

          {/* Live preview */}
          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">Náhľad vstupenky</h2>
            <div className="mx-auto w-[240px] overflow-hidden rounded-lg border shadow-sm">
              <div className="h-1.5" style={{ backgroundColor: accent }} />
              <div className="space-y-3 p-4">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="h-8 max-w-[120px] object-contain"
                  />
                ) : (
                  <div
                    className="text-[10px] font-bold tracking-wide"
                    style={{ color: accent }}
                  >
                    TICKETIO
                  </div>
                )}
                <div className="text-base font-bold leading-tight">
                  Ukážkové podujatie
                </div>
                <div className="text-[11px] text-gray-500">
                  Kultúrny dom · 1. 8. 2026 20:00
                </div>
                <div className="pt-1 text-sm font-semibold">Vstupenka VIP</div>
                <div className="mx-auto mt-2 grid h-28 w-28 place-items-center rounded bg-gray-100 text-[10px] text-gray-400">
                  QR kód
                </div>
                <div className="text-[9px] text-gray-400">A1B2C3D4</div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <TeamSection team={team} />
    </div>
  )
}

function CompanySection({ company }: { company: OrganizerCompany }) {
  const router = useRouter()
  const [form, setForm] = useState({
    name: company.name,
    ico: company.ico ?? '',
    dic: company.dic ?? '',
    icDph: company.icDph ?? '',
    iban: company.iban ?? '',
    contactEmail: company.contactEmail ?? '',
    phone: company.phone ?? '',
    address: company.address ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const res = await updateOrganizerCompanyFn({
        data: {
          name: form.name.trim(),
          ico: form.ico.trim() || null,
          dic: form.dic.trim() || null,
          icDph: form.icDph.trim() || null,
          iban: form.iban.trim() || null,
          contactEmail: form.contactEmail.trim() || null,
          phone: form.phone.trim() || null,
          address: form.address.trim() || null,
        },
      })
      setMsg(
        'error' in res
          ? { ok: false, text: res.error }
          : { ok: true, text: 'Uložené.' },
      )
      if (!('error' in res)) router.invalidate()
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const field =
    'w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400'

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Firemné údaje</h2>
        <p className="text-sm text-gray-500">
          Použijú sa na faktúrach a vyúčtovaní.
        </p>
      </div>
      {msg && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            msg.ok
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}
      <form
        onSubmit={save}
        className="grid gap-4 rounded-lg border bg-white p-4 sm:grid-cols-2"
      >
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">Názov *</span>
          <input
            required
            value={form.name}
            onChange={set('name')}
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Identifikátor (slug)
          </span>
          <input value={company.slug} disabled className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">IČO</span>
          <input
            value={form.ico}
            onChange={set('ico')}
            placeholder="8 číslic"
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">DIČ</span>
          <input value={form.dic} onChange={set('dic')} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">IČ DPH</span>
          <input value={form.icDph} onChange={set('icDph')} className={field} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">IBAN</span>
          <input
            value={form.iban}
            onChange={set('iban')}
            placeholder="SK.."
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Kontaktný e-mail
          </span>
          <input
            type="email"
            value={form.contactEmail}
            onChange={set('contactEmail')}
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Telefón</span>
          <input value={form.phone} onChange={set('phone')} className={field} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">Adresa</span>
          <input
            value={form.address}
            onChange={set('address')}
            className={field}
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Ukladám…' : 'Uložiť firemné údaje'}
          </button>
        </div>
      </form>
    </section>
  )
}

const ROLE_SK: Record<TeamMember['role'], string> = {
  owner: 'Vlastník',
  admin: 'Admin',
  checkin: 'Check-in',
}

function TeamSection({ team }: { team: TeamMember[] }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Tím</h2>
        <p className="text-sm text-gray-500">
          Členovia organizácie. Správa členov pribudne neskôr.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-2">E-mail</th>
              <th className="px-4 py-2">Rola</th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.email} className="border-b last:border-0">
                <td className="px-4 py-2">{m.email}</td>
                <td className="px-4 py-2 text-gray-600">{ROLE_SK[m.role]}</td>
              </tr>
            ))}
            {team.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-gray-500">
                  Žiadni členovia.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
