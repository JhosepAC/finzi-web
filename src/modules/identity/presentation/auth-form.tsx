"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowRight, CircleCheck, CircleAlert } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { authSchemas, getFieldErrors, type AuthAction, type AuthResult, type FieldErrors } from "../domain/auth";
import { notifyAuthChange } from "./session-sync";

type FormKind = "login" | "register" | "forgot-password" | "reset-password" | "resend";
const copy: Record<FormKind, { title: string; description: string; action: string; loading: string }> = {
  login: { title: "Iniciar sesión", description: "Escribe tus datos para entrar a tu cuenta.", action: "Iniciar sesión", loading: "Iniciando sesión…" },
  register: { title: "Crea tu cuenta", description: "Regístrate con tu correo. Te enviaremos un enlace para confirmarlo.", action: "Crear cuenta", loading: "Creando cuenta…" },
  "forgot-password": { title: "Recupera tu acceso", description: "Escribe tu correo y te enviaremos un enlace para crear una nueva contraseña.", action: "Enviar enlace", loading: "Enviando enlace…" },
  "reset-password": { title: "Tu nueva contraseña", description: "Elige una contraseña que uses solo en Finzi.", action: "Guardar contraseña", loading: "Guardando contraseña…" },
  resend: { title: "Revisa tu correo", description: "Abre el enlace de confirmación para activar tu cuenta. Si no lo encuentras, revisa la carpeta de spam o solicita otro.", action: "Reenviar enlace", loading: "Enviando enlace…" }
};

export function AuthForm({ kind, notice }: { kind: FormKind; notice?: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(notice ? { ok: true, message: notice } : null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const config = copy[kind];
  const email = kind !== "reset-password";
  const password = ["login", "register", "reset-password"].includes(kind);
  const confirmation = kind === "register" || kind === "reset-password";

  function focusError(fields: FieldErrors) {
    const first = Object.keys(fields)[0];
    const field = formRef.current?.elements.namedItem(first);
    if (field instanceof HTMLElement) field.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const input = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = authSchemas[kind].safeParse(input);
    if (!parsed.success) {
      const fields = getFieldErrors(parsed.error);
      setErrors(fields); setFeedback({ ok: false, message: "Revisa los campos indicados." }); focusError(fields); return;
    }
    setErrors({}); setFeedback(null); setPending(true);
    try {
      const response = await fetch(`/api/v1/auth/${kind satisfies AuthAction}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), cache: "no-store" });
      const result = await response.json() as AuthResult;
      if (result.fieldErrors) { setErrors(result.fieldErrors); focusError(result.fieldErrors); }
      setFeedback({ ok: result.ok, message: result.message });
      if (result.ok && result.redirectTo) { router.replace(result.redirectTo); router.refresh(); if (kind === "login" || kind === "reset-password") notifyAuthChange(); }
    } catch {
      setFeedback({ ok: false, message: "No pudimos conectar. Revisa tu conexión y vuelve a intentarlo; tus datos siguen aquí." });
    } finally { setPending(false); }
  }
  function passwordField(name: "password" | "confirmPassword", label: string) {
    const hint = name === "password" && confirmation ? "password-hint" : undefined;
    return <div className="field" key={name}>
      <div className="field-heading"><label htmlFor={name}>{label}</label>{kind === "login" && <Link className="text-link field-link" href="/forgot-password">¿Olvidaste tu contraseña?</Link>}</div>
      <div className="password-field">
        <input id={name} name={name} type={revealed[name] ? "text" : "password"} autoComplete={kind === "login" ? "current-password" : "new-password"} maxLength={128} required aria-invalid={Boolean(errors[name])} aria-describedby={[hint, errors[name] ? `${name}-error` : null].filter(Boolean).join(" ") || undefined} disabled={pending} />
        <button className="password-toggle" type="button" aria-label={`${revealed[name] ? "Ocultar" : "Mostrar"} ${name === "confirmPassword" ? "confirmación de contraseña" : "contraseña"}`} aria-pressed={Boolean(revealed[name])} onClick={() => setRevealed((state) => ({ ...state, [name]: !state[name] }))}>{revealed[name] ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button>
      </div>
      {hint && <p id={hint} className="field-hint">Al menos 12 caracteres. Puedes usar una frase.</p>}
      {errors[name] && <p className="field-error" id={`${name}-error`}>{errors[name]}</p>}
    </div>;
  }
  return <>
    <div className="form-heading"><h1>{config.title}</h1><p>{config.description}</p></div>
    <form ref={formRef} className="auth-form" action={`/api/v1/auth/${kind}`} method="post" onSubmit={submit} noValidate aria-busy={pending}>
      <noscript><p>Activa JavaScript para enviar este formulario de forma segura.</p></noscript>
      {email && <div className="field"><label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254} required disabled={pending} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} />{errors.email && <p className="field-error" id="email-error">{errors.email}</p>}</div>}
      {password && passwordField("password", kind === "reset-password" ? "Nueva contraseña" : "Contraseña")}
      {confirmation && passwordField("confirmPassword", "Confirmar contraseña")}
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? config.loading : config.action}{!pending && <ArrowRight size={18} aria-hidden="true" />}</button>
      <div className="feedback-slot" aria-live="polite" aria-atomic="true">{feedback && <div className={`feedback ${feedback.ok ? "feedback-success" : "feedback-error"}`}>{feedback.ok ? <CircleCheck size={19} aria-hidden="true" /> : <CircleAlert size={19} aria-hidden="true" />}<p>{feedback.message}</p></div>}</div>
    </form>
    <div className="form-bottom">
      {kind === "login" ? <><p>¿Todavía no tienes cuenta? <Link className="text-link" href="/register">Crear cuenta</Link></p><Link className="text-link secondary-link" href="/verify-email">Reenviar correo de confirmación</Link></> : <Link className="text-link back-link" href="/login">Volver a iniciar sesión</Link>}
    </div>
  </>;
}
