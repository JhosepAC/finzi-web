import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionSync } from "@/modules/identity/presentation/session-sync";

// A fresh per-response CSP nonce requires server rendering, including public AUTH forms.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Finzi · Acceso personal", template: "%s · Finzi" },
  description: "Accede a tu cuenta personal de Finzi. Una aplicación gratuita de finanzas personales, sin publicidad.",
  robots: { index: false, follow: false },
  other: { "page-type": "software", "site-kind": "software" },
  openGraph: { title: "Finzi · Acceso personal", description: "Tu cuenta personal en Finzi.", type: "website", locale: "es_PE" }
};
export const viewport: Viewport = { themeColor: "#F8FAFC", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es" data-type="software"><body><SessionSync />{children}</body></html>;
}
