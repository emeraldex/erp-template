"use client";

import { Job, WorkflowConfig } from "@/lib/types";

/**
 * The operations radar: each blip is a real open JTS job, plotted by branch
 * bearing (Customer bases arranged roughly by geography around HQ at centre).
 * Radial distance encodes attention: BER/SOR plot hottest near centre,
 * customer/vendor waits mid-ring, working statuses on the outer ring.
 */
const BRANCH_BEARING: Record<string, number> = {
  HQ: 0,
  CENTRAL: 320,
  NORTH: 300,
  "NORTHEAST": 20,
  EAST: 55,
  OFFSHORE: 95,
};

const TONE_RADIUS: Record<string, number> = { bad: 26, warn: 52, info: 76, neutral: 76, good: 88 };
const TONE_COLOR: Record<string, string> = {
  bad: "var(--z-red-bright)",
  warn: "var(--z-amber)",
  info: "var(--z-phosphor)",
  neutral: "var(--z-steel)",
  good: "var(--z-phosphor)",
};

export function RadarScope({ jobs, cfg }: { jobs: Job[]; cfg: WorkflowConfig | null }) {
  const open = jobs.filter((j) => j.status !== "CLOSED" && j.status !== "DELIVERED");

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[300px]">
      <svg viewBox="-100 -100 200 200" className="h-full w-full" role="img" aria-label={`Radar plot of ${open.length} open jobs`}>
        {[30, 55, 80].map((r) => (
          <circle key={r} cx={0} cy={0} r={r} fill="none" stroke="var(--z-line-strong)" strokeWidth={0.6} />
        ))}
        <circle cx={0} cy={0} r={95} fill="none" stroke="var(--z-line-strong)" strokeWidth={1} />
        <line x1={-95} y1={0} x2={95} y2={0} stroke="var(--z-line)" strokeWidth={0.6} />
        <line x1={0} y1={-95} x2={0} y2={95} stroke="var(--z-line)" strokeWidth={0.6} />

        <g className="radar-sweep">
          <path d="M0,0 L0,-95 A95,95 0 0,1 55,-77.4 Z" fill="url(#sweepGrad)" opacity={0.6} />
          <line x1={0} y1={0} x2={0} y2={-95} stroke="var(--z-phosphor)" strokeWidth={1.2} opacity={0.9} />
        </g>

        <defs>
          <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--z-phosphor)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--z-phosphor)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* blips = open JTS jobs */}
        {open.map((j, i) => {
          const tone = cfg?.jobStatusMeta?.[j.status]?.tone ?? "info";
          const bearingDeg = BRANCH_BEARING[j.repairUnit] ?? i * 47;
          // spread same-branch blips slightly so they do not overlap
          const bearing = (bearingDeg + (i % 3) * 9 - 9) * (Math.PI / 180);
          const r = j.repairUnit === "HQ" ? 18 + (i % 3) * 8 : (TONE_RADIUS[tone] ?? 70);
          const x = Math.sin(bearing) * r;
          const y = -Math.cos(bearing) * r;
          const c = TONE_COLOR[tone] ?? "var(--z-phosphor)";
          return (
            <g key={j.id} className="blip" style={{ animationDelay: `${i * 0.35}s` }}>
              <circle cx={x} cy={y} r={3.2} fill={c} />
              <circle cx={x} cy={y} r={6.5} fill="none" stroke={c} strokeWidth={0.7} opacity={0.45} />
            </g>
          );
        })}

        <rect x={-2.4} y={-2.4} width={4.8} height={4.8} fill="var(--z-red)" transform="rotate(45)" />
      </svg>

      <p className="eyebrow absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap">
        {open.length} contacts · HQ centre
      </p>
    </div>
  );
}

export function RadarLegend() {
  const items: [string, string][] = [
    ["BER / SOR", "var(--z-red-bright)"],
    ["WAITING", "var(--z-amber)"],
    ["WORKING", "var(--z-phosphor)"],
  ];
  return (
    <div className="flex gap-4">
      {items.map(([label, color]) => (
        <span key={label} className="mono flex items-center gap-1.5 text-[10.5px] tracking-widest text-steel">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
