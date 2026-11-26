"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSession, loginPath, Session } from "@/lib/api";
import { LangProvider } from "@/lib/i18n";
import { FieldProvider } from "@/lib/offline/field";
import { AppUpdates, TabBar } from "@/components/m/ui";

/**
 * The phone app: large touch targets, bottom tabs, and field work that keeps
 * going without a signal. Pages are static and read their record id from the
 * query string, so one cached page serves every job offline.
 */
export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const s = getSession();
    if (!s) router.replace(loginPath());
    else setSession(s);
  }, [router]);

  return (
    <LangProvider>
      <div className="m-app min-h-screen bg-ink pb-24 text-base text-fg">
        {session && <FieldProvider userId={session.user.id}>{children}</FieldProvider>}
        <TabBar />
        <AppUpdates />
      </div>
    </LangProvider>
  );
}
