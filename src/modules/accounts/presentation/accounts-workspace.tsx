"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeftRight, Archive, Building2, CircleAlert, LoaderCircle, Pencil, Plus, Trash2, Wallet, X } from "lucide-react";
import { accountTypes, createAccountSchema, deleteAccountSchema, updateAccountSchema, type Account } from "../domain/account";
import { decimalMoney, formatMoney, type Currency } from "@/shared/money";
import { getFieldErrors, type FieldErrors } from "@/modules/identity/domain/auth";
import { AccountDeleteDialog } from "./account-delete-dialog";
import { Toast } from "@/shared/ui";
import "./accounts.css";
import { TransferDialog } from "@/modules/transactions";

type Draft = { requestId: string; account: Account | null };
export function AccountsWorkspace({ initialAccounts, timezone, preferredCurrency, onAccountsChange, onChanged, startCreating = false, setGuard }: { preferredCurrency: Currency; initialAccounts: Account[]; timezone: string; onAccountsChange?: (accounts: Account[]) => void; onChanged?: () => Promise<boolean>; startCreating?: boolean; setGuard?: (guard: () => boolean) => void }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  useEffect(() => { onAccountsChange?.(accounts); }, [accounts, onAccountsChange]);
  const [transferring, setTransferring] = useState(false);
  const [preparingTransfer, setPreparingTransfer] = useState(false);
  const [archived, setArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(() => startCreating ? { requestId: crypto.randomUUID(), account: null } : null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState("");
  const [, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (draft && !dialog.current?.open) dialog.current?.showModal(); }, [draft]);
  useEffect(() => { if (deleting && !deleteDialog.current?.open) deleteDialog.current?.showModal(); }, [deleting]);
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
    void onChanged?.();
    requestAnimationFrame(() => document.getElementById(`real-account-${account.id}`)?.focus({ preventScroll: true }));
    if (account.status === "archived") setArchived(true);
  }
  const visible = accounts.filter((account) => archived || account.status === "active");
  const total = (currency: Currency) => accounts.filter((a) => a.currency_code === currency).reduce((sum, a) => sum + BigInt(a.balance_minor), 0n);
  const date = (value: string) => new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
  const add = () => setDraft({ requestId: crypto.randomUUID(), account: null });
  function closeDelete() { deleteDialog.current?.close(); setDeleting(null); setDeleteMessage(""); }
  async function remove(account: Account) {
    if (deletePending) return;
    const parsed = deleteAccountSchema.safeParse({ id: account.id, expectedVersion: account.version });
    if (!parsed.success) { setDeleteMessage("Actualiza las cuentas antes de eliminar esta."); return; }
    setDeletePending(true); setDeleteMessage("");
    try {
      const response = await fetch("/api/v1/accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (!response.ok || !body.ok) { setDeleteMessage(body.message ?? "No pudimos eliminar la cuenta. Actualiza e inténtalo de nuevo."); return; }
      setAccounts(body.accounts); closeDelete(); setFailed(false); setFeedback("Cuenta eliminada. Sus movimientos se conservan en el historial como «Cuenta eliminada».");
      await onChanged?.();
    } catch { setDeleteMessage("No pudimos confirmar la eliminación. Actualiza las cuentas y reintenta."); }
    finally { setDeletePending(false); }
  }
  return <div className="real-accounts">
    <Toast message={feedback} type={failed ? "error" : "success"} duration={4000} onClose={() => setFeedback("")} />
    <div className="real-toolbar"><button className="button button-secondary" disabled={preparingTransfer || !!draft || !!deleting || !accounts.some((a) => a.status === "active")} onClick={async () => { setPreparingTransfer(true); try { if (await refresh()) setTransferring(true); } finally { setPreparingTransfer(false); } }}><ArrowLeftRight size={18} aria-hidden="true" />Transferir</button><button className="home-primary-button" disabled={accounts.length >= 100} onClick={add}><Plus size={18} aria-hidden="true" />Añadir cuenta</button></div>
    {accounts.length > 0 && <section className="real-balances" aria-label="Saldos registrados por moneda">{([preferredCurrency, preferredCurrency === "PEN" ? "USD" : "PEN"] as Currency[]).map((currency) => { const count = accounts.filter((a) => a.currency_code === currency).length; return <article key={currency}><span>{currency === "PEN" ? "Soles peruanos" : "Dólares estadounidenses"}<small>{currency}</small></span><strong>{count ? formatMoney(total(currency), currency) : "Sin cuentas"}</strong><p>{count ? `${count} ${count === 1 ? "cuenta registrada" : "cuentas registradas"}, incluidas las archivadas` : `Todavía no registras cuentas en ${currency}`}</p></article>; })}</section>}
    <>
      {accounts.length === 0 ? <section className="home-real-empty"><span className="empty-brand" aria-hidden="true"><Wallet size={44} strokeWidth={1.2} /></span><h2>Empieza por tu primera cuenta.</h2><p>Puede ser tu efectivo, una cuenta bancaria o tus ahorros. Solo necesitas un nombre, su moneda y el saldo con el que comienzas.</p><button className="home-primary-button" onClick={add}><Plus size={18} aria-hidden="true" />Crear mi primera cuenta</button><small>No pediremos números de cuenta ni documentos bancarios.</small></section> : <section className="home-panel real-account-list" aria-labelledby="real-accounts-title"><div className="panel-heading"><h2 id="real-accounts-title">Cuentas registradas</h2><span>{accounts.length} de 100</span></div><label className="archive-filter"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Mostrar archivadas</label><div className="real-account-grid">{visible.map((account) => <article className="real-account-card" key={account.id}><div className="real-account-top"><span className="account-symbol">{account.type === "bank" ? <Building2 size={21} aria-hidden="true" /> : <Wallet size={21} aria-hidden="true" />}</span><span className={`account-status ${account.status}`}>{account.status === "active" ? "Activa" : "Archivada"}</span></div><h3 id={`real-account-${account.id}`} tabIndex={-1}>{account.name}</h3><p className="real-account-type">{accountTypes[account.type]} · {account.currency_code}</p><strong className="real-account-balance">{formatMoney(BigInt(account.balance_minor), account.currency_code)}</strong><p className="real-opening-date">Apertura: {date(account.opening_at)}</p><div className="real-account-actions"><button className="home-text-button" onClick={() => setDraft({ requestId: crypto.randomUUID(), account })} aria-label={`Editar cuenta ${account.name}`}><Pencil size={15} aria-hidden="true" />Editar cuenta</button><button className="home-icon-button account-delete-trigger" onClick={() => setDeleting(account)} aria-label={`Eliminar cuenta ${account.name}`}><Trash2 size={17} aria-hidden="true" /></button></div></article>)}</div>{visible.length === 0 && <p className="real-info">Todas tus cuentas están archivadas. Activa Mostrar archivadas para verlas o restaurarlas.</p>}</section>}
      {accounts.length > 0 && <div className="real-info"><CircleAlert size={18} aria-hidden="true" /><p>El saldo registrado incluye las aperturas, también de cuentas archivadas. Las aperturas no son ingresos y PEN/USD se muestran por separado. Los saldos incluyen los ingresos y gastos vigentes. Las cuentas eliminadas dejan de sumar; sus movimientos permanecen en el historial.</p></div>}
    </>
    {transferring && <TransferDialog accounts={accounts} timezone={timezone} setGuard={setGuard} onClose={() => setTransferring(false)} onSaved={async () => { const refreshed = await refresh(); await onChanged?.(); if (refreshed) { setFailed(false); setFeedback("Transferencia guardada."); } }} />}
    <dialog ref={dialog} className="finzi-dialog real-account-dialog" aria-labelledby="real-account-title" onCancel={(event) => { if (busy.current) event.preventDefault(); }} onClose={() => setDraft(null)}>{draft && <AccountForm key={draft.requestId} draft={draft} defaultCurrency={preferredCurrency} onBusy={(value) => { busy.current = value; }} onSave={saved} onClose={() => dialog.current?.close()} onReload={async () => { dialog.current?.close(); await refresh(); }} />}</dialog>
    <dialog ref={deleteDialog} className="finzi-dialog real-account-dialog account-delete-dialog" aria-labelledby="account-delete-title" aria-describedby="account-delete-copy" onCancel={(event) => { if (deletePending) event.preventDefault(); }} onClose={closeDelete}>{deleting && <AccountDeleteDialog account={deleting} pending={deletePending} message={deleteMessage} onClose={closeDelete} onDelete={() => remove(deleting)} />}</dialog>
  </div>;
}

function AccountForm({ draft, defaultCurrency, onBusy, onSave, onClose, onReload }: { defaultCurrency: Currency; onBusy: (value: boolean) => void; draft: Draft; onSave: (account: Account) => void; onClose: () => void; onReload: () => Promise<void> }) {
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
      setMessage(body.message ?? "No pudimos confirmar el guardado. Reintenta desde este formulario."); setConflict(body.code === "CONFLICT" || body.code === "OPENING_LOCKED");
      if (body.fieldErrors) setErrors(body.fieldErrors);
    } catch { setMessage("No pudimos confirmar el resultado. Conserva el formulario y reintenta; se usará el mismo identificador."); }
    finally { setPending(false); onBusy(false); }
  }
  return <><div className="dialog-heading"><div><h2 id="real-account-title">{account ? "Editar cuenta" : "Crear cuenta financiera"}</h2></div><button type="button" className="home-icon-button" onClick={onClose} disabled={pending} aria-label="Cerrar cuenta"><X size={20} /></button></div><form ref={form} action="/api/v1/accounts" method="post" onSubmit={submit} className="finzi-form" noValidate aria-busy={pending}><noscript><p>Activa JavaScript para guardar esta cuenta.</p></noscript><div className="field"><label htmlFor="real-name">Nombre de la cuenta</label><input id="real-name" name="name" autoComplete="off" value={name} onChange={(event) => { setName(event.target.value); setErrors({}); }} maxLength={100} required disabled={pending} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "real-name-error" : undefined} />{errors.name && <p className="field-error" id="real-name-error">{errors.name}</p>}</div>
    <div className="finzi-form-row"><div className="field"><label htmlFor="real-type">Tipo de cuenta</label><select id="real-type" name="type" value={type} disabled={Boolean(account) || pending} onChange={(event) => setType(event.target.value as Account["type"])}>{Object.entries(accountTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="field"><label htmlFor="real-currency">Moneda</label><select id="real-currency" name="currency" value={currency} disabled={Boolean(account) || pending} onChange={(event) => setCurrency(event.target.value as Currency)}><option value="PEN">Soles · PEN</option><option value="USD">Dólares · USD</option></select></div></div><div className="field"><label htmlFor="real-opening">Saldo inicial en {currency}</label><input id="real-opening" name="openingBalance" value={openingBalance} onChange={(event) => { setBalance(event.target.value); setErrors({}); }} inputMode="decimal" required readOnly={account ? !account.can_edit_opening : false} disabled={pending} aria-invalid={Boolean(errors.openingBalance)} aria-describedby={errors.openingBalance ? "real-opening-error" : undefined} />{errors.openingBalance && <p className="field-error" id="real-opening-error">{errors.openingBalance}</p>}</div>
    {account && <label className="archive-option"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} disabled={pending} /><span><Archive size={16} aria-hidden="true" />Cuenta archivada<small>Oculta la cuenta de la lista activa; su saldo sigue incluido. Desmarca para restaurarla.</small></span></label>}
    <div className="feedback-slot" role="alert">{message && <p className="field-error">{message}</p>}</div>{conflict && <button type="button" className="home-text-button" onClick={onReload}>Descartar el borrador y actualizar cuentas</button>}
    <div className="finzi-form-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={pending}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending || conflict}>{pending && <LoaderCircle className="loading-icon" size={18} aria-hidden="true" />}{pending ? "Guardando…" : account ? "Guardar cambios" : "Guardar cuenta"}</button></div></form></>;
}
