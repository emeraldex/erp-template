"use client";

import { useSession } from "@/lib/use-session";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { CompanyProfile, Modules, PortalSettings, Settings, Terms } from "@/lib/types";
import { DEFAULT_TERMS, useVocab } from "@/lib/vocab";
import { Button, PageHeader, Panel } from "@/components/ui";

const inputClass = "mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace disabled:opacity-60";

const FIELDS: [keyof Omit<CompanyProfile, "address">, string][] = [
  ["name", "Company name *"],
  ["registrationNo", "Registration no."],
  ["taxRegistrationNo", "Tax registration no."],
  ["phone", "Phone"],
  ["email", "Email"],
  ["signatoryName", "Signatory name (letters)"],
  ["signatoryTitle", "Signatory title"],
];

export default function SettingsPage() {
  const { t } = useLang();
  useSession();
  const { can } = useVocab();
  const isAdmin = can("org.admin");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<Settings>("/settings").then((s) => { setSettings(s); setAddress(s.company.address.join("\n")); }).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  if (!settings) return <p className="eyebrow py-20 text-center">{msg?.text ?? "LOADING…"}</p>;

  const setCompany = (k: keyof CompanyProfile, v: string) => setSettings({ ...settings, company: { ...settings.company, [k]: v } });

  async function save(kind: "company" | "tax") {
    setBusy(true);
    setMsg(null);
    try {
      if (kind === "company") {
        const company = await api.patch<CompanyProfile>("/settings/company", { ...settings!.company, address: address.split("\n") });
        setSettings({ ...settings!, company });
        setAddress(company.address.join("\n"));
        setMsg({ ok: true, text: "Company profile saved — new documents use it." });
      } else {
        const tax = await api.patch<Settings["tax"]>("/settings/tax", { label: settings!.tax.label, ratePct: Number(settings!.tax.ratePct) });
        setSettings({ ...settings!, tax });
        setMsg({ ok: true, text: `Tax set to ${tax.label} ${tax.ratePct}% for invoices drafted from now on.` });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow={isAdmin ? "Organisation settings · ADMIN" : "Organisation settings · read-only for your role"} title={t("settings")} />
      {msg && (
        <p className={`mb-4 rounded border px-3 py-2 text-sm ${msg.ok ? "border-phosphor/40 bg-phosphor/5 text-phosphor" : "border-brand-bright/40 bg-brand-bright/10 text-brand-bright"}`}>{msg.text}</p>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel ticked className="fade-up p-5 lg:col-span-2">
          <p className="eyebrow mb-1">Company profile</p>
          <p className="mb-4 text-sm text-steel">Printed on tax invoices, covering letters and delivery notes.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(([k, label]) => (
              <label key={k} className="block">
                <span className="mono mb-1 block text-[10px] tracking-widest text-steel">{label}</span>
                <input value={settings.company[k]} disabled={!isAdmin} onChange={(e) => setCompany(k, e.target.value)} className={inputClass} />
              </label>
            ))}
            <label className="block sm:col-span-2">
              <span className="mono mb-1 block text-[10px] tracking-widest text-steel">Address (one line per row, up to 6)</span>
              <textarea rows={3} value={address} disabled={!isAdmin} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
            </label>
          </div>
          {isAdmin && <div className="mt-4"><Button disabled={busy} onClick={() => save("company")}>Save company profile</Button></div>}
        </Panel>

        <Panel className="fade-up d2 p-5">
          <p className="eyebrow mb-1">Tax</p>
          <p className="mb-4 text-sm text-steel">
            Applied to invoices drafted after a change. Invoices already drafted keep the rate they were raised with.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mono mb-1 block text-[10px] tracking-widest text-steel">Tax name</span>
              <input value={settings.tax.label} disabled={!isAdmin} onChange={(e) => setSettings({ ...settings, tax: { ...settings.tax, label: e.target.value } })} className={inputClass} />
            </label>
            <label className="block">
              <span className="mono mb-1 block text-[10px] tracking-widest text-steel">Rate (%)</span>
              <input type="number" min={0} max={100} step={0.01} value={settings.tax.ratePct} disabled={!isAdmin}
                onChange={(e) => setSettings({ ...settings, tax: { ...settings.tax, ratePct: e.target.value as unknown as number } })} className={inputClass} />
            </label>
          </div>
          <p className="mono mt-2 text-[10.5px] text-dim">Set the tax your contracts require (for example SST 8% in Malaysia).</p>
          {isAdmin && <div className="mt-4"><Button disabled={busy} onClick={() => save("tax")}>Save tax</Button></div>}
        </Panel>
            </div>
      {isAdmin && <SectorSettings settings={settings} onSaved={(next) => setSettings({ ...settings, ...next })} />}
      {isAdmin && settings.modules?.requests && settings.portal && <PortalSettingsPanel initial={settings.portal} />}
      {isAdmin && <SsoSettings />}
    </div>
  );
}

type Sso = { enabled: boolean; issuer: string; clientId: string; label: string; allowPasswordLogin: boolean; hasClientSecret: boolean; callbackUrl: string };

/** Single sign-on with the organisation's identity provider (OpenID Connect). */
function SsoSettings() {
  const [sso, setSso] = useState<Sso | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { api.get<Sso>("/auth/sso/settings").then(setSso).catch((e) => setMsg({ ok: false, text: (e as Error).message })); }, []);
  if (!sso) return msg ? <p className="mt-5 text-sm text-brand-bright">{msg.text}</p> : null;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await api.put<Sso>("/auth/sso/settings", {
        enabled: sso!.enabled, issuer: sso!.issuer, clientId: sso!.clientId, label: sso!.label,
        allowPasswordLogin: sso!.allowPasswordLogin, ...(secret ? { clientSecret: secret } : {}),
      });
      setSso(saved);
      setSecret("");
      setMsg({ ok: true, text: saved.enabled ? "Single sign-on is on. Test it in a private window before signing out." : "Single sign-on is off." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="fade-up d3 mt-5 p-5">
      <p className="eyebrow mb-1">Single sign-on</p>
      <p className="mb-4 text-sm text-steel">
        Let people sign in with their organisation account — Microsoft Entra ID, Google Workspace, Okta, Keycloak or any OpenID Connect provider.
        Users must already exist here; they are matched by email.
      </p>
      <div className="mb-4 rounded border hairline bg-ink-deep/50 px-3 py-2">
        <p className="mono text-[10px] tracking-widest text-steel">REDIRECT URI TO REGISTER WITH YOUR PROVIDER</p>
        <p className="mono break-all text-xs text-trace">{sso.callbackUrl}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="mono mb-1 block text-[10px] tracking-widest text-steel">Issuer URL</span>
          <input value={sso.issuer} placeholder="https://login.microsoftonline.com/<tenant-id>/v2.0" onChange={(e) => setSso({ ...sso, issuer: e.target.value })} className={inputClass} /></label>
        <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-steel">Client (application) ID</span>
          <input value={sso.clientId} onChange={(e) => setSso({ ...sso, clientId: e.target.value })} className={inputClass} /></label>
        <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-steel">Client secret</span>
          <input type="password" value={secret} placeholder={sso.hasClientSecret ? "•••••••• stored — type to replace" : "optional for public clients"} onChange={(e) => setSecret(e.target.value)} className={inputClass} autoComplete="new-password" /></label>
        <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-steel">Button text: "Sign in with …"</span>
          <input value={sso.label} onChange={(e) => setSso({ ...sso, label: e.target.value })} className={inputClass} /></label>
      </div>
      <div className="mt-4 space-y-2">
        <label className="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={sso.enabled} onChange={(e) => setSso({ ...sso, enabled: e.target.checked })} className="accent-[var(--c-red)]" />Enable single sign-on</label>
        <label className="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={sso.allowPasswordLogin} onChange={(e) => setSso({ ...sso, allowPasswordLogin: e.target.checked })} className="accent-[var(--c-red)]" />Also allow passwords for everyone</label>
        <p className="mono text-[10.5px] text-dim">With passwords off, administrators can still sign in with a password, so a provider outage can never lock everyone out.</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={save}>{busy ? "CHECKING PROVIDER…" : "Save single sign-on"}</Button>
        {msg && <span className={`text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</span>}
      </div>
    </Panel>
  );
}

const TERM_LABELS: [keyof Terms, string][] = [
  ["job", "A work item"], ["jobs", "Work items (plural)"], ["jobNo", "Its number"], ["jobRegister", "The register"],
  ["component", "What is worked on"], ["originUnit", "Who asks for it"], ["site", "A site"], ["sites", "Sites (plural)"],
  ["asset", "An asset"], ["assets", "Assets (plural)"], ["pm", "Preventive maintenance"], ["priority", "Priority"],
  ["demand", "A parts request"], ["demands", "Purchasing area"], ["vendorRepair", "A vendor repair"], ["vendorRepairs", "Vendor repairs area"],
  ["incident", "An incident"], ["incidents", "Incidents area"], ["registers", "Supplier register"],
];

const MODULE_LABELS: [keyof Modules, string][] = [
  ["assets", "Asset register & meters"], ["pm", "Preventive maintenance (needs assets)"], ["procurement", "Parts requests & purchasing"],
  ["stock", "Parts catalogue & stock control"], ["requests", "Request portal (anyone can report a problem)"],
  ["vendorRepair", "Repairs at vendors / OEMs"], ["priority", "Priority escalation"], ["invoicing", "Invoicing"],
  ["registers", "Supplier & contractor register"], ["incidents", "Safety incidents"], ["tools", "Tool control"], ["training", "Training records"],
];

/** The organisation's own words, the parts of the system it uses, and numbering. */
function SectorSettings({ settings, onSaved }: { settings: Settings; onSaved: (s: Partial<Settings>) => void }) {
  const { dict } = useVocab();
  const [terms, setTerms] = useState<Terms>({ ...DEFAULT_TERMS, ...(settings.terms ?? {}) });
  const [modules, setModules] = useState<Modules | undefined>(settings.modules);
  const [defaults, setDefaults] = useState(settings.defaults ?? { jobPrefix: "", initialLocation: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(kind: "terms" | "modules" | "defaults") {
    setBusy(true); setMsg(null);
    try {
      const body = kind === "terms" ? terms : kind === "modules" ? modules : defaults;
      const saved = await api.patch<unknown>(`/settings/${kind}`, body);
      onSaved({ [kind]: saved } as Partial<Settings>);
      setMsg({ ok: true, text: "Saved — reloading so every screen uses it." });
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <Panel className="fade-up d3 mt-5 p-5">
      <p className="eyebrow mb-1">Your sector{settings.pack ? ` · started from the ${settings.pack.name} pack` : ""}</p>
      <p className="mb-4 text-sm text-steel">
        The words the screens use, which parts of the system you use, and how work orders are numbered. Statuses, steps,
        roles and lists are changed in the workflow editor.
      </p>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <p className="mono mb-2 text-[10px] tracking-widest text-steel">TERMINOLOGY</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {TERM_LABELS.map(([k, label]) => (
              <label key={k} className="block">
                <span className="mono mb-1 block text-[10px] tracking-widest text-dim">{label}</span>
                <input value={terms[k]} onChange={(e) => setTerms({ ...terms, [k]: e.target.value })} className={inputClass} />
              </label>
            ))}
          </div>
          <div className="mt-3"><Button disabled={busy} onClick={() => save("terms")}>Save terminology</Button></div>
        </div>
        <div className="space-y-6">
          {modules && (
            <div>
              <p className="mono mb-2 text-[10px] tracking-widest text-steel">MODULES</p>
              <div className="space-y-1.5">
                {MODULE_LABELS.map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-sm text-fg">
                    <input type="checkbox" checked={modules[k]} onChange={(e) => setModules({ ...modules, [k]: e.target.checked })} className="accent-[var(--c-red)]" />
                    {label}
                  </label>
                ))}
              </div>
              <div className="mt-3"><Button disabled={busy} onClick={() => save("modules")}>Save modules</Button></div>
            </div>
          )}
          <div>
            <p className="mono mb-2 text-[10px] tracking-widest text-steel">NUMBERING & DEFAULTS</p>
            <label className="block">
              <span className="mono mb-1 block text-[10px] tracking-widest text-dim">Number prefix (e.g. WO → WO-2026-0001)</span>
              <input value={defaults.jobPrefix} onChange={(e) => setDefaults({ ...defaults, jobPrefix: e.target.value.toUpperCase() })} className={inputClass} />
            </label>
            <label className="mt-2 block">
              <span className="mono mb-1 block text-[10px] tracking-widest text-dim">Where new items start</span>
              <select value={defaults.initialLocation} onChange={(e) => setDefaults({ ...defaults, initialLocation: e.target.value })} className={inputClass}>
                {dict("location").map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </label>
            <div className="mt-3"><Button disabled={busy} onClick={() => save("defaults")}>Save defaults</Button></div>
          </div>
        </div>
      </div>
      {msg && <p className={`mt-4 text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</p>}
    </Panel>
  );
}

/** The public request portal: its address, whether it is open, the access code and the text above the form. */
function PortalSettingsPanel({ initial }: { initial: PortalSettings }) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const link = typeof window !== "undefined" ? `${window.location.origin}/r` : "/r";

  async function save() {
    setBusy(true); setMsg(null);
    try {
      setP(await api.patch<PortalSettings>("/settings/portal", p));
      setMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <Panel className="fade-up d4 mt-5 p-5">
      <p className="eyebrow mb-1">Request portal</p>
      <p className="mb-4 text-sm text-steel">
        Anyone with the link can report a problem — tenants, drivers, operators, ward staff — without an account. Requests arrive in
        <a href="/requests" className="mx-1 text-trace hover:underline">Requests</a>for the help desk to accept, add to a work order or decline.
        Print QR posters there for places and assets.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border hairline bg-ink-deep/40 px-3 py-2">
        <span className="mono text-xs text-fg">{link}</span>
        <button onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)); }} className="mono text-[10.5px] tracking-widest text-steel hover:text-trace">{copied ? "COPIED" : "COPY"}</button>
        <a href="/r" target="_blank" rel="noreferrer" className="mono text-[10.5px] tracking-widest text-steel hover:text-trace">OPEN ↗</a>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={p.open} onChange={(e) => setP({ ...p, open: e.target.checked })} className="accent-[var(--c-red)]" />
            The form accepts new requests
          </label>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={p.askCategory} onChange={(e) => setP({ ...p, askCategory: e.target.checked })} className="accent-[var(--c-red)]" />
            Ask what type of problem it is
          </label>
          <label className="block">
            <span className="mono mb-1 block text-[10px] tracking-widest text-dim">Access code (empty = none; QR posters never need it)</span>
            <input value={p.accessCode} onChange={(e) => setP({ ...p, accessCode: e.target.value })} placeholder="e.g. TOWER-7" className={inputClass} />
          </label>
          <label className="block">
            <span className="mono mb-1 block text-[10px] tracking-widest text-dim">Remind the help desk after (hours; 0 = never)</span>
            <input inputMode="numeric" value={String(p.triageHours)} onChange={(e) => setP({ ...p, triageHours: Number(e.target.value.replace(/\D/g, "") || 0) })} className={inputClass} />
          </label>
        </div>
        <label className="block lg:col-span-1">
          <span className="mono mb-1 block text-[10px] tracking-widest text-dim">Text above the form (English)</span>
          <textarea rows={5} maxLength={500} value={p.intro} onChange={(e) => setP({ ...p, intro: e.target.value })} placeholder="e.g. For emergencies call 03-1234 5678." className={inputClass} />
        </label>
        <label className="block lg:col-span-1">
          <span className="mono mb-1 block text-[10px] tracking-widest text-dim">Text above the form (Bahasa Melayu)</span>
          <textarea rows={5} maxLength={500} value={p.introMs} onChange={(e) => setP({ ...p, introMs: e.target.value })} placeholder="cth. Untuk kecemasan hubungi 03-1234 5678." className={inputClass} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={busy} onClick={save}>Save portal settings</Button>
        {msg && <span className={`text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</span>}
      </div>
    </Panel>
  );
}
