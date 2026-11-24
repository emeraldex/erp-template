"use client";

import { ConnectionBanner, Sidebar, Topbar } from "@/components/shell";
import { LangProvider } from "@/lib/i18n";

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <Sidebar />
      <div className="md:pl-60">
        <Topbar />
        <ConnectionBanner />
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </div>
    </LangProvider>
  );
}
