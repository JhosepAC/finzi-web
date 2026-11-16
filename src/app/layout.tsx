import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./dashboard.css";
import "@/shared/ui/select.css";
import { SessionSync } from "@/modules/identity/presentation/session-sync";

// A fresh per-response CSP nonce requires server rendering, including public AUTH forms.
export const dynamic = "force-dynamic";
const manrope = localFont({ src: "./fonts/Manrope-Variable.ttf", display: "swap", variable: "--font-manrope", weight: "200 800" });

export const metadata: Metadata = {
  title: { default: "Finzi Â· Acceso personal", template: "%s Â· Finzi" },
  description: "Accede a tu cuenta personal de Finzi. Una aplicaciÃ³n gratuita de finanzas personales, sin publicidad.",
  robots: { index: false, follow: false },
  other: { "page-type": "software", "site-kind": "software" },
  openGraph: { title: "Finzi Â· Acceso personal", description: "Tu cuenta personal en Finzi.", type: "website", locale: "es_PE" }
};
export const viewport: Viewport = { themeColor: "#F8FAFC", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es" data-type="software" className={manrope.variable}><body><SessionSync />{children}</body></html>;
}
