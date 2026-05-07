export default function Logo() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 36 36"
      fill="none"
      aria-label="Resi Parser logo"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="36" height="36" rx="10" fill="var(--color-primary-dim)" stroke="var(--color-primary-border)" strokeWidth="1" />
      <path
        d="M11 9h10l7 7v13a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2Z"
        stroke="var(--color-primary)"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M21 9v8h7" stroke="var(--color-primary)" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M13 20h10M13 24h7" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
