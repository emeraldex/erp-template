import { ImageResponse } from "next/og";

/** App icons drawn from the company mark, rendered at build time. */
export const dynamic = "force-static";

const SIZES: Record<string, { px: number; pad: number }> = {
  "192": { px: 192, pad: 0.16 },
  "512": { px: 512, pad: 0.16 },
  // Maskable icons keep the mark inside the central safe zone.
  maskable: { px: 512, pad: 0.28 },
  apple: { px: 180, pad: 0.16 },
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const s = SIZES[size] ?? SIZES["192"];
  const box = Math.round(s.px * (1 - 2 * s.pad));
  const stroke = Math.max(4, Math.round(box * 0.085));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a1526" }}>
        <div style={{
          width: box, height: box, borderRadius: box * 0.12, border: `${stroke}px solid #c8102e`, display: "flex",
          flexDirection: "column", justifyContent: "center", gap: box * 0.1, padding: box * 0.18,
        }}>
          <div style={{ height: stroke, width: "100%", background: "#e8eff9", borderRadius: stroke }} />
          <div style={{ height: stroke, width: "100%", background: "#e8eff9", borderRadius: stroke }} />
          <div style={{ height: stroke, width: "58%", background: "#e8eff9", borderRadius: stroke }} />
        </div>
      </div>
    ),
    { width: s.px, height: s.px },
  );
}
