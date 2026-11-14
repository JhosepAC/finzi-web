"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Globe2, LoaderCircle, LockKeyhole } from "lucide-react";
import { FinziMark } from "./auth-shell";
import { profileSchema, type FinancialProfile } from "../domain/profile";
import { getFieldErrors, type FieldErrors } from "../domain/auth";

const steps = ["Tu nombre", "Tus preferencias", "Revisa tu perfil"];
export function Onboarding({ initial, zones, editing }: { initial: FinancialProfile; zones: string[]; editing: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [displayName, setName] = useState(initial.display_name ?? "");
  const [currency, setCurrency] = useState(initial.preferred_currency ?? "PEN");
  const [timezone, setTimezone] = useState(initial.timezone ?? "America/Lima");
  // Router refresh may update server props while a draft is open; its version
  // must remain the version that draft was based on until an explicit reload.
  const [expectedVersion] = useState(initial.version);
  const [preview, setPreview] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastStep = useRef(0);
  useEffect(() => { if (lastStep.current !== step) { heading.current?.focus(); lastStep.current = step; } }, [step]);
  function invalid(fields: FieldErrors) {
    setErrors(fields);
    const field = form.current?.elements.namedItem(Object.keys(fields)[0]);
    if (field instanceof HTMLElement) field.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const input = { displayName, preferredCurrency: currency, timezone, expectedVersion };
    const result = step === 0 ? profileSchema.pick({ displayName: true }).safeParse({ displayName }) : profileSchema.safeParse(input);
    if (!result.success) { invalid(getFieldErrors(result.error)); return; }
    setErrors({}); setMessage(null); setFailure(null);
    if (step < 2) { setStep(step + 1); return; }
    setPending(true);
    try {
      const response = await fetch("/api/v1/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.ok) { router.replace(preview ? "/dashboard?demo=1" : "/dashboard"); router.refresh(); return; }
      setMessage(data.message ?? "No pudimos guardar el perfil. Puedes reintentarlo.");
      setFailure(response.status === 401 ? "session" : response.status === 409 ? "conflict" : "retry");
      if (data.fieldErrors) { setErrors(data.fieldErrors); setStep(data.fieldErrors.displayName ? 0 : 1); }
    } catch { setMessage("No pudimos conectar. Tus cambios siguen aquí; vuelve a intentarlo."); setFailure("retry"); }
    finally { setPending(false); }
  }
  function changeStep(next: number) { setErrors({}); setMessage(null); setFailure(null); setStep(next); }
  function changeName(value: string) {
    setName(value);
    if (errors.displayName && profileSchema.shape.displayName.safeParse(value).success) {
      setErrors((previous) => { const next = { ...previous }; delete next.displayName; return next; });
    }
  }
  return <div className="setup-page">
    <a className="skip-link" href="#setup-main">Saltar al contenido</a>
    <aside className="setup-sidebar">
      <Link href={editing ? "/dashboard" : "/onboarding"} className="wordmark" aria-label="Finzi"><FinziMark /><span>finzi</span></Link>
      <div className="setup-story"><p>Un buen comienzo<br />es hacerlo tuyo.</p><span>Solo necesitamos unos datos para preparar tu espacio.</span></div>
      <ol className="setup-steps" aria-label="Progreso de configuración">{steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><button type="button" disabled={index > step || pending} onClick={() => changeStep(index)}><span className="step-number" aria-hidden="true">{index < step ? <Check size={17} /> : index + 1}</span><span>{label}{step === index && <small>Estás aquí</small>}</span></button></li>)}</ol>
      <p className="setup-privacy"><LockKeyhole size={17} aria-hidden="true" />No pediremos datos bancarios.</p>
    </aside>
    <div className="setup-body">
      <header className="setup-header"><span>{editing ? "Editar perfil" : "Configura tu espacio"}</span><Link className="text-link" href="/session">Sesión y seguridad</Link></header>
      <main id="setup-main" className="setup-main">
        <div className="setup-progress" aria-live="polite">Paso {step + 1} de 3<span aria-hidden="true">{steps.map((s, i) => <i key={s} className={i <= step ? "filled" : ""} />)}</span></div>
        <div className="form-heading"><h1 ref={heading} tabIndex={-1}>{["¿Cómo te llamamos?", "Tus finanzas, a tu manera.", "Todo listo para empezar."][step]}</h1><p>{["Elige el nombre que quieres ver en Finzi. No tiene que ser tu nombre legal.", "Define la moneda de referencia y la zona horaria de tu espacio.", "Revisa tus preferencias. Podrás cambiarlas cuando lo necesites."][step]}</p></div>
        <form ref={form} action="/api/v1/profile" method="post" onSubmit={submit} noValidate aria-busy={pending} className="setup-form">
          <noscript><p>Activa JavaScript para configurar tu perfil.</p></noscript>
          {step === 0 && <><div className="field"><label htmlFor="displayName">Tu nombre</label><input id="displayName" name="displayName" value={displayName} onChange={(e) => changeName(e.target.value)} required autoComplete="nickname" maxLength={100} aria-invalid={Boolean(errors.displayName)} aria-describedby={errors.displayName ? "name-error" : "name-hint"} /><p className="field-hint" id="name-hint">Un nombre o apodo de hasta 100 caracteres.</p>{errors.displayName && <p className="field-error" id="name-error">{errors.displayName}</p>}</div><div className="setup-note"><LockKeyhole size={21} aria-hidden="true" /><p>Este es tu espacio personal.<span>No necesitas compartir documentos ni números de cuenta para configurarlo.</span></p></div></>}
          {step === 1 && <><fieldset className="currency-field"><legend>Moneda de referencia</legend><div className="currency-options">{([['PEN', 'Soles peruanos', 'S/'], ['USD', 'Dólares estadounidenses', '$']] as const).map(([code, label, sign]) => <label className="currency-option" key={code}><input type="radio" name="preferredCurrency" value={code} checked={currency === code} onChange={() => setCurrency(code)} /><span className="currency-symbol" aria-hidden="true">{sign}</span><span><strong>{label}</strong><small>{code}</small></span><span className="currency-check" aria-hidden="true">{currency === code && <Check size={14} />}</span></label>)}</div><p className="field-hint">Es una preferencia. Cada cuenta tendrá su moneda y no se harán conversiones automáticas.</p></fieldset><div className="field"><label htmlFor="timezone">Zona horaria</label><select id="timezone" name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} required aria-describedby={errors.timezone ? "timezone-hint timezone-error" : "timezone-hint"} aria-invalid={Boolean(errors.timezone)}>{zones.map((zone) => <option key={zone} value={zone}>{zone === "America/Lima" ? "Perú — Lima (America/Lima)" : zone.replaceAll('_', ' ')}</option>)}</select><p className="field-hint" id="timezone-hint">Determina el día y la hora de tus registros.{editing && " Cambiarla puede cambiar el día en que se muestran tus movimientos."}</p>{errors.timezone && <p id="timezone-error" className="field-error">{errors.timezone}</p>}</div><p className="setup-language"><Globe2 size={17} aria-hidden="true" />Idioma de Finzi<strong>Español</strong></p></>}
          {step === 2 && <dl className="setup-review"><div><dt>Tu nombre</dt><dd>{displayName.trim()}</dd></div><div><dt>Moneda de referencia</dt><dd>{currency === "PEN" ? "Soles peruanos (PEN)" : "Dólares estadounidenses (USD)"}</dd></div><div><dt>Zona horaria</dt><dd>{timezone.replaceAll('_', ' ')}</dd></div><div><dt>Idioma</dt><dd>Español</dd></div></dl>}
          {step === 2 && !editing && <label className="setup-demo-option"><input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} /><span>Explorar con datos de prueba<small>Al terminar verás una muestra interactiva. No se guardará en tus cuentas.</small></span></label>}
          <div className="feedback-slot" aria-live="polite" aria-atomic="true">{message && <div className="feedback feedback-error"><CircleAlert size={19} aria-hidden="true" /><p>{message}</p></div>}</div>
          {failure === "session" && <Link className="text-link" href="/login" target="_blank" rel="noopener">Iniciar sesión en otra pestaña</Link>}
          {failure === "conflict" && <button className="text-link reload-button" type="button" onClick={() => window.location.reload()}>Descartar este borrador y cargar la versión guardada</button>}
          <div className="setup-actions">{step > 0 && <button type="button" className="button button-secondary" disabled={pending} onClick={() => changeStep(step - 1)}><ArrowLeft size={17} aria-hidden="true" />Atrás</button>}<button type="submit" className="button button-primary" disabled={pending || failure === "conflict"}>{pending ? <LoaderCircle className="loading-icon" size={18} aria-hidden="true" /> : step === 2 ? <Check size={18} aria-hidden="true" /> : null}{pending ? "Guardando perfil…" : step === 2 ? "Guardar y continuar" : "Continuar"}{step < 2 && <ArrowRight size={17} aria-hidden="true" />}</button></div>
        </form>
      </main>
      <footer className="setup-footer">Sin prisas. Hazlo a tu manera.{editing && <Link className="text-link" href="/dashboard">Cancelar y volver al inicio</Link>}</footer>
    </div>
  </div>;
}
