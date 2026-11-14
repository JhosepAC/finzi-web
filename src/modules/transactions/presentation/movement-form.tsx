"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import type { Account } from "@/modules/accounts";
import type { Category } from "@/modules/classification/domain/category";
import { postMovementSchema } from "../domain/movement";
import { getFieldErrors, type FieldErrors } from "@/modules/identity/domain/auth";
import { formatMoney, openingMinor } from "@/shared/money";
import { localDateTime, wallTimeToUtc } from "@/shared/time";

export function MovementForm({ accounts, categories, initialKind, timezone, onSave, onCancel, onDirty }: { accounts: Account[]; categories: Category[]; initialKind: "income" | "expense"; timezone: string; onSave: (kind: "income" | "expense", currency: "PEN" | "USD", alreadyVoid: boolean) => Promise<void>; onCancel: () => void; onDirty: (dirty: boolean, pending: boolean) => void }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState(initialKind);
  const [accountId, setAccount] = useState(accounts.find((a) => a.status === "active")?.id ?? "");
  const [categoryId, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [isNow, setNow] = useState(true);
  const [wallTime, setTime] = useState(() => localDateTime(new Date(), timezone));
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const focusError = useRef(false);
  useEffect(() => {
    if (!pending && focusError.current) {
      const field = form.current?.elements.namedItem(Object.keys(errors)[0]);
      if (field instanceof HTMLElement) field.focus();
      focusError.current = false;
    }
  }, [errors, pending]);
  const dirty = Boolean(amount || description || note || uncertain);
  useEffect(() => { onDirty(dirty, pending); return () => onDirty(false, false); }, [dirty, pending, onDirty]);
  const account = accounts.find((a) => a.id === accountId);
  const choices = categories.filter((c) => c.kind === kind && !c.effective_archived);
  let projected: bigint | null = null;
  try { const minor = openingMinor(amount); if (account && minor > 0n) projected = BigInt(account.balance_minor) + (kind === "income" ? minor : -minor); } catch { /* The field explains invalid input on submit. */ }
  function invalid(fields: FieldErrors) { focusError.current = true; setErrors(fields); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || conflict) return;
    let occurredAt: string | null = null;
    if (!isNow) { try { occurredAt = wallTimeToUtc(wallTime, timezone); } catch (error) { invalid({ occurredAt: error instanceof Error ? error.message : "Revisa la fecha." }); return; } }
    const parsed = postMovementSchema.safeParse({ requestId, kind, accountId, categoryId, amount, description, note, occurredAt });
    if (!parsed.success) { invalid(getFieldErrors(parsed.error)); return; }
    setPending(true); setMessage(""); setErrors({});
    try {
      const response = await fetch("/api/v1/movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (response.ok && body.ok) { await onSave(kind, account!.currency_code, body.status === "void"); return; }
      setUncertain(response.status >= 500); setConflict(body.code === "CONFLICT"); setMessage(body.message ?? "No pudimos confirmar el guardado. Reintenta esta operación.");
      if (body.fieldErrors) invalid(body.fieldErrors);
    } catch { setUncertain(true); setMessage("No pudimos confirmar el resultado. Reintenta el mismo registro; sus datos se conservan para evitar duplicados."); }
    finally { setPending(false); }
  }
  const locked = pending || uncertain;
  return <section className="home-panel ledger-entry" aria-labelledby="movement-form-title"><div className="ledger-entry-heading"><h2 id="movement-form-title">{kind === "income" ? "Registrar ingreso" : "Registrar gasto"}</h2><p>Cuenta y categoría determinan dónde se registra.</p></div>
    <form ref={form} action="/api/v1/movements" method="post" onSubmit={submit} noValidate aria-busy={pending}>
      <div className="ledger-entry-grid"><div className="field"><label htmlFor="movement-kind">Tipo de movimiento</label><select id="movement-kind" value={kind} disabled={locked} onChange={(event) => { setKind(event.target.value as typeof kind); setCategory(""); setErrors({}); }}><option value="expense">Gasto</option><option value="income">Ingreso</option></select></div>
        <div className="field"><label htmlFor="movement-account">Cuenta</label><select id="movement-account" name="accountId" value={accountId} disabled={locked} onChange={(event) => { setAccount(event.target.value); setErrors({}); }} aria-invalid={Boolean(errors.accountId)} aria-describedby={errors.accountId ? "movement-account-error" : undefined}><option value="">Elige una cuenta</option>{accounts.filter((a) => a.status === "active").map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency_code}</option>)}</select>{errors.accountId && <p className="field-error" id="movement-account-error">{errors.accountId}</p>}</div>
        <div className="field"><label htmlFor="movement-amount">Importe{account ? ` en ${account.currency_code}` : ""}</label><input id="movement-amount" name="amount" value={amount} onChange={(event) => { setAmount(event.target.value); setErrors({}); }} inputMode="decimal" autoComplete="off" maxLength={19} disabled={locked} required aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? "movement-amount-error" : "movement-amount-help"} /><p className="field-hint" id="movement-amount-help">Mayor que cero, hasta 2 decimales. Sin separadores de miles.</p>{errors.amount && <p className="field-error" id="movement-amount-error">{errors.amount}</p>}</div>
        <div className="field"><label htmlFor="movement-category">Categoría</label><select id="movement-category" name="categoryId" value={categoryId} onChange={(event) => { setCategory(event.target.value); setErrors({}); }} disabled={locked} aria-invalid={Boolean(errors.categoryId)} aria-describedby={errors.categoryId ? "movement-category-error" : undefined}><option value="">Elige una categoría de {kind === "income" ? "ingreso" : "gasto"}</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? `${categories.find((p) => p.id === c.parent_id)?.name} / ` : ""}{c.name}</option>)}</select>{errors.categoryId && <p className="field-error" id="movement-category-error">{errors.categoryId}</p>}{!choices.length && <p className="field-hint">Necesitas una categoría activa de este tipo. Puedes crearla en Categorías.</p>}</div>
        <div className="field ledger-wide"><label htmlFor="movement-description">Descripción</label><input id="movement-description" name="description" value={description} onChange={(event) => { setDescription(event.target.value); setErrors({}); }} autoComplete="off" maxLength={200} required disabled={locked} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "movement-description-error" : undefined} />{errors.description && <p className="field-error" id="movement-description-error">{errors.description}</p>}</div>
      </div>
      <div className="ledger-date"><label className="ledger-check"><input type="checkbox" checked={isNow} onChange={(event) => { setNow(event.target.checked); setErrors({}); }} disabled={locked} />Ocurrió ahora</label>{!isNow && <div className="field"><label htmlFor="movement-date">Fecha y hora del movimiento</label><input id="movement-date" name="occurredAt" type="datetime-local" value={wallTime} onChange={(event) => { setTime(event.target.value); setErrors({}); }} disabled={locked} aria-invalid={Boolean(errors.occurredAt)} aria-describedby="movement-date-help movement-date-error" /></div>}<p className="field-hint" id="movement-date-help">Zona: {timezone}. {isNow ? "La fecha se asigna al guardar." : account ? `Apertura: ${new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "medium", timeZone: timezone }).format(new Date(account.opening_at))}.` : "Elige una fecha ya ocurrida."}</p>{errors.occurredAt && <p className="field-error" id="movement-date-error">{errors.occurredAt}</p>}</div>
      <details className="ledger-note"><summary>Añadir nota opcional</summary><div className="field"><label htmlFor="movement-note">Nota</label><textarea id="movement-note" name="note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} disabled={locked} /></div></details>
      {projected !== null && account && <div className={`ledger-preview ${projected < 0n && kind === "expense" ? "warning" : ""}`}><span>Saldo previsto en {account.name}</span><strong>{formatMoney(projected, account.currency_code)}</strong>{projected < 0n && kind === "expense" && <p><CircleAlert size={16} aria-hidden="true" />El gasto supera el saldo registrado. Puedes guardarlo si refleja tu saldo real.</p>}</div>}
      <div className="ledger-feedback" role="alert">{message}</div>{uncertain && <p className="field-hint">Los campos se mantienen fijos hasta confirmar este intento. Reintentar conserva el mismo registro.</p>}
      <div className="ledger-entry-actions"><button type="button" className="button button-secondary" disabled={pending} onClick={() => { if (!uncertain || window.confirm("El guardado podría haberse completado. Consulta el historial antes de volver a registrar este movimiento.")) onCancel(); }}>Cancelar registro</button><button type="submit" className="button button-primary" disabled={pending || conflict}>{pending && <LoaderCircle className="loading-icon" size={18} aria-hidden="true" />}{pending ? "Guardando…" : uncertain ? "Reintentar registro" : kind === "income" ? "Guardar ingreso" : "Guardar gasto"}</button></div>
    </form>
  </section>;
}
