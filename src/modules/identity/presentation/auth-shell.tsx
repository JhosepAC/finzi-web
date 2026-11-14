import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export function AuthShell({ children, intent = "login" }: { children: ReactNode; intent?: "login" | "register" | "other" }) {
  const registration = intent === "register";
  return (
    <div className="auth-page">
      <a className="skip-link" href="#main">Saltar al contenido</a>
      <header className="auth-header">
        <Link href="/login" className="wordmark" aria-label="Finzi, inicio de sesión">finzi<span aria-hidden="true">.</span></Link>
        <nav aria-label="Acceso">
          <span>{registration ? "¿Ya tienes una cuenta?" : "¿Primera vez en Finzi?"}</span>
          <Link className="text-link" href={registration ? "/login" : "/register"}>{registration ? "Iniciar sesión" : "Crear cuenta"}<ArrowUpRight size={16} aria-hidden="true" /></Link>
        </nav>
      </header>
      <main id="main" className="auth-layout">
        <aside className="auth-intro" aria-label="Sobre Finzi">
          <div className="intro-copy">
            <p className="intro-title">Un espacio propio<br />para tus finanzas.</p>
            <p>Empieza con tu cuenta personal.<br />Finzi es gratuita y sin publicidad.</p>
          </div>
          <div className="intro-foot"><span className="intro-rule" aria-hidden="true" /><p>Tu correo. Tu cuenta. Tu acceso.</p></div>
        </aside>
        <div className="auth-task">{children}</div>
      </main>
      <footer className="auth-footer"><span>Finzi · Finanzas personales</span><span>Una cuenta, un espacio personal.</span></footer>
    </div>
  );
}
