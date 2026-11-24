"use client";

import { useSession } from "@/lib/use-session";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setSession } from "@/lib/api";
import { Button } from "@/components/ui";

const MIN_LENGTH = 12;
const inputClass =
  "mono mb-4 w-full rounded-md border hairline bg-ink-deep px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-trace";

export default function ChangePasswordPage() {
  const router = useRouter();
  const required = useSession()?.user.mustChangePassword ?? false;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (next.length < MIN_LENGTH) return setError(`New password must be at least ${MIN_LENGTH} characters.`);
    if (next !== confirm) return setError("The new passwords do not match.");
    setBusy(true);
    try {
      const { user } = await api.changePassword(current, next);
      setSession({ user });
      router.replace("/dashboard");
    } catch (e) {
      setError((e as Error).message || "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="fade-up mb-8 text-center">
          <h1 className="display text-3xl font-bold">CHANGE PASSWORD</h1>
          <p className="eyebrow mt-1">
            {required
              ? "Your account requires a new password before you continue"
              : "Choose a new password — other devices will be signed out"}
          </p>
        </div>

        <div className="panel ticked fade-up d2 p-6">
          <label className="eyebrow mb-1.5 block" htmlFor="current">Current password</label>
          <input id="current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
            className={inputClass} autoComplete="current-password" />
          <label className="eyebrow mb-1.5 block" htmlFor="next">New password</label>
          <input id="next" type="password" value={next} onChange={(e) => setNext(e.target.value)}
            className={inputClass} autoComplete="new-password" />
          <label className="eyebrow mb-1.5 block" htmlFor="confirm">Confirm new password</label>
          <input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} className={inputClass} autoComplete="new-password" />
          <p className="mb-4 text-xs text-dim">At least {MIN_LENGTH} characters, and not your email name or a common password.</p>
          {error && <p className="mb-4 text-sm text-brand-bright">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={submit} disabled={busy}>{busy ? "SAVING…" : "SET PASSWORD"}</Button>
            {!required && (
              <Button variant="ghost" onClick={() => router.back()} disabled={busy}>CANCEL</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
