export function Logo({
  size = 28,
  variant = 'accent',
}: {
  size?: number
  variant?: 'accent' | 'inverse'
}) {
  const bg = variant === 'inverse' ? '#ffffff' : 'var(--accent)'
  const fg = variant === 'inverse' ? 'var(--accent)' : 'var(--bg)'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="logo"
    >
      <rect width="32" height="32" rx="9" fill={bg} />
      {/* 树干 */}
      <path
        d="M16 25.5v-8"
        stroke={fg}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* 树枝 */}
      <path
        d="M16 17.5C12.6 15.4 9.8 13.2 9.5 11M16 17.5V9.5M16 17.5c3.4-2.1 6.2-4.3 6.5-6.5"
        stroke={fg}
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      {/* 枝头节点（知识点） */}
      <circle cx="9.5" cy="11" r="2.2" fill={fg} />
      <circle cx="16" cy="9" r="2.2" fill={fg} />
      <circle cx="22.5" cy="11" r="2.2" fill={fg} />
    </svg>
  )
}
