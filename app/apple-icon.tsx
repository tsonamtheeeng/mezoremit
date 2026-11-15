import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#2759bc" }}>
        <svg width="132" height="132" viewBox="0 0 32 32">
          <path d="M16 5v22" stroke="#f7f8fc" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" strokeDasharray="2.5 3" />
          <path d="M7 16h16m-5-5.5 5.5 5.5-5.5 5.5" fill="none" stroke="#f7f8fc" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size,
  );
}
