"use client";

import { useEffect, useRef, useState } from "react";

/** KPI card with a count-up on first paint (skipped for reduced motion). */
export function StatCard({
  label,
  value,
  suffix = "",
  format = (n: number) => String(Math.round(n)),
  tone = "default",
  delayClass = "",
}: {
  label: string;
  value: number;
  suffix?: string;
  format?: (n: number) => string;
  tone?: "default" | "good" | "warn" | "critical";
  delayClass?: string;
}) {
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDisplay(value);
      return;
    }
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const toneClass = {
    default: "text-fg",
    good: "text-phosphor",
    warn: "text-amber",
    critical: "text-brand-bright",
  }[tone];

  return (
    <div className={`panel fade-up ${delayClass} p-4`}>
      <p className="eyebrow mb-2">{label}</p>
      <p className={`display text-3xl font-bold tabular-nums ${toneClass}`}>
        {format(display)}
        <span className="ml-0.5 text-base text-dim">{suffix}</span>
      </p>
    </div>
  );
}
