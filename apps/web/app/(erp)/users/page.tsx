"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useSession } from "@/lib/use-session";
import { Button, PageHeader, Panel } from "@/components/ui";

type User = {
  id: string; name: string; email: string; role: string; designation: string; branch: string; createdAt: string;
  deactivatedAt: string | null; lockedUntil: string | null; mustChangePassword: boolean; lastSignIn: string | null;
};
const ROLES = ["ADMIN", "STORES", "WORKSHOP", "MIS", "MM", "PURCHASING", "PCE", "QUALITY", "FINANCE", "BILLING"];
const BRANCHES = ["HQ", "CENTRAL", "EAST", "NORTH", "NORTHEAST", "OFFSHORE"];
const input = "mono w-full rounded-md border hairline bg-ink-deep px-2.5 py-1.5 text-xs text-fg outline-none focus:border-trace";

export default function UsersPage() {
  const { t } = useLang();
  const session = useSession();
  const [users, setUsers] = useState<User[] | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "STORES", designation: "", branch: "HQ" });
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(() => { api.get<User[]>("/users").then(setUsers).catch((e) => setMsg({ ok: false, text: (e as Error).message })); }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); load(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  async function add() {
    setMsg(null);
    try {
      const res = await api.post<{ user: User; temporaryPassword: string }>("/users", form);
      setSecret({ who: `${res.user.name} <${res.user.email}>`, password: res.temporaryPassword });
      setForm({ name: "", email: "", role: "STORES", designation: "", branch: "HQ" });
      setAdding(false);
      load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  if (session && session.user.role !== "ADMIN") return <p className="py-20 text-center text-sm text-dim">User management is for administrators.</p>;
  const shown = (users ?? []).filter((u) => showInactive || !u.deactivatedAt);
  const now = Date.now();

  return (
    <div>
      <PageHeader
        eyebrow="Staff accounts for this organisation · changes are logged"
        title={t("users")}
        actions={<Button onClick={() => setAdding(!adding)} variant={adding ? "ghost" : "primary"}>{adding ? "Cancel" : "+ Add user"}</Button>}
      />
      {secret && (
        <div className="mb-4 rounded border border-phosphor/40 bg-phosphor/5 px-4 py-3">
          <p className="text-sm text-fg">Temporary password for {secret.who}:</p>
          <p className="mono my-1 select-all text-lg text-phosphor">{secret.password}</p>
          <p className="text-xs text-steel">Shown once. Pass it on securely — they must choose their own at first sign-in. With single sign-on they can ignore it.</p>
          <button onClick={() => setSecret(null)} className="mono mt-2 text-[10.5px] tracking-widest text-steel hover:text-fg">DONE</button>
        </div>
      )}
      {msg && <p className={`mb-4 rounded border px-3 py-2 text-sm ${msg.ok ? "border-phosphor/40 bg-phosphor/5 text-phosphor" : "border-brand-bright/40 bg-brand-bright/10 text-brand-bright"}`}>{msg.text}</p>}

      {adding && (
        <Panel ticked className="fade-up mb-5 p-4">
          <div className="grid gap-2 sm:grid-cols-5">
            <label className="block"><span className="eyebrow mb-1 block">Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} /></label>
            <label className="block sm:col-span-2"><span className="eyebrow mb-1 block">Email</span><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} /></label>
            <label className="block"><span className="eyebrow mb-1 block">Role</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={input}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
            <label className="block"><span className="eyebrow mb-1 block">Branch</span><select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className={input}>{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="block"><span className="eyebrow mb-1 block">Designation</span><input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className={input} /></label>
          </div>
          <div className="mt-3"><Button disabled={!form.name || !form.email} onClick={add}>Create account</Button></div>
        </Panel>
      )}

      <label className="mono mb-3 flex cursor-pointer items-center gap-2 text-[10.5px] tracking-widest text-steel">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-[var(--c-red)]" /> SHOW DEACTIVATED
      </label>
      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="eyebrow border-b hairline text-left">
            <tr>{["Name", "Role", "Branch", "Status", "Last sign-in", ""].map((h) => <th key={h} className="px-4 py-2.5">{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((u) => {
              const locked = u.lockedUntil && Date.parse(u.lockedUntil) > now;
              const self = u.id === session?.user.id;
              return (
                <tr key={u.id} className={`border-b hairline last:border-0 ${u.deactivatedAt ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5"><p className="text-fg">{u.name}{self && <span className="mono ml-2 text-[10px] text-dim">YOU</span>}</p><p className="mono text-[10.5px] text-dim">{u.email}{u.designation && ` · ${u.designation}`}</p></td>
                  <td className="px-4 py-2.5">
                    <select value={u.role} disabled={self || !!u.deactivatedAt} onChange={(e) => act(() => api.patch(`/users/${u.id}`, { role: e.target.value }), `${u.name} is now ${e.target.value}`)} className={`${input} w-32`}>
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <select value={u.branch} disabled={!!u.deactivatedAt} onChange={(e) => act(() => api.patch(`/users/${u.id}`, { branch: e.target.value }), `${u.name} moved to ${e.target.value}`)} className={`${input} w-28`}>
                      {BRANCHES.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </td>
                  <td className="mono px-4 py-2.5 text-[10.5px] tracking-widest">
                    {u.deactivatedAt ? <span className="text-dim">DEACTIVATED</span> : locked ? <span className="text-brand-bright">LOCKED</span> : u.mustChangePassword ? <span className="text-amber">PASSWORD PENDING</span> : <span className="text-phosphor">ACTIVE</span>}
                  </td>
                  <td className="mono px-4 py-2.5 text-[10.5px] text-steel">{u.lastSignIn ? u.lastSignIn.slice(0, 16).replace("T", " ") : "never"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {locked && <button onClick={() => act(() => api.post(`/users/${u.id}/unlock`, {}), `${u.name} unlocked`)} className="mono mr-3 text-[10.5px] tracking-widest text-steel hover:text-trace">UNLOCK</button>}
                    {!u.deactivatedAt && (
                      <button onClick={() => api.post<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`, {}).then((r) => { setSecret({ who: `${u.name} <${u.email}>`, password: r.temporaryPassword }); load(); }).catch((e) => setMsg({ ok: false, text: (e as Error).message }))}
                        className="mono mr-3 text-[10.5px] tracking-widest text-steel hover:text-trace">RESET PASSWORD</button>
                    )}
                    {!self && (u.deactivatedAt
                      ? <button onClick={() => act(() => api.post(`/users/${u.id}/reactivate`, {}), `${u.name} reactivated`)} className="mono text-[10.5px] tracking-widest text-steel hover:text-phosphor">REACTIVATE</button>
                      : <button onClick={() => window.confirm(`Deactivate ${u.name}? They are signed out everywhere; their history stays.`) && act(() => api.post(`/users/${u.id}/deactivate`, {}), `${u.name} deactivated`)} className="mono text-[10.5px] tracking-widest text-steel hover:text-brand-bright">DEACTIVATE</button>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
