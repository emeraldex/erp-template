"use client";

import { useState } from "react";
import { AuditEntry, FormRecord, Role, StatusMeta, TransitionRule } from "@/lib/types";
import { useLang } from "@/lib/i18n";
import { Button, FormChip, MetaPill } from "./ui";
import { StepForm, stepComplete } from "./step-form";

/**
 * FR-02/03/05 in one component: renders the transition buttons and their
 * mandatory-field forms *from the workflow config*, gated to the signed-in
 * user's role (the QP "process owner"). Change a rule on the server and
 * this UI changes — no recoding.
 */
export function TransitionActions<S extends string>({
  status,
  rules,
  meta,
  userRole,
  busy,
  onTransition,
  entity = "",
  entityId = "",
}: {
  status: S;
  rules: TransitionRule<S>[];
  meta: Record<string, StatusMeta>;
  userRole: Role;
  busy: boolean;
  onTransition: (to: S, fields: Record<string, string>) => void;
  /** The record, for photo and signature fields (e.g. "job", "WO-2026-0001"). */
  entity?: string;
  entityId?: string;
}) {
  const { lang, t } = useLang();
  const [openTo, setOpenTo] = useState<S | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const available = rules.filter((r) => r.from === status);
  const mine = available.filter((r) => userRole === "ADMIN" || r.roles.includes(userRole));

  if (available.length === 0) return null;

  const active = mine.find((r) => r.to === openTo);

  return (
    <div className="border-t hairline pt-4">
      <p className="eyebrow mb-3">{t("actions")}</p>

      {mine.length === 0 ? (
        <p className="text-sm text-dim">
          {t("noActions")} —{" "}
          <span className="mono text-[11px] tracking-widest">
            {t("processOwner")}: {[...new Set(available.flatMap((r) => r.roles))].join(" | ")}
          </span>
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {mine.map((r) => {
            const tone = meta[r.to]?.tone;
            return (
              <Button
                key={r.to}
                variant={tone === "bad" ? "danger" : openTo === r.to ? "primary" : "ghost"}
                disabled={busy}
                onClick={() => {
                  setFields({});
                  setOpenTo(openTo === r.to ? null : r.to);
                  if (r.requires.length === 0 && openTo !== r.to) {
                    onTransition(r.to, {});
                    setOpenTo(null);
                  }
                }}
              >
                {lang === "ms" ? r.labelMs : r.label}
              </Button>
            );
          })}
        </div>
      )}

      {/* mandatory-field form (FR-05) rendered from the rule definition */}
      {active && active.requires.length > 0 && (
        <div className="fade-up mt-4 rounded-md border hairline bg-ink-deep/50 p-4">
          <p className="eyebrow mb-3">
            {status} → <MetaPill status={active.to} meta={meta[active.to]} lang={lang} />
          </p>
          <StepForm fields={active.requires} values={fields} onChange={setFields} entity={entity} entityId={entityId} disabled={busy} />
          <div className="mt-4 flex gap-2">
            <Button
              disabled={busy || !stepComplete(active.requires, fields)}
              onClick={() => {
                onTransition(active.to, fields);
                setOpenTo(null);
              }}
            >
              {t("submit")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** FR-04 — timestamped who/what/when history with keyed-in field values. */
export function AuditTrail({ audit }: { audit: AuditEntry[] }) {
  const { t } = useLang();
  return (
    <div>
      <p className="eyebrow mb-3">{t("auditTrail")}</p>
      <ol className="relative space-y-3 border-l hairline pl-4">
        {[...audit].reverse().map((e, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand" />
            <p className="text-sm">{e.action}</p>
            <p className="mono text-[10.5px] tracking-widest text-dim">
              {e.at.slice(0, 16).replace("T", " ")} · {e.by} · {e.role}
            </p>
            {e.fields && (
              <p className="mono mt-0.5 text-[10.5px] text-steel/80">
                {Object.entries(e.fields).map(([k, v]) => `${k}=${v}`).join("  ")}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Section 6 forms register — the controlled records filed against the entity. */
export function RecordsList({ records }: { records: FormRecord[] }) {
  const { t } = useLang();
  if (records.length === 0) return null;
  return (
    <div>
      <p className="eyebrow mb-2">{t("records")}</p>
      <div className="flex flex-wrap gap-1.5">
        {records.map((r, i) => (
          <FormChip key={i} formNo={r.formNo} refNo={r.refNo} />
        ))}
      </div>
    </div>
  );
}

/** Lifecycle rail — the QP.44 stages as a progress spine. */
export function StageRail<S extends string>({
  order,
  current,
  meta,
  branches,
}: {
  order: S[];
  current: S;
  meta: Record<string, StatusMeta>;
  branches?: S[]; // off-rail statuses (BER / SOR / REC_OV)
}) {
  const { lang } = useLang();
  const idx = order.indexOf(current);
  const onBranch = idx === -1;
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-max items-center gap-0.5">
        {order.map((s, i) => {
          const state = onBranch ? "future" : i < idx ? "done" : i === idx ? "now" : "future";
          return (
            <div key={s} className="flex items-center">
              {i > 0 && (
                <span
                  className={`h-px w-6 ${state === "future" ? "bg-[var(--c-line)]" : "bg-brand"}`}
                />
              )}
              <span
                className={`mono whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] tracking-widest transition-all ${
                  state === "now"
                    ? "border-brand bg-brand/15 text-fg shadow-[0_0_14px_rgba(200,16,46,0.35)]"
                    : state === "done"
                      ? "border-brand/40 text-steel"
                      : "hairline text-dim"
                }`}
              >
                {meta[s]?.[lang] ?? s}
              </span>
            </div>
          );
        })}
        {onBranch && branches?.includes(current) && (
          <div className="ml-3 flex items-center gap-2">
            <span className="mono text-[10px] tracking-widest text-dim">BRANCH →</span>
            <MetaPill status={current} meta={meta[current]} lang={lang} />
          </div>
        )}
      </div>
    </div>
  );
}
