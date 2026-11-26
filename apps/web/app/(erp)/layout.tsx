"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ConnectionBanner, Sidebar, Topbar } from "@/components/shell";
import { LangProvider } from "@/lib/i18n";
import { phoneRoute } from "@/lib/phone";

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Phones get the phone app — including from QR codes on job cards and asset labels.
  useEffect(() => {
    const to = phoneRoute(pathname, window.location.search);
    if (to) router.replace(to);
  }, [pathname, router]);
  return (
    <LangProvider>
      <Sidebar />
      <div className="md:pl-60">
        <Topbar />
        <ConnectionBanner />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </LangProvider>
  );
}
