"use client";

import { useSession } from "@/lib/use-session";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { CompanyProfile, Settings } from "@/lib/types";
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
  const isAdmin = useSession()?.user.role === "ADMIN";
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
          <p className="mono mt-2 text-[10.5px] text-dim">The RFP specifies GST at 6%. Malaysia currently levies SST — set what your contract requires.</p>
          {isAdmin && <div className="mt-4"><Button disabled={busy} onClick={() => save("tax")}>Save tax</Button></div>}
        </Panel>
            </div>
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
