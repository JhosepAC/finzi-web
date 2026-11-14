import Link from "next/link";
import type { ReactNode } from "react";

export function FinziMark() {
  return <svg width="40" height="40" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="10" fill="#1d4ed8" /><path d="M17 35V18c0-6 3-9 9-9h6v6h-5c-3 0-4 1-4 4v2h9v6h-9v8z" fill="white" /></svg>;
}

export function AuthShell({ children, intent = "login" }: { children: ReactNode; intent?: "login" | "register" | "other" }) {
  const registration = intent === "register";
  return (
    <div className="auth-page">
      <a className="skip-link" href="#main">Saltar al contenido</a>
      <main id="main" className="auth-layout">
        <aside className="auth-intro" aria-label="Sobre Finzi">
          <Link href="/login" className="wordmark" aria-label="Finzi, inicio de sesión"><FinziMark /><span>finzi</span></Link>
          <div className="brand-art" aria-hidden="true">
            <svg viewBox="0 0 48 48" focusable="false"><defs><linearGradient id="finzi-sculpture" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d6eaff" /><stop offset=".5" stopColor="#92c3ff" /><stop offset="1" stopColor="#477ee9" /></linearGradient></defs><path d="M17 35V18c0-6 3-9 9-9h6v6h-5c-3 0-4 1-4 4v2h9v6h-9v8z" fill="url(#finzi-sculpture)" /></svg>
          </div>
          <div className="intro-copy"><p className="intro-title">Dale espacio<br />a tus finanzas.</p><p>Un comienzo sencillo.<br />Un espacio que es tuyo.</p></div>
          <p className="intro-foot">Siempre gratis. Sin publicidad.</p>
        </aside>
        <div className="auth-content">
          <header className="auth-header">
            <Link href="/login" className="wordmark mobile-brand" aria-label="Finzi, inicio de sesión"><FinziMark /><span>finzi</span></Link>
            <nav aria-label="Acceso"><span>{registration ? "¿Ya tienes una cuenta?" : "¿Primera vez en Finzi?"}</span><Link className="text-link" href={registration ? "/login" : "/register"}>{registration ? "Iniciar sesión" : "Crear cuenta"}</Link></nav>
          </header>
          <div className="auth-task">{children}</div>
          <footer className="auth-footer"><span>Tu espacio personal en Finzi</span></footer>
        </div>
      </main>
    </div>
  );
}
