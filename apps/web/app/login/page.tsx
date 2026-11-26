"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, API_BASE, ApiError, DEMO_MODE, safeNext, setSession } from "@/lib/api";
import { Button } from "@/components/ui";

// Demo shortcuts are shown in development and demo builds only — a production
// build must not advertise accounts or the reference password.
const SHOW_DEMO_ACCOUNTS = DEMO_MODE || process.env.NODE_ENV !== "production";

// Section 4 actors — every role a "process owner" of specific JTS stages
const AVIATION_DEMO_USERS: [string, string][] = [
  ["aisyah@company.example", "ADMIN · IT"],
  ["rahim@company.example", "STORES · StS"],
  ["meiling@company.example", "WORKSHOP · Tst"],
  ["daniel@company.example", "MIS"],
  ["hafiz@company.example", "MM · SMM"],
  ["suresh@company.example", "PURCHASING · PcE"],
  ["kumar@company.example", "PCE · OV"],
  ["qistina@company.example", "QUALITY · QAD"],
  ["farah@company.example", "FINANCE"],
  ["zara@company.example", "BILLING"],
];

// Organisations started from the other sector packs: one demo person per standard role.
const PACK_DEMO_USERS: [string, string][] = [
  ["admin@company.example", "ADMIN"], ["helpdesk@company.example", "HELPDESK"], ["supervisor@company.example", "SUPERVISOR"],
  ["technician@company.example", "TECHNICIAN"], ["stores@company.example", "STORES"], ["purchasing@company.example", "PURCHASING"],
  ["finance@company.example", "FINANCE"], ["manager@company.example", "MANAGER"],
];

const SSO_ERRORS: Record<string, string> = {
  not_registered: "Your organisation account worked, but you don't have an account in this ERP yet. Ask an administrator to add you.",
  not_enabled: "Single sign-on is not set up for this organisation.",
  idp_error: "Your organisation's sign-in service refused the request.",
  email_unverified: "Your email address isn't verified with your organisation's sign-in service.",
  no_email: "Your organisation's sign-in service didn't share your email address.",
  state_expired: "Sign-in took too long. Please try again.",
  state_missing: "Sign-in session expired. Please try again.",
};

export default function LoginPage() {
  const router = useRouter();
  const [org, setOrg] = useState<string | null>(null);
  const [demoUsers, setDemoUsers] = useState(AVIATION_DEMO_USERS);
  const [sso, setSso] = useState<{ enabled: boolean; label: string; passwordLogin: boolean } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    api.get<{ name: string; pack?: string }>("/tenant").then((t) => {
      setOrg(t.name);
      if (t.pack && t.pack !== "aviation") {
        setDemoUsers(PACK_DEMO_USERS);
        setEmail((e) => (e === "aisyah@company.example" ? "admin@company.example" : e));
      }
    }).catch(() => {});
    api.get<{ enabled: boolean; label: string; passwordLogin: boolean }>("/auth/sso").then(setSso).catch(() => {});
    const q = new URLSearchParams(window.location.search);
    if (q.get("sso") === "ok") {
      // Back from the identity provider: the session cookie is set; load the profile.
      api.me().then(({ user }) => { setSession({ user }); router.replace(safeNext(sessionStorage.getItem("erp.next")) ?? "/dashboard"); sessionStorage.removeItem("erp.next"); })
        .catch(() => setError("Single sign-on finished but no session was created. Please try again."));
    } else if (q.get("sso_error")) {
      setError(SSO_ERRORS[q.get("sso_error")!] ?? "Single sign-on failed. Please try again or contact an administrator.");
    }
  }, [router]);

  const passwordForm = !sso || sso.passwordLogin || showPassword;
  const [email, setEmail] = useState(SHOW_DEMO_ACCOUNTS ? "aisyah@company.example" : "");
  const [password, setPassword] = useState(SHOW_DEMO_ACCOUNTS ? "demo123" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(email, password);
      setSession({ user });
      const next = safeNext(new URLSearchParams(window.location.search).get("next"));
      router.replace(user.mustChangePassword ? "/change-password" : next ?? "/dashboard");
    } catch (e) {
      // Demo builds only: let the UI be explored with sample data when no API runs.
      if (DEMO_MODE && e instanceof ApiError && e.status === 0) {
        setSession({
          user: { id: "u1", name: "Demo User", email, role: "ADMIN", designation: "IT Mgmt", branch: "HQ" },
        });
        router.replace("/dashboard");
        return;
      }
      setError((e as Error).message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="fade-up mb-8 text-center">
          <svg viewBox="0 0 32 32" className="mx-auto mb-3 h-12 w-12" aria-hidden>
            <rect x="4" y="4" width="24" height="24" rx="3" fill="none" stroke="var(--c-red)" strokeWidth="2.5" />
            <path d="M10 11.5h12M10 16h12M10 20.5h7" fill="none" stroke="var(--c-text)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <h1 className="display text-3xl font-bold">{org ? org.toUpperCase() : "\u00a0"}</h1>
          <p className="eyebrow mt-1">Integrated Maintenance, Procurement &amp; Job-Tracking · CO-RFP-IT-001</p>
        </div>

        <div className="panel ticked fade-up d2 p-6">
          {sso?.enabled && (
            <div className={passwordForm ? "mb-5 border-b hairline pb-5" : ""}>
              <a
                href={`${API_BASE}/auth/sso/start`}
                onClick={() => {
                  // Survives the trip through the identity provider.
                  const next = safeNext(new URLSearchParams(window.location.search).get("next"));
                  try { if (next) sessionStorage.setItem("erp.next", next); } catch { /* storage off */ }
                }}
                className="display block w-full rounded-md bg-brand px-4 py-2.5 text-center text-sm font-semibold tracking-wider text-white transition-colors hover:bg-brand-bright"
              >
                SIGN IN WITH {sso.label.toUpperCase()}
              </a>
              {!passwordForm && error && <p className="mt-4 text-sm text-brand-bright">{error}</p>}
              {!sso.passwordLogin && !showPassword && (
                <button onClick={() => setShowPassword(true)} className="mono mt-4 block w-full text-center text-[10.5px] tracking-widest text-dim hover:text-steel">
                  ADMINISTRATOR SIGN-IN
                </button>
              )}
            </div>
          )}
          {passwordForm && (<>
          <label className="eyebrow mb-1.5 block" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mono mb-4 w-full rounded-md border hairline bg-ink-deep px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-trace"
            autoComplete="username"
          />
          <label className="eyebrow mb-1.5 block" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="mono mb-5 w-full rounded-md border hairline bg-ink-deep px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-trace"
            autoComplete="current-password"
          />
          {error && <p className="mb-4 text-sm text-brand-bright">{error}</p>}
          <Button onClick={submit} disabled={busy}>
            {busy ? "AUTHENTICATING…" : "SIGN IN"}
          </Button>
          </>)}
        </div>

        {SHOW_DEMO_ACCOUNTS && (
        <div className="fade-up d3 mt-6">
          <p className="eyebrow mb-2">Demo accounts · password demo123</p>
          <div className="grid grid-cols-2 gap-1.5">
            {demoUsers.map(([mail, role]) => (
              <button
                key={mail}
                onClick={() => setEmail(mail)}
                className="mono rounded border hairline bg-panel/50 px-2 py-1.5 text-left text-[10.5px] tracking-wider text-steel transition-colors hover:border-steel/50 hover:text-fg"
              >
                {role} · {mail.split("@")[0]}
              </button>
            ))}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
