"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Skeleton } from "@/components/ui/skeleton";

/** Renders `value` as an SVG QR code, generated in the browser (the claim link never leaves this device). */
export function QrCode({ value, size = 208, label }: { value: string; size?: number; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1f1f1d", light: "#ffffff" } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [value]);
  if (!svg) return <Skeleton style={{ width: size, height: size }} />;
  return (
    <div
      role="img"
      aria-label={label}
      className="rounded-lg bg-white p-2 ring-1 ring-border [&_svg]:h-full [&_svg]:w-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
