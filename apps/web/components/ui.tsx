import { ReactNode } from "react";

export function Panel({
  children,
  className = "",
  ticked = false,
}: {
  children: ReactNode;
  className?: string;
  ticked?: boolean;
}) {
  return <div className={`panel ${ticked ? "ticked" : ""} ${className}`}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="fade-up mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow mb-1">{eyebrow}</p>
        <h1 className="display text-3xl font-bold text-fg">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  neutral: "text-steel border-steel/30",
  info: "text-trace border-trace/40",
  warn: "text-amber border-amber/40",
  good: "text-phosphor border-phosphor/40",
  bad: "text-brand-bright border-brand-bright/50",
};

/** Status pill driven by /config StatusMeta — bilingual label + tone (FR-02). */
export function MetaPill({
  status,
  meta,
  lang = "en",
}: {
  status: string;
  meta?: { en: string; ms: string; tone: string };
  lang?: "en" | "ms";
}) {
  const tone = TONE_CLASS[meta?.tone ?? "neutral"] ?? TONE_CLASS.neutral;
  const label = meta ? meta[lang] : status.replaceAll("_", " ");
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded-full border bg-ink-deep/60 px-2.5 py-0.5 text-[10.5px] tracking-widest ${tone} ${
        meta?.tone === "bad" ? "pulse-aog" : ""
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

/** Plain pill for statuses without config meta (FOD, partners, tools). */
export function StatusPill({ value, tone = "neutral" }: { value: string; tone?: keyof typeof TONE_CLASS }) {
  return (
    <span className={`mono inline-flex items-center gap-1.5 rounded-full border bg-ink-deep/60 px-2.5 py-0.5 text-[10.5px] tracking-widest ${TONE_CLASS[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {value.replaceAll("_", " ")}
    </span>
  );
}

/** Section 6 form-record chip, e.g. F116 · TDI-2026-0098. */
export function FormChip({ formNo, refNo }: { formNo: string; refNo: string }) {
  return (
    <span className="mono inline-flex items-center gap-1.5 rounded border hairline bg-ink-deep/50 px-2 py-1 text-[10.5px] text-steel">
      <span className="text-brand-bright">{formNo}</span>
      {refNo}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const styles = {
    primary:
      "bg-brand text-white hover:bg-brand-bright shadow-[0_0_18px_rgba(200,16,46,0.35)] hover:shadow-[0_0_26px_rgba(255,59,78,0.45)]",
    ghost: "border hairline bg-panel-2/40 text-steel hover:text-fg hover:border-steel/50",
    danger: "border border-brand-bright/50 text-brand-bright hover:bg-brand-bright/10",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`display rounded-md px-4 py-2 text-sm font-semibold tracking-wider transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Table({
  head,
  children,
}: {
  head: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b hairline">
            {head.map((h) => (
              <th key={h} className="eyebrow px-4 py-3 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={`border-b hairline transition-colors last:border-0 ${
        onClick ? "cursor-pointer hover:bg-panel-2/60" : ""
      }`}
    >
      {children}
    </tr>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle text-fg/90 ${className}`}>{children}</td>;
}

export function OfflineNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="mono mb-4 inline-block rounded border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber">
      DEMO DATA — the API is not reachable, so bundled sample records are shown.
    </p>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="panel flex flex-col items-center gap-1 px-6 py-14 text-center">
      <p className="display text-lg text-steel">{title}</p>
      <p className="text-sm text-dim">{hint}</p>
    </div>
  );
}
