"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, MailCheck, CircleAlert } from "lucide-react";
import { authSchemas, type AuthResult } from "../domain/auth";
import { notifyAuthChange } from "./session-sync";

export function VerifyLink() {
  const router = useRouter();
  const [link, setLink] = useState<{ tokenHash: string; type: "signup" | "recovery" } | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rejectedType, setRejectedType] = useState<"signup" | "recovery" | null>(null);
  useEffect(() => {
    function readLink() {
      if (!window.location.hash) { queueMicrotask(() => setReady(true)); return; }
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const parsed = authSchemas.verify.safeParse({ tokenHash: hash.get("token_hash"), type: hash.get("type") });
      // Fragment never reaches access logs; remove it before any navigation or third-party request.
      window.history.replaceState(null, "", window.location.pathname);
      queueMicrotask(() => { setLink(parsed.success ? parsed.data : null); setRejectedType(null); setMessage(null); setReady(true); });
    }
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  async function verify() {
    if (!link || pending) return;
    setPending(true); setMessage(null);
    try {
      const response = await fetch("/api/v1/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(link) });
      const data = await response.json() as AuthResult;
      if (data.ok && data.redirectTo) { router.replace(data.redirectTo); router.refresh(); notifyAuthChange(); }
      else {
        if (data.code === "INVALID_LINK" || data.code === "INVALID_SESSION") {
          setRejectedType(link.type);
          setLink(null);
        }
        setMessage(data.message);
      }
    } catch { setMessage("No pudimos conectar. Vuelve a intentar la verificación."); }
    finally { setPending(false); }
  }
  const invalid = ready && !link;
  return <>
    <div className={`status-symbol ${invalid ? "status-symbol-error" : ""}`} aria-hidden="true">{invalid ? <CircleAlert size={28} /> : <MailCheck size={28} />}</div>
    <div className="form-heading"><h1>{invalid ? "El enlace no es válido" : link?.type === "recovery" ? "Recupera tu cuenta" : "Confirma tu correo"}</h1><p>{invalid ? rejectedType === "recovery" ? "Solicita un nuevo enlace para restablecer tu contraseña." : "Abre el enlace completo de tu correo o solicita uno nuevo." : "Confirma que quieres continuar. Solo usaremos el enlace cuando pulses el botón."}</p></div>
    {link && <button className="button button-primary" type="button" onClick={verify} disabled={pending}>{pending ? "Verificando enlace…" : link.type === "recovery" ? "Continuar recuperación" : "Confirmar correo"}<ArrowRight size={18} aria-hidden="true" /></button>}
    {invalid && <Link className="button button-primary" href={rejectedType === "recovery" ? "/forgot-password" : "/verify-email"}>{rejectedType === "recovery" ? "Solicitar recuperación" : "Solicitar confirmación"}<ArrowRight size={18} aria-hidden="true" /></Link>}
    <div className="feedback-slot" aria-live="polite">{message && <div className="feedback feedback-error"><CircleAlert size={19} aria-hidden="true" /><p>{message}</p></div>}</div>
    {invalid && rejectedType !== "recovery" && <div className="recovery-links"><Link className="text-link" href="/forgot-password">Solicitar recuperación</Link></div>}
    <Link className="text-link back-link" href="/login">Volver a iniciar sesión</Link>
  </>;
}
