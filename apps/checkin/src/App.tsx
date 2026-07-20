import { useEffect } from 'react'
import { SplashScreen } from '@capacitor/splash-screen'

/**
 * Block 1 — project shell only. The three screens (login → event list →
 * scanner) land in Block 2; the offline layer in Block 3. This placeholder
 * renders the dark brand shell so the scaffold builds and looks intentional.
 */
export function App() {
  useEffect(() => {
    // No-op on web; hides the native splash once React has painted.
    void SplashScreen.hide().catch(() => {})
  }, [])

  return (
    <div
      className="safe"
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <ScanLogo size={96} />
      <div>
        <div className="brand-mark" style={{ fontSize: 30 }}>
          ticket<span className="accent">io</span>
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
          }}
        >
          Scan
        </div>
      </div>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 15 }}>
        Skener vstupeniek pre vstup na podujatie
      </p>
    </div>
  )
}

/** The app mark: a scan viewfinder with a check — matches the launcher icon. */
function ScanLogo({ size = 96 }: { size?: number }) {
  const c = 'var(--accent)'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
    >
      {[
        'M12 30 V18 A6 6 0 0 1 18 12 H30',
        'M70 12 H82 A6 6 0 0 1 88 18 V30',
        'M88 70 V82 A6 6 0 0 1 82 88 H70',
        'M30 88 H18 A6 6 0 0 1 12 82 V70',
      ].map((d) => (
        <path
          key={d}
          d={d}
          stroke={c}
          strokeWidth={7}
          strokeLinecap="round"
        />
      ))}
      <path
        d="M34 51 L46 63 L68 39"
        stroke={c}
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
