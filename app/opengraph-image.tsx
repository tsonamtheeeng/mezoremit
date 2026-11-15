import { ImageResponse } from "next/og";
import { OgMark } from "@/components/brand/og-mark";

export const alt = "MezoRemit: Send money across borders. Settle in MUSD.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#fbfaf8", color: "#1f1f1d" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <OgMark size={64} />
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -1 }}>MezoRemit</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 82, fontWeight: 700, letterSpacing: -3, lineHeight: 1.04 }}>Send money across borders.</div>
          <div style={{ fontSize: 40, color: "#2759bc", fontWeight: 600 }}>Settle in MUSD on Mezo.</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#6b6a64" }}>Clear fees. Simple claim links. Testnet demo.</div>
      </div>
    ),
    size,
  );
}
