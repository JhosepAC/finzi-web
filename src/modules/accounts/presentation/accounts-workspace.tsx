"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, ArrowRight, Building2, Check, CircleAlert, FlaskConical, LoaderCircle, Pencil, Plus, RefreshCw, Wallet, X } from "lucide-react";
import { accountTypes, createAccountSchema, updateAccountSchema, type Account } from "../domain/account";
import { decimalMoney, formatMoney, type Currency } from "@/shared/money";
import { getFieldErrors, type FieldErrors } from "@/modules/identity/domain/auth";
import "./accounts.css";

type Draft = { requestId: string; account: Account | null };
export function AccountsWorkspace({ initialAccounts, timezone, preferredCurrency, view, onViewAccounts, onExplore }: { preferredCurrency: Currency; initialAccounts: Account[]; timezone: string; view: "home" | "movements" | "accounts"; onViewAccounts: () => void; onExplore: () => void }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [archived, setArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (draft && !dialog.current?.open) dialog.current?.showModal(); }, [draft]);
  async function refresh() {
    setRefreshing(true); setFeedback(""); setFailed(false);
    try {
      const response = await fetch("/api/v1/accounts", { cache: "no-store", signal: AbortSignal.timeout(15000) }); const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "No pudimos cargar tus cuentas.");
      setAccounts(data.accounts); return true;
    } catch (error) { setFeedback(`${error instanceof Error ? error.message : "No pudimos actualizar las cuentas."} Se muestran los últimos datos cargados.`); setFailed(true); return false; }
    finally { setRefreshing(false); }
  }
  function saved(account: Account) {
    setAccounts((previous) => previous.some((item) => item.id === account.id) ? previous.map((item) => item.id === account.id ? account : item) : [...previous, account]);
    dialog.current?.close(); setFailed(false); setFeedback("Cuenta guardada en tu perfil financiero.");
    requestAnimationFrame(() => document.getElementById(`real-account-${account.id}`)?.focus({ preventScroll: true }));
    if (account.status === "archived") setArchived(true);
  }
  const visible = accounts.filter((account) => archived || account.status === "active");
  const total = (currency: Currency) => accounts.filter((a) => a.currency_code === currency).reduce((sum, a) => sum + BigInt(a.opening_minor), 0n);
  const date = (value: string) => new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
  const add = () => setDraft({ requestId: crypto.randomUUID(), account: null });
  return <div className="real-accounts">
    <div className="real-toolbar"><span className="real-data-label"><Check size={16} aria-hidden="true" />Tus datos guardados</span><button className="home-text-button" onClick={refresh} disabled={refreshing}><RefreshCw size={16} aria-hidden="true" />{refreshing ? "Actualizando…" : "Actualizar cuentas"}</button><button className="home-primary-button" disabled={accounts.length >= 100} onClick={add}><Plus size={18} aria-hidden="true" />Añadir cuenta</button></div>
    {accounts.length > 0 && <section className="real-balances" aria-label="Saldos registrados por moneda">{([preferredCurrency, preferredCurrency === "PEN" ? "USD" : "PEN"] as Currency[]).map((currency) => { const count = accounts.filter((a) => a.currency_code === currency).length; return <article key={currency}><span>{currency === "PEN" ? "Soles peruanos" : "Dólares estadounidenses"}<small>{currency}</small></span><strong>{count ? formatMoney(total(currency), currency) : "Sin cuentas"}</strong><p>{count ? `${count} ${count === 1 ? "cuenta registrada" : "cuentas registradas"}, incluidas las archivadas` : `Todavía no registras cuentas en ${currency}`}</p></article>; })}</section>}
    {view === "movements" ? <section className="home-real-empty"><Wallet size={42} aria-hidden="true" /><h2>Tus cuentas ya tienen un punto de partida.</h2><p>Por ahora, los saldos corresponden a las aperturas. El registro de ingresos, gastos y transferencias llegará en la siguiente etapa.</p><button className="home-primary-button" onClick={onViewAccounts}>Ver mis cuentas<ArrowRight size={16} aria-hidden="true" /></button></section> : <>
      {accounts.length === 0 ? <section className="home-real-empty"><span className="empty-brand" aria-hidden="true"><Wallet size={44} strokeWidth={1.2} /></span><h2>Empieza por tu primera cuenta.</h2><p>Puede ser tu efectivo, una cuenta bancaria o tus ahorros. Solo necesitas un nombre, su moneda y el saldo con el que comienzas.</p><button className="home-primary-button" onClick={add}><Plus size={18} aria-hidden="true" />Crear mi primera cuenta</button><small>No pediremos números de cuenta ni documentos bancarios.</small></section> : <section className="home-panel real-account-list" aria-labelledby="real-accounts-title"><div className="panel-heading"><h2 id="real-accounts-title">{view === "home" ? "Tus cuentas" : "Cuentas registradas"}</h2><span>{accounts.length} de 100</span></div><label className="archive-filter"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Mostrar archivadas</label><div className="real-account-grid">{visible.map((account) => <article className="real-account-card" key={account.id}><div className="real-account-top"><span className="account-symbol">{account.type === "bank" ? <Building2 size={21} aria-hidden="true" /> : <Wallet size={21} aria-hidden="true" />}</span><span className={`account-status ${account.status}`}>{account.status === "active" ? "Activa" : "Archivada"}</span></div><h3 id={`real-account-${account.id}`} tabIndex={-1}>{account.name}</h3><p className="real-account-type">{accountTypes[account.type]} · {account.currency_code}</p><strong className="real-account-balance">{formatMoney(BigInt(account.opening_minor), account.currency_code)}</strong><p className="real-opening-date">Apertura: {date(account.opening_at)}</p><button className="home-text-button" onClick={() => setDraft({ requestId: crypto.randomUUID(), account })} aria-label={`Editar cuenta ${account.name}`}><Pencil size={15} aria-hidden="true" />Editar cuenta</button></article>)}</div>{visible.length === 0 && <p className="real-info">Todas tus cuentas están archivadas. Activa Mostrar archivadas para verlas o restaurarlas.</p>}</section>}
      {accounts.length > 0 && <div className="real-info"><CircleAlert size={18} aria-hidden="true" /><p>El saldo registrado incluye las aperturas, también de cuentas archivadas. Las aperturas no son ingresos y PEN/USD se muestran por separado. Aún no hay movimientos reales en esta versión.</p></div>}
    </>}
    <div className={`real-feedback ${failed ? "failed" : ""}`} role="status" aria-live="polite">{feedback}</div>
    <div className="real-sample-link"><span>¿Quieres explorar gráficos y movimientos?</span><button className="home-text-button" onClick={onExplore}><FlaskConical size={16} aria-hidden="true" />Explorar con datos de prueba</button></div>
    <dialog ref={dialog} className="sample-dialog real-account-dialog" aria-labelledby="real-account-title" onCancel={(event) => { if (busy.current) event.preventDefault(); }} onClose={() => setDraft(null)}>{draft && <AccountForm key={draft.requestId} draft={draft} timezone={timezone} defaultCurrency={preferredCurrency} onBusy={(value) => { busy.current = value; }} existingAccounts={accounts} onSave={saved} onClose={() => dialog.current?.close()} onReload={async () => { dialog.current?.close(); await refresh(); }} />}</dialog>
  </div>;
}

function AccountForm({ draft, timezone, defaultCurrency, onBusy, existingAccounts, onSave, onClose, onReload }: { defaultCurrency: Currency; onBusy: (value: boolean) => void; draft: Draft; timezone: string; existingAccounts: Account[]; onSave: (account: Account) => void; onClose: () => void; onReload: () => Promise<void> }) {
  const account = draft.account;
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<Account["type"]>(account?.type ?? "cash");
  const [currency, setCurrency] = useState<Currency>(account?.currency_code ?? defaultCurrency);
  const [openingBalance, setBalance] = useState(account ? decimalMoney(BigInt(account.opening_minor)) : "0.00");
  const [archived, setArchived] = useState(account?.status === "archived");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const duplicate = existingAccounts.some((a) => a.id !== account?.id && a.name.toLocaleLowerCase("es") === name.trim().toLocaleLowerCase("es"));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || conflict) return;
    const input = account ? { id: account.id, name, openingBalance, archived, expectedVersion: account.version } : { requestId: draft.requestId, name, type, currency, openingBalance };
    const result = (account ? updateAccountSchema : createAccountSchema).safeParse(input);
    if (!result.success) {
      const fields = getFieldErrors(result.error); setErrors(fields);
      const field = form.current?.elements.namedItem(Object.keys(fields)[0]); if (field instanceof HTMLElement) field.focus(); return;
    }
    setPending(true); onBusy(true); setErrors({}); setMessage("");
    try {
      const response = await fetch("/api/v1/accounts", { method: account ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result.data), cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (response.ok && body.ok) { onSave(body.account); return; }
      setMessage(body.message ?? "No pudimos confirmar el guardado. Reintenta desde este formulario."); setConflict(body.code === "CONFLICT");
      if (body.fieldErrors) setErrors(body.fieldErrors);
    } catch { setMessage("No pudimos confirmar el resultado. Conserva el formulario y reintenta; se usará el mismo identificador."); }
    finally { setPending(false); onBusy(false); }
  }
  return <><div className="dialog-heading"><div><span className="dialog-context">Datos reales · Se guardan en tu cuenta</span><h2 id="real-account-title">{account ? "Editar cuenta" : "Crear cuenta financiera"}</h2></div><button type="button" className="home-icon-button" onClick={onClose} disabled={pending} aria-label="Cerrar cuenta"><X size={20} /></button></div><p className="dialog-description">{account ? "La moneda y la fecha de apertura se conservan. Por ahora puedes corregir el saldo porque aún no hay movimientos reales." : "Registra el saldo que ya tienes. Esto no es un ingreso ni mueve dinero entre bancos."}</p><form ref={form} action="/api/v1/accounts" method="post" onSubmit={submit} className="sample-form" noValidate aria-busy={pending}><noscript><p>Activa JavaScript para guardar esta cuenta.</p></noscript><div className="field"><label htmlFor="real-name">Nombre de la cuenta</label><input id="real-name" name="name" autoComplete="off" value={name} onChange={(event) => { setName(event.target.value); setErrors({}); }} maxLength={100} required disabled={pending} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "real-name-error" : undefined} />{errors.name && <p className="field-error" id="real-name-error">{errors.name}</p>}{duplicate && <p className="field-hint">Ya tienes una cuenta con este nombre. Puedes guardarla, pero usa otro nombre si quieres distinguirlas.</p>}</div>
    <div className="sample-form-row"><div className="field"><label htmlFor="real-type">Tipo de cuenta</label><select id="real-type" name="type" value={type} disabled={Boolean(account) || pending} onChange={(event) => setType(event.target.value as Account["type"])}>{Object.entries(accountTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="field"><label htmlFor="real-currency">Moneda</label><select id="real-currency" name="currency" value={currency} disabled={Boolean(account) || pending} onChange={(event) => setCurrency(event.target.value as Currency)}><option value="PEN">Soles · PEN</option><option value="USD">Dólares · USD</option></select></div></div><div className="field"><label htmlFor="real-opening">Saldo inicial en {currency}</label><input id="real-opening" name="openingBalance" value={openingBalance} onChange={(event) => { setBalance(event.target.value); setErrors({}); }} inputMode="decimal" required disabled={pending} aria-invalid={Boolean(errors.openingBalance)} aria-describedby={errors.openingBalance ? "real-opening-error" : "real-opening-help"} /><p className="field-hint" id="real-opening-help">Puedes empezar en cero o con saldo negativo. Hasta 2 decimales, sin separadores de miles.</p>{errors.openingBalance && <p className="field-error" id="real-opening-error">{errors.openingBalance}</p>}</div>
    <p className="real-form-date">{account ? `Apertura registrada: ${new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(account.opening_at))}` : "La fecha y hora de apertura se registrarán al guardar."}<span>Zona horaria: {timezone}</span></p>
    {account && <label className="archive-option"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} disabled={pending} /><span><Archive size={16} aria-hidden="true" />Cuenta archivada<small>Oculta la cuenta de la lista activa; su saldo sigue incluido. Desmarca para restaurarla.</small></span></label>}
    <div className="feedback-slot" role="alert">{message && <p className="field-error">{message}</p>}</div>{conflict && <button type="button" className="home-text-button" onClick={onReload}>Descartar el borrador y actualizar cuentas</button>}
    <div className="sample-form-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={pending}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending || conflict}>{pending && <LoaderCircle className="loading-icon" size={18} aria-hidden="true" />}{pending ? "Guardando…" : account ? "Guardar cambios" : "Guardar cuenta"}</button></div><p className="field-hint">Límite inicial: 100 cuentas, incluidas las archivadas.</p></form></>;
}
