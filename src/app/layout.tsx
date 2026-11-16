import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import localFont from "next/font/local";
import "./theme.css";
import "./globals.css";
import "./dashboard.css";
import "@/shared/ui/select.css";
import { SessionSync } from "@/modules/identity/presentation/session-sync";

// A fresh per-response CSP nonce requires server rendering, including public AUTH forms.
export const dynamic = "force-dynamic";
const manrope = localFont({ src: "./fonts/Manrope-Variable.ttf", display: "swap", variable: "--font-manrope", weight: "200 800" });

export const metadata: Metadata = {
  title: { default: "Finzi · Acceso personal", template: "%s · Finzi" },
  description: "Accede a tu cuenta personal de Finzi. Una aplicaciÃ³n gratuita de finanzas personales, sin publicidad.",
  robots: { index: false, follow: false },
  other: { "page-type": "software", "site-kind": "software" },
  openGraph: { title: "Finzi · Acceso personal", description: "Tu cuenta personal en Finzi.", type: "website", locale: "es_PE" }
};
export const viewport: Viewport = { themeColor: "#F8FAFC", width: "device-width", initialScale: 1 };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [requestCookies, requestHeaders] = await Promise.all([cookies(), headers()]);
  const stored = requestCookies.get("finzi-theme")?.value;
  const mode = stored === "dark" || stored === "light" ? stored : "system";
  const bootstrap = `(function(){var p=${JSON.stringify(mode)};try{var s=localStorage.getItem('finzi-theme');if(s==='light'||s==='dark'||s==='system')p=s}catch(e){}var d=p==='dark'||p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.dataset.themePreference=p;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=d?'#101114':'#f3f6fc'})()`;
  return <html suppressHydrationWarning data-theme={mode === "dark" ? "dark" : "light"} data-theme-preference={mode} lang="es" data-type="software" className={manrope.variable}><head><script nonce={requestHeaders.get("x-nonce") ?? undefined} dangerouslySetInnerHTML={{ __html: bootstrap }} /></head><body><SessionSync />{children}</body></html>;
}
