import { Link } from '@tanstack/react-router'

/** Shared shell for static content pages (kontakt, VOP, GDPR, …). */
export function ContentPage({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link
          to="/"
          className="text-sm text-ink-300 transition hover:text-ink-100"
        >
          ← Späť na hlavnú stránku
        </Link>
        <h1 className="mt-6 font-display text-3xl font-bold">{title}</h1>
        {subtitle && <p className="mt-3 text-ink-300">{subtitle}</p>}
        <div className="mt-8 space-y-4 leading-relaxed text-ink-300">
          {children}
        </div>
      </div>
    </div>
  )
}

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 mb-2 font-display text-lg font-semibold text-ink-100">
      {children}
    </h2>
  )
}
