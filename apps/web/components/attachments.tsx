"use client";

import { useEffect, useRef, useState } from "react";
import { useVocab } from "@/lib/vocab";
import { api, download } from "@/lib/api";
import { Attachment } from "@/lib/types";
import { Button } from "./ui";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.xlsx,.docx,.csv,.txt";

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

/**
 * Files on a record. Uploads are permanent (attachments are evidence), so a
 * wrong file is superseded by uploading the right one. The SHA-256 shown is
 * re-checked by the server on every download.
 */
export function AttachmentsPanel({
  entity, entityId, canUpload = true, formNos = [],
}: { entity: Attachment["entity"]; entityId: string; canUpload?: boolean; formNos?: string[] }) {
  const { aviation } = useVocab();
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [formNo, setFormNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = () =>
    api.get<Attachment[]>(`/attachments/${entity.toLowerCase()}/${encodeURIComponent(entityId)}`)
      .then(setItems)
      .catch(() => setItems([]));

  useEffect(() => { load(); }, [entity, entityId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (formNo.trim()) form.append("formNo", formNo.trim());
      await api.upload(`/attachments/${entity.toLowerCase()}/${encodeURIComponent(entityId)}`, form);
      setFormNo("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <p className="eyebrow mb-2">Attachments{items ? ` · ${items.length}` : ""}</p>
      {items && items.length === 0 && <p className="mono mb-2 text-[11px] text-dim">No files attached yet.</p>}
      <ul className="mb-3 space-y-1.5">
        {items?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border hairline bg-ink-deep/40 px-3 py-2">
            <div className="min-w-0">
              <button
                onClick={() => download(`/attachments/file/${a.id}`, a.filename).catch((e) => setError((e as Error).message))}
                className="truncate text-left text-sm text-trace hover:underline"
                title="Download"
              >
                {a.filename}
              </button>
              <p className="mono text-[10px] tracking-wider text-dim">
                {a.kind === "photo" && <span className="mr-2 text-trace">PHOTO{a.caption ? ` · ${a.caption}` : ""}</span>}
                {a.kind === "signature" && <span className="mr-2 text-phosphor">SIGNATURE · {a.signedBy}</span>}
                {a.formNo && <span className="mr-2 text-steel">{a.formNo}</span>}
                {size(a.sizeBytes)} · {a.uploadedBy} · {a.uploadedAt.slice(0, 16).replace("T", " ")} ·{" "}
                <span title={`SHA-256 ${a.sha256}`}>SHA-256 {a.sha256.slice(0, 12)}…</span>
              </p>
            </div>
          </li>
        ))}
      </ul>
      {canUpload && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mono mb-1 block text-[10px] tracking-widest text-steel">Form no. (optional)</span>
            <input
              list={`forms-${entity}-${entityId}`}
              value={formNo}
              onChange={(e) => setFormNo(e.target.value)}
              placeholder={aviation ? "e.g. F174" : "e.g. report no."}
              className="mono w-32 rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace"
            />
            <datalist id={`forms-${entity}-${entityId}`}>
              {formNos.map((f) => <option key={f} value={f} />)}
            </datalist>
          </label>
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button variant="ghost" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "UPLOADING…" : "+ ATTACH FILE"}
          </Button>
          <span className="mono text-[10px] text-dim">PDF, images, XLSX, DOCX, CSV · files are kept permanently</span>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-brand-bright">{error}</p>}
    </div>
  );
}
