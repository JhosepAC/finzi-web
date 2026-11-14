"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Check, CircleAlert } from "lucide-react";
import type { AuthIdentity, AuthResult } from "../domain/auth";
import { notifyAuthChange } from "./session-sync";

export function SessionPanel({ user, confirmed }: { user: AuthIdentity; confirmed: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<"local" | "global" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function logout(scope: "local" | "global") {
    if (pending) return;
    setPending(scope); setError(null);
    try {
      const response = await fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) });
      const data = await response.json() as AuthResult;
      if (data.ok || response.status === 401) { router.replace(data.redirectTo ?? "/login"); router.refresh(); notifyAuthChange(); }
      else setError(data.message);
    } catch { setError("No se pudo cerrar la sesión. Revisa tu conexión e inténtalo otra vez."); }
    finally { setPending(null); }
  }
  return <>
    <div className="form-heading"><h1>Tu sesión está activa</h1><p>{confirmed ? "Tu correo está confirmado y ya puedes acceder a tu identidad de Finzi." : "Has accedido a tu identidad de Finzi."}</p></div>
    <Link className="text-link" href="/dashboard">Ir a mi espacio financiero</Link>
    <dl className="identity-details"><div><dt>Correo electrónico</dt><dd>{user.email}</dd></div><div><dt>Estado del correo</dt><dd className="verified"><Check size={16} aria-hidden="true" />Confirmado</dd></div></dl>
    <div className="session-actions"><button className="button button-primary" onClick={() => logout("local")} disabled={Boolean(pending)}><LogOut size={18} aria-hidden="true" />{pending === "local" ? "Cerrando sesión…" : "Cerrar esta sesión"}</button><button className="button button-secondary" onClick={() => logout("global")} disabled={Boolean(pending)}>{pending === "global" ? "Cerrando sesiones…" : "Cerrar en todos los dispositivos"}</button></div>
    <p className="field-hint session-hint">El cierre global impide renovar las otras sesiones. Sus accesos pueden seguir vigentes hasta que expire su token actual.</p>
    <div className="feedback-slot" aria-live="polite">{error && <div className="feedback feedback-error"><CircleAlert size={19} aria-hidden="true" /><p>{error}</p></div>}</div>
  </>;
}
