export function Milo({
  size = 48,
  thinking = false,
}: {
  size?: number;
  thinking?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Milo, your AI student"
      className={thinking ? "milo thinking" : "milo"}
    >
      <defs>
        <linearGradient id={`milo-${size}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#7876ec" />
          <stop offset="1" stopColor="#4d58bb" />
        </linearGradient>
      </defs>
      <path
        d="M34 22C34 12 43 9 48 18L54 31M72 29L82 16C90 9 97 19 89 28"
        fill="none"
        stroke="#9290e9"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d="M16 61C16 34 35 23 61 23s44 12 44 38v19c0 13-10 24-23 24H39C26 104 16 94 16 80Z"
        fill={`url(#milo-${size})`}
      />
      <path d="M12 64C2 61 2 83 14 82M108 63c13-2 12 20 0 19" fill="#9394ea" />
      <rect x="27" y="42" width="68" height="43" rx="20" fill="#f3f2ff" />
      <ellipse cx="44" cy="62" rx="5" ry="7" fill="#31355e" />
      <ellipse cx="78" cy="62" rx="5" ry="7" fill="#31355e" />
      <path
        d="M55 71q6 6 12 0"
        fill="none"
        stroke="#6b69ad"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="m41 105-5 7m46-7 5 7"
        stroke="#525bb6"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </svg>
  );
}
