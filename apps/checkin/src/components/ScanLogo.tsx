/** The app mark: a scan viewfinder with a check — matches the launcher icon. */
export function ScanLogo({
  size = 96,
  color = 'var(--accent)',
}: {
  size?: number
  color?: string
}) {
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
        <path key={d} d={d} stroke={color} strokeWidth={7} strokeLinecap="round" />
      ))}
      <path
        d="M34 51 L46 63 L68 39"
        stroke={color}
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
