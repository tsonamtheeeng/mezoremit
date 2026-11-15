/** Mark for next/og ImageResponse (no CSS variables there). */
export function OgMark({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#2759bc" />
      <path d="M16 7v18" stroke="#f7f8fc" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" strokeDasharray="2.5 3" />
      <path d="M8 16h15m-4.5-5 5 5-5 5" fill="none" stroke="#f7f8fc" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
