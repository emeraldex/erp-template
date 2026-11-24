"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setSession } from "@/lib/api";
import { Button } from "@/components/ui";

// Section 4 actors — every role a "process owner" of specific JTS stages
const DEMO_USERS: [string, string][] = [
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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("aisyah@company.example");
  const [password, setPassword] = useState("demo123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(email, password);
      setSession(session);
      router.replace("/dashboard");
    } catch (e) {
      // API offline → allow demo entry with a stub session
      if (e instanceof TypeError || (e as { status?: number }).status === undefined) {
        setSession({
          token: "demo-offline",
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
            <rect x="4" y="4" width="24" height="24" rx="3" fill="none" stroke="var(--z-red)" strokeWidth="2.5" />
            <path d="M10 11h12l-12 10h12" fill="none" stroke="var(--z-text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="display text-3xl font-bold">COMPANY ERP</h1>
          <p className="eyebrow mt-1">Integrated Maintenance, Procurement &amp; Job-Tracking · CO-RFP-IT-001</p>
        </div>

        <div className="panel ticked fade-up d2 p-6">
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
        </div>

        <div className="fade-up d3 mt-6">
          <p className="eyebrow mb-2">Demo accounts · password demo123</p>
          <div className="grid grid-cols-2 gap-1.5">
            {DEMO_USERS.map(([mail, role]) => (
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
      </div>
    </div>
  );
}
