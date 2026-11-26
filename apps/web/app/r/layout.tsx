import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Report a problem · Laporkan masalah",
  description: "Tell the maintenance team what is wrong. No account needed.",
  // Request pages are private to whoever has the link: keep them out of search
  // engines, and never send the tracking address to another site.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-ink">{children}</div>;
}
