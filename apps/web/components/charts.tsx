"use client";

/** Dependency-free SVG bar chart with staggered draw-in. */
export function Bars({ data, label }: { data: number[]; label: string }) {
  const max = Math.max(...data, 1);
  return (
    <div>
      <div className="flex h-28 items-end gap-1.5" role="img" aria-label={label}>
        {data.map((v, i) => (
          <div key={i} className="group relative flex-1">
            <div
              className="draw-bar w-full rounded-t-sm bg-gradient-to-t from-brand/60 to-brand-bright/90"
              style={{ height: `${(v / max) * 100}%`, minHeight: 3, animationDelay: `${i * 0.05}s` }}
            />
            <span className="mono pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-steel opacity-0 transition-opacity group-hover:opacity-100">
              {v}
            </span>
          </div>
        ))}
      </div>
      <p className="eyebrow mt-2">{label}</p>
    </div>
  );
}

/** Inline sparkline for table rows. */
export function Sparkline({ data, color = "var(--c-phosphor)" }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 60},${18 - ((v - min) / (max - min || 1)) * 16}`)
    .join(" ");
  return (
    <svg viewBox="0 0 60 20" className="h-5 w-16" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** Availability gauge as a slim horizontal bar. */
export function AvailabilityBar({ pct }: { pct: number }) {
  const tone = pct >= 95 ? "var(--c-phosphor)" : pct >= 80 ? "var(--c-amber)" : "var(--c-red-bright)";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-deep">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: tone }} />
      </div>
      <span className="mono text-xs tabular-nums text-steel">{pct.toFixed(1)}%</span>
    </div>
  );
}
