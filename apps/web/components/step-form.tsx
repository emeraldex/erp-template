"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { photoName, resizePhoto } from "@/lib/images";
import type { Attachment, Part, StaffMember, StepField } from "@/lib/types";
import { useVocab } from "@/lib/vocab";

let staffCache: Promise<StaffMember[]> | null = null;
/** Active staff for person pickers, fetched once per page load. */
export function loadStaff(): Promise<StaffMember[]> {
  staffCache ??= api.get<StaffMember[]>("/users/directory").catch((e) => {
    staffCache = null;
    throw e;
  });
  return staffCache;
}

let partsCache: Promise<Part[]> | null = null;
/** The active parts catalogue, for part pickers, fetched once per page load. */
export function loadParts(): Promise<Part[]> {
  partsCache ??= api.get<Part[]>("/stock/parts").catch((e) => {
    partsCache = null;
    throw e;
  });
  return partsCache;
}

const T = {
  takePhoto: { en: "Take or choose a photo", ms: "Ambil atau pilih foto" },
  uploading: { en: "Sending…", ms: "Menghantar…" },
  replace: { en: "Replace", ms: "Ganti" },
  clear: { en: "Clear", ms: "Padam" },
  signHere: { en: "Sign here", ms: "Tandatangan di sini" },
  signerName: { en: "Name of the person signing", ms: "Nama orang yang menandatangani" },
  saveSignature: { en: "Save signature", ms: "Simpan tandatangan" },
  signedBy: { en: "Signed by", ms: "Ditandatangani oleh" },
  choose: { en: "— choose —", ms: "— pilih —" },
  optional: { en: "optional", ms: "pilihan" },
  searchParts: { en: "Search part no. or name…", ms: "Cari no. alat ganti atau nama…" },
  noParts: { en: "No part matches", ms: "Tiada alat ganti yang sepadan" },
  inStock: { en: "in stock", ms: "dalam stok" },
} as const;

export interface StepFormProps {
  fields: StepField[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  /** The record photos and signatures are attached to, e.g. ("job", "WO-2026-0001"). */
  entity: string;
  entityId: string;
  /** Bigger inputs for phones. */
  large?: boolean;
  disabled?: boolean;
}

/**
 * The mandatory fields of a workflow step, each with the right input: number
 * pad, date picker, staff picker, camera, or signature pad. Photo and
 * signature fields upload straight away and hold the attachment id.
 */
export function StepForm({ fields, values, onChange, entity, entityId, large, disabled }: StepFormProps) {
  const { lang } = useLang();
  const set = (key: string, v: string) => onChange({ ...values, [key]: v });
  const input = `mono w-full rounded-md border hairline bg-panel text-fg outline-none transition-colors focus:border-trace disabled:opacity-60 ${
    large ? "px-3 py-3 text-base" : "px-3 py-2 text-xs"
  }`;
  return (
    <div className={`grid gap-3 ${large ? "" : "sm:grid-cols-2"}`}>
      {fields.map((f) => {
        const type = f.type ?? "text";
        const wide = type === "photo" || type === "signature";
        return (
          <label key={f.key} className={`block ${wide && !large ? "sm:col-span-2" : ""}`}>
            <span className={`mb-1 block tracking-wide text-steel ${large ? "text-sm" : "mono text-[10.5px] tracking-widest"}`}>
              {f.formNo && <span className="mr-1.5 text-brand-bright">{f.formNo}</span>}
              {f.label} {f.optional ? <span className="text-dim">({T.optional[lang]})</span> : "*"}
            </span>
            {type === "number" ? (
              <input type="text" inputMode="decimal" value={values[f.key] ?? ""} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} className={input} />
            ) : type === "date" ? (
              <input type="date" value={values[f.key] ?? ""} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} className={input} />
            ) : type === "user" ? (
              <PersonPicker value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} className={input} disabled={disabled} />
            ) : type === "photo" ? (
              <PhotoField value={values[f.key]} onChange={(v) => set(f.key, v)} entity={entity} entityId={entityId} large={large} disabled={disabled} caption={f.label} />
            ) : type === "part" ? (
              <PartPicker value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} className={input} disabled={disabled} />
            ) : type === "store" ? (
              <StorePicker value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} className={input} disabled={disabled} />
            ) : type === "signature" ? (
              <SignatureField value={values[f.key]} onChange={(v) => set(f.key, v)} entity={entity} entityId={entityId} large={large} disabled={disabled} />
            ) : (
              <input value={values[f.key] ?? ""} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} className={input} />
            )}
          </label>
        );
      })}
    </div>
  );
}

/** True when every mandatory field has a value (photos and signatures uploaded). */
export function stepComplete(fields: StepField[], values: Record<string, string>): boolean {
  return fields.every((f) => f.optional || !!values[f.key]?.trim());
}

/** Choose a catalogue part: type to narrow the list, then pick. Shows what is in stock. */
function PartPicker({ value, onChange, className, disabled }: { value: string; onChange: (v: string) => void; className: string; disabled?: boolean }) {
  const { lang } = useLang();
  const [parts, setParts] = useState<Part[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { loadParts().then(setParts).catch((e) => setError((e as Error).message)); }, []);
  if (error) return <p className="text-sm text-brand-bright">{error}</p>;
  const needle = q.trim().toLowerCase();
  const shown = (parts ?? [])
    .filter((p) => p.id === value || !needle || `${p.partNo} ${p.name} ${p.manufacturer} ${p.mfrPartNo}`.toLowerCase().includes(needle))
    .slice(0, 60);
  return (
    <div className="space-y-1.5">
      <input value={q} disabled={disabled || !parts} onChange={(e) => setQ(e.target.value)} placeholder={T.searchParts[lang]} className={className} />
      <select value={value} disabled={disabled || !parts} onChange={(e) => onChange(e.target.value)} className={className}>
        <option value="">{!parts ? "…" : shown.length ? T.choose[lang] : T.noParts[lang]}</option>
        {shown.map((p) => <option key={p.id} value={p.id}>{p.partNo} · {p.name} — {p.onHand} {p.unit} {T.inStock[lang]}</option>)}
      </select>
    </div>
  );
}

/** Choose one of the organisation's stores. */
function StorePicker({ value, onChange, className, disabled }: { value: string; onChange: (v: string) => void; className: string; disabled?: boolean }) {
  const { lang } = useLang();
  const { dict } = useVocab();
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{T.choose[lang]}</option>
      {dict("store").map((s) => <option key={s.key} value={s.key}>{lang === "ms" && s.labelMs ? s.labelMs : s.label}</option>)}
    </select>
  );
}

function PersonPicker({ value, onChange, className, disabled }: { value: string; onChange: (v: string) => void; className: string; disabled?: boolean }) {
  const { lang } = useLang();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadStaff().then(setStaff).catch((e) => setError((e as Error).message)); }, []);
  if (error) return <p className="text-sm text-brand-bright">{error}</p>;
  return (
    <select value={value} disabled={disabled || !staff} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{staff ? T.choose[lang] : "…"}</option>
      {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.role}</option>)}
    </select>
  );
}

async function sendAttachment(entity: string, entityId: string, blob: Blob, filename: string, extra: Record<string, string>): Promise<Attachment> {
  const form = new FormData();
  form.append("file", blob, filename);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return api.upload<Attachment>(`/attachments/${entity.toLowerCase()}/${encodeURIComponent(entityId)}`, form);
}

function PhotoField({ value, onChange, entity, entityId, large, disabled, caption }: {
  value?: string; onChange: (v: string) => void; entity: string; entityId: string; large?: boolean; disabled?: boolean; caption: string;
}) {
  const { lang } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function pick(file: File) {
    setBusy(true); setError(null);
    try {
      const blob = await resizePhoto(file);
      const a = await sendAttachment(entity, entityId, blob, photoName(file.name), { kind: "photo", caption });
      setPreview(URL.createObjectURL(blob));
      onChange(a.id);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {preview && value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" className={`${large ? "h-24 w-24" : "h-16 w-16"} rounded border hairline object-cover`} />
      )}
      <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()}
        className={`rounded-md border hairline text-steel transition-colors hover:border-trace hover:text-fg disabled:opacity-50 ${large ? "px-4 py-3 text-base" : "mono px-3 py-2 text-[11px] tracking-widest"}`}>
        {busy ? T.uploading[lang] : value ? T.replace[lang] : `📷 ${T.takePhoto[lang]}`}
      </button>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }} />
      {error && <p className="w-full text-sm text-brand-bright">{error}</p>}
    </div>
  );
}

function SignatureField({ value, onChange, entity, entityId, large, disabled }: {
  value?: string; onChange: (v: string) => void; entity: string; entityId: string; large?: boolean; disabled?: boolean;
}) {
  const { lang } = useLang();
  const [name, setName] = useState("");
  const [signed, setSigned] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = useRef<SignaturePadHandle>(null);

  async function save() {
    const blob = await pad.current?.toPng();
    if (!blob) { setError(lang === "ms" ? "Sila tandatangan dahulu" : "Please sign first"); return; }
    setBusy(true); setError(null);
    try {
      const a = await sendAttachment(entity, entityId, blob, "signature.png", { kind: "signature", signedBy: name.trim() });
      setSigned(name.trim());
      onChange(a.id);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  if (value && signed) {
    return (
      <div className="flex items-center gap-3">
        <p className={large ? "text-base text-phosphor" : "text-sm text-phosphor"}>✓ {T.signedBy[lang]} {signed}</p>
        <button type="button" disabled={disabled} onClick={() => { onChange(""); setSigned(null); }} className="mono text-[11px] tracking-widest text-steel hover:text-fg">
          {T.replace[lang]}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <SignaturePad ref={pad} height={large ? 180 : 140} disabled={disabled || busy} placeholder={T.signHere[lang]} />
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={T.signerName[lang]} disabled={disabled || busy}
          className={`mono min-w-0 flex-1 rounded-md border hairline bg-panel text-fg outline-none focus:border-trace ${large ? "px-3 py-3 text-base" : "px-3 py-2 text-xs"}`} />
        <button type="button" onClick={() => pad.current?.clear()} disabled={disabled || busy} className="mono rounded-md border hairline px-3 py-2 text-[11px] tracking-widest text-steel hover:text-fg">
          {T.clear[lang]}
        </button>
        <button type="button" onClick={save} disabled={disabled || busy || name.trim().length < 2}
          className="mono rounded-md border border-brand bg-brand/20 px-3 py-2 text-[11px] tracking-widest text-fg disabled:opacity-50">
          {busy ? T.uploading[lang] : T.saveSignature[lang]}
        </button>
      </div>
      {error && <p className="text-sm text-brand-bright">{error}</p>}
    </div>
  );
}

export interface SignaturePadHandle {
  clear(): void;
  /** The drawing as a PNG, or null when nothing was drawn. */
  toPng(): Promise<Blob | null>;
}

/** A finger / mouse drawing area that produces a PNG. */
export const SignaturePad = forwardRef<SignaturePadHandle, { height: number; disabled?: boolean; placeholder: string }>(function SignaturePad(
  { height, disabled, placeholder }, ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    // Match the drawing buffer to the displayed size for crisp lines.
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    c.width = c.clientWidth * ratio;
    c.height = height * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111111";
  }, [height]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  useImperativeHandle(ref, () => ({
    clear() {
      const c = canvas.current;
      if (!c) return;
      c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
      setEmpty(true);
    },
    async toPng() {
      if (empty || !canvas.current) return null;
      return new Promise<Blob | null>((resolve) => canvas.current!.toBlob(resolve, "image/png"));
    },
  }), [empty]);

  return (
    <div className="relative overflow-hidden rounded-md border hairline bg-white" style={{ height }}>
      <canvas
        ref={canvas}
        className="block h-full w-full touch-none"
        aria-label={placeholder}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = point(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 0.1, p.y + 0.1);
          ctx.stroke();
          setEmpty(false);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = point(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => { drawing.current = false; }}
        onPointerCancel={() => { drawing.current = false; }}
      />
      {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-400">{placeholder}</span>}
    </div>
  );
});
