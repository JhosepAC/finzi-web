"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import type { Account } from "@/modules/accounts";
import type { Category } from "@/modules/classification/domain/category";
import { createMovementSchema, replaceMovementSchema, type Movement, type MovementKind } from "../domain/movement";
import { getFieldErrors, type FieldErrors } from "@/modules/identity/domain/auth";
import { decimalMoney, formatMoney, openingMinor } from "@/shared/money";
import { localDateTime, wallTimeToUtc } from "@/shared/time";

export function MovementForm({ accounts, categories, initialKind, replacing, duplicating, timezone, onSave, onCancel, onDirty }: { accounts: Account[]; categories: Category[]; initialKind: MovementKind; replacing?: Movement | null; duplicating?: Movement | null; timezone: string; onSave: (kind: MovementKind, currency: "PEN" | "USD", alreadyVoid: boolean) => Promise<void>; onCancel: () => void; onDirty: (dirty: boolean, pending: boolean) => void }) {
  const original = replacing ?? duplicating;
  const [requestId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<MovementKind>(original?.kind ?? initialKind);
  const [accountId, setAccount] = useState(original?.account_id ?? accounts.find((a) => a.status === "active")?.id ?? "");
  const [categoryId, setCategory] = useState(original?.category_id ?? "");
  const [destinationId, setDestination] = useState(original?.destination_id ?? "");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [timeChanged, setTimeChanged] = useState(false);
  const [amount, setAmount] = useState(original ? decimalMoney(BigInt(original.amount_minor)) : "");
  const [description, setDescription] = useState(original?.description ?? "");
  const [note, setNote] = useState(original?.note ?? "");
  const [isNow, setNow] = useState(!replacing);
  const [wallTime, setTime] = useState(() => localDateTime(replacing?.occurred_at ?? new Date(), timezone));
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
  const dirty = Boolean(amount || description || note || reason || uncertain);
  useEffect(() => { onDirty(dirty, pending); return () => onDirty(false, false); }, [dirty, pending, onDirty]);
  const account = accounts.find((a) => a.id === accountId);
  const choices = categories.filter((c) => c.kind === kind && !c.effective_archived);
  const destination = accounts.find((a) => a.id === destinationId);
  const balances = new Map<string, bigint>();
  try {
    const minor = openingMinor(amount);
    if (account && minor > 0n && (kind !== "transfer" || (destination && destination.id !== account.id && destination.currency_code === account.currency_code))) {
      const change = (id: string, delta: bigint) => { const a = accounts.find((item) => item.id === id); if (a) balances.set(id, (balances.get(id) ?? BigInt(a.balance_minor)) + delta); };
      if (replacing) {
        change(replacing.account_id, replacing.kind === "income" ? -BigInt(replacing.amount_minor) : BigInt(replacing.amount_minor));
        if (replacing.destination_id) change(replacing.destination_id, -BigInt(replacing.amount_minor));
      }
      change(account.id, kind === "income" ? minor : -minor);
      if (kind === "transfer" && destination && destination.id !== account.id && destination.currency_code === account.currency_code) change(destination.id, minor);
    }
  } catch { /* Validation names the invalid field on submit. */ }
  const projected = account ? balances.get(account.id) ?? null : null;
  function invalid(fields: FieldErrors) { focusError.current = true; setErrors(fields); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || conflict) return;
    let occurredAt: string | null = null;
    if (!isNow) { try { occurredAt = replacing && !timeChanged ? replacing.occurred_at : wallTimeToUtc(wallTime, timezone); } catch (error) { invalid({ occurredAt: error instanceof Error ? error.message : "Revisa la fecha." }); return; } }
    const input = { requestId, kind, accountId, ...(kind === "transfer" ? { destinationId } : { categoryId }), amount, description, note, occurredAt, ...(replacing ? { id: replacing.id, expectedVersion: replacing.version, reason } : {}) };
    const parsed = (replacing ? replaceMovementSchema : createMovementSchema).safeParse(input);
    if (!parsed.success) { invalid(getFieldErrors(parsed.error)); return; }
    if (original && !confirmed) { invalid({ confirmed: "Confirma que revisaste los cambios." }); return; }
    setPending(true); setMessage(""); setErrors({});
    try {
      const response = await fetch("/api/v1/movements", { method: replacing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (response.ok && body.ok) { await onSave(kind, account!.currency_code, body.status === "void"); return; }
      setUncertain(response.status >= 500); setConflict(body.code === "CONFLICT"); setMessage(body.message ?? "No pudimos confirmar el guardado. Reintenta esta operación.");
      if (body.fieldErrors) invalid(body.fieldErrors);
    } catch { setUncertain(true); setMessage("No pudimos confirmar el resultado. Reintenta el mismo registro; sus datos se conservan para evitar duplicados."); }
    finally { setPending(false); }
  }
  const locked = pending || uncertain;
  return <section className="home-panel ledger-entry" aria-labelledby="movement-form-title"><div className="ledger-entry-heading"><h2 id="movement-form-title">{replacing ? "Editar movimiento" : duplicating ? "Duplicar movimiento" : kind === "transfer" ? "Transferir entre mis cuentas" : kind === "income" ? "Registrar ingreso" : "Registrar gasto"}</h2><p>{replacing ? "El registro anterior se conserva. Al guardar, solo el reemplazo afectará tus saldos." : kind === "transfer" ? "Mueve dinero entre cuentas de la misma moneda. Tu saldo total se conserva." : "Cuenta y categoría determinan dónde se registra."}</p></div>
    <form ref={form} action="/api/v1/movements" method="post" onSubmit={submit} onChange={(e) => { if (original && !(e.target instanceof HTMLInputElement && e.target.name === "confirmed")) setConfirmed(false); }} noValidate aria-busy={pending}>
      {duplicating && <p className="ledger-original">Se creará un movimiento independiente. Revisa el importe y la fecha antes de guardarlo; el original se conservará.</p>}
      {replacing && <div className="ledger-original"><h3>Registro anterior</h3><p><strong>{replacing.description}</strong><span>{replacing.kind === "income" ? "Ingreso" : replacing.kind === "expense" ? "Gasto" : "Transferencia"} · {formatMoney(BigInt(replacing.amount_minor), replacing.currency_code)}</span><span>{replacing.account_name}{replacing.destination_name ? ` → ${replacing.destination_name}` : ` · ${replacing.category_name}`}</span><time dateTime={replacing.occurred_at}>{new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "medium", timeZone: timezone }).format(new Date(replacing.occurred_at))}</time></p></div>}
      <div className="ledger-entry-grid"><div className="field"><label htmlFor="movement-kind">Tipo de movimiento</label><select id="movement-kind" value={kind} disabled={locked} onChange={(event) => { setKind(event.target.value as typeof kind); setCategory(""); setDestination(""); setErrors({}); }}><option value="expense">Gasto</option><option value="income">Ingreso</option><option value="transfer">Transferencia</option></select></div>
        <div className="field"><label htmlFor="movement-account">{kind === "transfer" ? "Cuenta de origen" : "Cuenta"}</label><select id="movement-account" name="accountId" value={accountId} disabled={locked} onChange={(event) => { setAccount(event.target.value); setDestination(""); setErrors({}); }} aria-invalid={Boolean(errors.accountId)} aria-describedby={errors.accountId ? "movement-account-error" : undefined}><option value="">Elige una cuenta</option>{account?.status === "archived" && <option value={account.id} disabled>{account.name} (archivada; elige una activa)</option>}{accounts.filter((a) => a.status === "active").map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency_code}</option>)}</select>{errors.accountId && <p className="field-error" id="movement-account-error">{errors.accountId}</p>}</div>
        <div className="field"><label htmlFor="movement-amount">Importe{account ? ` en ${account.currency_code}` : ""}</label><input id="movement-amount" name="amount" value={amount} onChange={(event) => { setAmount(event.target.value); setErrors({}); }} inputMode="decimal" autoComplete="off" maxLength={19} disabled={locked} required aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? "movement-amount-error" : "movement-amount-help"} /><p className="field-hint" id="movement-amount-help">Mayor que cero, hasta 2 decimales. Sin separadores de miles.</p>{errors.amount && <p className="field-error" id="movement-amount-error">{errors.amount}</p>}</div>
        {kind === "transfer" ? <div className="field"><label htmlFor="movement-destination">Cuenta de destino</label><select id="movement-destination" name="destinationId" value={destinationId} onChange={(e) => { setDestination(e.target.value); setErrors({}); }} disabled={locked} aria-invalid={Boolean(errors.destinationId)} aria-describedby="movement-destination-help movement-destination-error"><option value="">Elige otra cuenta en {account?.currency_code ?? "la misma moneda"}</option>{destination?.status === "archived" && <option value={destination.id} disabled>{destination.name} (archivada; elige una activa)</option>}{accounts.filter((a) => a.status === "active" && a.id !== accountId && a.currency_code === account?.currency_code).map((a) => <option value={a.id} key={a.id}>{a.name} · {a.currency_code}</option>)}</select><p className="field-hint" id="movement-destination-help">Sin cambio de moneda ni categoría.{!accounts.some((a) => a.status === "active" && a.id !== accountId && a.currency_code === account?.currency_code) && " Necesitas otra cuenta activa en esta moneda. Puedes crearla en Cuentas."}</p>{errors.destinationId && <p className="field-error" id="movement-destination-error">{errors.destinationId}</p>}</div> : <div className="field"><label htmlFor="movement-category">Categoría</label><select id="movement-category" name="categoryId" value={categoryId} onChange={(event) => { setCategory(event.target.value); setErrors({}); }} disabled={locked} aria-invalid={Boolean(errors.categoryId)} aria-describedby={errors.categoryId ? "movement-category-error" : undefined}><option value="">Elige una categoría de {kind === "income" ? "ingreso" : "gasto"}</option>{categoryId && !choices.some((c) => c.id === categoryId) && <option value={categoryId} disabled>Categoría anterior inactiva; elige otra</option>}{choices.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? `${categories.find((p) => p.id === c.parent_id)?.name} / ` : ""}{c.name}</option>)}</select>{errors.categoryId && <p className="field-error" id="movement-category-error">{errors.categoryId}</p>}{!choices.length && <p className="field-hint">Necesitas una categoría activa de este tipo. Puedes crearla en Categorías.</p>}</div>}
        <div className="field ledger-wide"><label htmlFor="movement-description">Descripción</label><input id="movement-description" name="description" value={description} onChange={(event) => { setDescription(event.target.value); setErrors({}); }} autoComplete="off" maxLength={200} required disabled={locked} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "movement-description-error" : undefined} />{errors.description && <p className="field-error" id="movement-description-error">{errors.description}</p>}</div>
      </div>
      <div className="ledger-date"><label className="ledger-check"><input type="checkbox" checked={isNow} onChange={(event) => { setNow(event.target.checked); setTimeChanged(true); setErrors({}); }} disabled={locked} />Ocurrió ahora</label>{!isNow && <div className="field"><label htmlFor="movement-date">Fecha y hora del movimiento</label><input id="movement-date" name="occurredAt" type="datetime-local" value={wallTime} onChange={(event) => { setTime(event.target.value); setTimeChanged(true); setErrors({}); }} disabled={locked} aria-invalid={Boolean(errors.occurredAt)} aria-describedby="movement-date-help movement-date-error" /></div>}<p className="field-hint" id="movement-date-help">Zona: {timezone}. {isNow ? "La fecha se asigna al guardar." : account ? `Apertura: ${new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "medium", timeZone: timezone }).format(new Date(account.opening_at))}.` : "Elige una fecha ya ocurrida."}</p>{errors.occurredAt && <p className="field-error" id="movement-date-error">{errors.occurredAt}</p>}</div>
      {kind === "transfer" && destination && !isNow && <p className="field-hint">Apertura de {destination.name}: {new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "medium", timeZone: timezone }).format(new Date(destination.opening_at))}. La fecha debe ser posterior o igual a ambas aperturas.</p>}
      {replacing && !timeChanged && <p className="field-hint">Se conservará la fecha y hora exacta del registro anterior.</p>}
      <details className="ledger-note" open={original?.note ? true : undefined}><summary>Añadir nota opcional</summary><div className="field"><label htmlFor="movement-note">Nota</label><textarea id="movement-note" name="note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} disabled={locked} /></div></details>
      {projected !== null && account && <div className={`ledger-preview ${[...balances.values()].some((v) => v < 0n) ? "warning" : ""}`} aria-live="polite">
        {balances.size === 1 ? <><span>Saldo previsto en {account.name}</span><strong>{formatMoney(projected, account.currency_code)}</strong></> : <><span className="ledger-preview-label">Saldos después de {replacing ? "la edición" : "transferir"}</span><dl className="ledger-balance-pair">{[...balances].map(([id, value]) => { const a = accounts.find((item) => item.id === id)!; return <div key={id}><dt>{a.name}<small>Actual: {formatMoney(BigInt(a.balance_minor), a.currency_code)}</small></dt><dd>{formatMoney(value, a.currency_code)}</dd></div>; })}</dl></>}
        {[...balances.values()].some((v) => v < 0n) && <p><CircleAlert size={16} aria-hidden="true" />{kind === "expense" && !replacing ? "El gasto supera el saldo registrado." : "Una cuenta quedará con saldo negativo."} Puedes guardarlo si refleja tu saldo real.</p>}
        {kind === "transfer" && <p>El dinero sale del origen y entra al destino. No se cuenta como ingreso ni gasto.</p>}
      </div>}
      {original && <div className="ledger-replacement-confirm">{replacing && <div className="field"><label htmlFor="movement-reason">Motivo de la edición</label><textarea id="movement-reason" name="reason" rows={2} maxLength={300} value={reason} disabled={locked} onChange={(e) => { setReason(e.target.value); setErrors({}); }} aria-invalid={Boolean(errors.reason)} aria-describedby="movement-reason-help movement-reason-error" /><p id="movement-reason-help" className="field-hint">Se guardará junto al registro anterior y su reemplazo.</p>{errors.reason && <p id="movement-reason-error" className="field-error">{errors.reason}</p>}</div>}<label className="ledger-check"><input name="confirmed" type="checkbox" checked={confirmed} disabled={locked} onChange={(e) => setConfirmed(e.target.checked)} aria-invalid={Boolean(errors.confirmed)} aria-describedby={errors.confirmed ? "movement-confirm-error" : undefined} />{duplicating ? "He confirmado el importe y la fecha del nuevo movimiento." : "He revisado los cambios y los saldos resultantes."}</label>{errors.confirmed && <p id="movement-confirm-error" className="field-error">{errors.confirmed}</p>}</div>}
      <div className="ledger-feedback" role="alert">{message}</div>{uncertain && <p className="field-hint">Los campos se mantienen fijos hasta confirmar este intento. Reintentar conserva el mismo registro.</p>}
      <div className="ledger-entry-actions"><button type="button" className="button button-secondary" disabled={pending} onClick={() => { if (!uncertain || window.confirm("El guardado podría haberse completado. Consulta el historial antes de volver a registrar este movimiento.")) onCancel(); }}>Cancelar registro</button><button type="submit" className="button button-primary" disabled={pending || conflict}>{pending && <LoaderCircle className="loading-icon" size={18} aria-hidden="true" />}{pending ? "Guardando…" : uncertain ? "Reintentar registro" : replacing ? "Guardar cambios" : kind === "transfer" ? "Guardar transferencia" : kind === "income" ? "Guardar ingreso" : "Guardar gasto"}</button></div>
    </form>
  </section>;
}
