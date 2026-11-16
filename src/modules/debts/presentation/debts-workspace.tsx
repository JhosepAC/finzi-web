"use client";
import { DebtSymbol } from "./debt-symbol";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, HandCoins, Plus, RefreshCw, X, LayoutGrid, List } from "lucide-react";
import { Toast } from "@/shared/ui";
import type { Account } from "@/modules/accounts";
import { formatMoney, openingMinor, type Currency } from "@/shared/money";
import { debtCatalogSchema, debtCategories, debtCommandSchema, deadline, debtState, debtStates, remaining, type Debt, type DebtCatalog } from "../domain/debt";
import { DebtEditor } from "./debt-editor";
import { DebtPayment } from "./debt-payment";
import "./debts.css";

const date = (value: string) => new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
export function DebtsWorkspace({ accounts: initialAccounts, preferredCurrency, timezone, onChanged, setGuard, onMovement, onAccounts, onCategories }: { accounts: Account[]; preferredCurrency: Currency; timezone: string; onChanged: () => Promise<boolean>; setGuard: (guard: () => boolean) => void; onMovement: (id: string, currency: Currency) => void; onAccounts: () => void; onCategories: () => void }) {
  const [catalog, setCatalog] = useState<DebtCatalog | null>(null); const [accounts, setAccounts] = useState(initialAccounts);
  const [currency, setCurrency] = useState(preferredCurrency); const [status, setStatus] = useState(""); const [due, setDue] = useState(""); const [category, setCategory] = useState(""); const [query, setQuery] = useState(""); const [sort, setSort] = useState("due"); const [min, setMin] = useState(""); const [max, setMax] = useState(""); const [visible, setVisible] = useState(12);
  const [editor, setEditor] = useState<{ debt: Debt | null } | null>(null); const [payment, setPayment] = useState<Debt | null>(null); const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [uncertain, setUncertain] = useState<unknown>(null);
  const submitting = useRef(false); const formDialog = useRef<HTMLDialogElement>(null); const feedback = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null); const changed = useRef(false);
  const [view, setView] = useState<"cards" | "list">("cards");
  const busy = pending || uncertain !== null;
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const options = { cache: "no-store" as const, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) };
      const debtsResponse = await fetch("/api/v1/debts", options);
      if (!debtsResponse.ok) throw new Error();
      const debts = debtCatalogSchema.parse(await debtsResponse.json());
      if (signal?.aborted) return false;
      setCatalog(debts); setAccounts(debts.accounts); setError(""); return true;
    } catch { if (!signal?.aborted) setError("No pudimos actualizar tus deudas y saldos. Se conservan los últimos datos; reintenta antes de registrar pagos."); return false; }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); }); return () => controller.abort(); }, [load]);
  useEffect(() => { if (error) feedback.current?.focus(); }, [error]);
  useEffect(() => { if (editor || payment) { if (!formDialog.current?.open) formDialog.current?.showModal(); } else formDialog.current?.close(); }, [editor, payment]);
  useEffect(() => {
    const dirty = !!editor || !!payment || busy;
    const guard = () => busy ? false : !dirty || window.confirm("Hay un formulario de deuda sin guardar. ¿Quieres salir y descartar los cambios?");
    setGuard(guard); const unload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const focus = () => { if (!dirty) void load(); };
    window.addEventListener("beforeunload", unload); window.addEventListener("focus", focus);
    return () => { setGuard(() => true); window.removeEventListener("beforeunload", unload); window.removeEventListener("focus", focus); };
  }, [editor, payment, busy, load, setGuard]);
  function close() { if (busy) return; setEditor(null); setPayment(null); setError(""); changed.current = false; requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus({ preventScroll: true })); }
  function requestClose() { if (!busy && (!changed.current || window.confirm("¿Descartar los cambios sin guardar?"))) close(); }
  function open(debt: Debt | null, paying = false) {
    if (busy || loading || (editor || payment) && !window.confirm("¿Descartar el formulario sin guardar?")) return;
    setEditor(paying ? null : { debt }); setPayment(paying ? debt : null); setError(""); setMessage("");
    opener.current = document.activeElement as HTMLElement; changed.current = false;
  }
  async function execute(input: unknown) {
    if (submitting.current) return;
    const parsed = debtCommandSchema.safeParse(input);
    if (!parsed.success) { setError("Revisa los campos: " + [...new Set(parsed.error.issues.map((issue) => ({ name: "nombre", creditor: "acreedor", amount: "importe mayor que cero, hasta 16 dígitos y 2 decimales", dueDate: "fecha de vencimiento", accountId: "cuenta", categoryId: "categoría de gasto", movementId: "gasto seleccionado", occurredAt: "fecha del pago" }[String(issue.path[0])] ?? "datos del formulario")))].join(", ") + "."); return; }
    submitting.current = true; setPending(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/debts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), signal: AbortSignal.timeout(20000) }); const body = await response.json();
      if (!response.ok) {
        if (response.status >= 500) { setUncertain(parsed.data); setError(body.message ?? "No pudimos confirmar el guardado. Reintenta la misma operación."); }
        else { setUncertain(null); setError(body.message ?? "Revisa los datos e inténtalo de nuevo."); }
        return;
      }
      setUncertain(null); setEditor(null); setPayment(null); if ("currency" in parsed.data) setCurrency(parsed.data.currency);
      setMessage(({ create: "Deuda registrada. Ya puedes añadir sus pagos.", update: "Deuda actualizada.", delete: "Deuda eliminada de la lista. Sus gastos se conservan en Movimientos.", pay: "Pago registrado y saldo pendiente actualizado.", unlink: "Pago desvinculado. El gasto se conserva en Movimientos.", voidpay: "Gasto anulado. El importe vuelve a estar pendiente en la deuda." })[parsed.data.action]);
      await load(); await onChanged();
    } catch { setUncertain(parsed.data); setError("No pudimos confirmar el guardado. Reintenta la misma operación; no se duplicará el pago ni la deuda."); }
    finally { submitting.current = false; setPending(false); }
  }
  const all = (catalog?.debts ?? []).filter((d) => !d.deleted_at && d.currency_code === currency);
  const total = all.reduce((n, d) => n + BigInt(d.amount_minor), 0n); const paid = all.reduce((n, d) => n + BigInt(d.paid_minor), 0n); const owed = total - paid;
  const available = accounts.filter((a) => a.status === "active" && a.currency_code === currency).reduce((n, a) => n + BigInt(a.balance_minor), 0n);
  const today = catalog?.today ?? ""; const overdue = all.filter((d) => deadline(d, today) === "overdue"); const upcoming = all.filter((d) => deadline(d, today) === "upcoming");
  const occupied = new Set((catalog?.debts ?? []).flatMap((d) => d.payments.filter((p) => p.active).map((p) => p.effective_id)));
  let minimum = 0n, maximum: bigint | null = null, invalidRange = false;
  try { minimum = min ? openingMinor(min) : 0n; maximum = max ? openingMinor(max) : null; invalidRange = minimum < 0n || maximum !== null && maximum < minimum; } catch { invalidRange = true; }
  const matches = all.filter((d) => (!status || debtState(d) === status) && (!category || (category === "none" ? !d.category : d.category === category)) && (!due || deadline(d, today) === due) && `${d.name} ${d.creditor}`.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es")) && !invalidRange && remaining(d) >= minimum && (maximum === null || remaining(d) <= maximum));
  matches.sort((a, b) => sort === "amount" ? (remaining(a) > remaining(b) ? -1 : remaining(a) < remaining(b) ? 1 : a.id.localeCompare(b.id)) : sort === "name" ? a.name.localeCompare(b.name, "es") : sort === "recent" ? b.created_at.localeCompare(a.created_at) : (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31") || a.name.localeCompare(b.name, "es"));
  function reset() { setStatus(""); setDue(""); setCategory(""); setQuery(""); setMin(""); setMax(""); setVisible(12); }
  return <div className="debt-workspace" aria-busy={pending}>
    <div className="debt-toolbar"><div className="debt-currency"><label htmlFor="debt-currency">Mostrar en</label><select id="debt-currency" value={currency} disabled={!!editor || !!payment || busy} onChange={(e) => { setCurrency(e.target.value as Currency); setVisible(12); }}><option value="PEN">Soles · PEN</option><option value="USD">Dólares · USD</option></select></div><button className="button button-secondary" disabled={loading || !!editor || !!payment || busy} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" />Actualizar</button><button className="button" disabled={loading || busy || !!editor || !!payment} onClick={() => open(null)}><Plus size={18} aria-hidden="true" />Registrar deuda</button></div>
    <Toast message={message} onClose={() => setMessage("")} />
    {!editor && !payment && error && <div role="alert" tabIndex={-1} ref={feedback} className="debt-error">{error}{uncertain !== null ? <button disabled={pending} onClick={() => void execute(uncertain)}>Reintentar el mismo guardado</button> : !editor && !payment && <button disabled={loading} onClick={() => void load()}>Reintentar actualización</button>}</div>}
    <dialog ref={formDialog} className="finzi-dialog debt-dialog" aria-labelledby={payment ? "debt-payment-title" : "debt-editor-title"} onChangeCapture={() => { changed.current = true; }} onCancel={(event) => { event.preventDefault(); requestClose(); }}>
      <button type="button" className="home-icon-button debt-dialog-close" aria-label="Cerrar formulario de deuda" disabled={busy} onClick={requestClose}><X size={20} /></button>
      {editor && <DebtEditor key={editor.debt?.id ?? "create"} debt={editor.debt} currency={currency} locked={busy} onSave={(command) => void execute(command)} onCancel={requestClose} />}{payment && <DebtPayment key={payment.id} debt={payment} accounts={accounts} occupied={occupied} timezone={timezone} locked={busy} onSave={(command) => void execute(command)} onCancel={requestClose} onAccounts={onAccounts} onCategories={onCategories} />}
      {(editor || payment) && error && <div role="alert" tabIndex={-1} ref={feedback} className="debt-error">{error}{uncertain !== null ? <button disabled={pending} onClick={() => void execute(uncertain)}>Reintentar el mismo guardado</button> : !editor && !payment && <button disabled={loading} onClick={() => void load()}>Reintentar actualización</button>}</div>}
      {pending && <p role="status" className="debt-dialog-saving">Guardando...</p>}
    </dialog>
    {loading && !catalog ? <div className="debt-loading" role="status">Cargando tus deudas y saldos…</div> : catalog && <>
      <div className="debt-overview"><section className="debt-summary" aria-label={`Resumen de deudas en ${currency}`}><div className="debt-summary-main"><HandCoins size={25} aria-hidden="true" /><h2>Lo que queda por pagar</h2><strong>{formatMoney(owed, currency)}</strong><p>{all.length} {all.length === 1 ? "deuda registrada" : "deudas registradas"} · {all.filter((d) => debtState(d) !== "paid").length} por terminar de pagar</p></div><dl><div><dt>Importe original</dt><dd>{formatMoney(total, currency)}</dd></div><div><dt>Ya pagado</dt><dd>{formatMoney(paid, currency)}</dd></div><div><dt>Vencidas</dt><dd>{overdue.length}<small>{formatMoney(overdue.reduce((n, d) => n + remaining(d), 0n), currency)} pendientes</small></dd></div><div><dt>Vencen en 7 días</dt><dd>{upcoming.length}<small>Incluye las que vencen hoy</small></dd></div></dl></section>
      <section className="debt-availability" aria-label="Disponibilidad para pagar"><div><h2>Tu disponible hoy</h2><p>Saldo de cuentas activas en {currency}. No incluye cuentas archivadas.</p></div><strong>{formatMoney(available, currency)}</strong><p className="debt-coverage">{owed === 0n ? "No tienes importes pendientes en esta moneda." : available >= owed ? `Después de pagar todo quedarían ${formatMoney(available - owed, currency)}.` : `Faltan ${formatMoney(owed - available, currency)} para cubrir todo lo pendiente.`}</p></section></div>
      <section aria-labelledby="debt-list-title"><div className="debt-section-heading"><div><h2 id="debt-list-title">Tus deudas</h2></div><div className="debt-list-tools"><span>{matches.length} de {all.length}</span><div className="debt-view-switch" role="group" aria-label="Vista de deudas"><button type="button" aria-label="Vista de tarjetas" aria-pressed={view === "cards"} onClick={() => setView("cards")}><LayoutGrid size={17} /></button><button type="button" aria-label="Vista de lista" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={17} /></button></div></div></div>
        <div className="debt-filters"><label className="debt-field">Buscar<input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setVisible(12); }} placeholder="Nombre o acreedor" /></label><label className="debt-field">Estado<select value={status} onChange={(e) => { setStatus(e.target.value); setVisible(12); }}><option value="">Todos</option>{Object.entries(debtStates).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label className="debt-field">Vencimiento<select value={due} onChange={(e) => { setDue(e.target.value); setVisible(12); }}><option value="">Todos</option><option value="overdue">Vencidas</option><option value="upcoming">Hoy y próximos 7 días</option><option value="later">Más adelante</option><option value="none">Sin fecha</option></select></label><label className="debt-field">Ordenar<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="due">Próximo vencimiento</option><option value="amount">Mayor importe pendiente</option><option value="name">Nombre</option><option value="recent">Más recientes</option></select></label>
          <details className="debt-extra-filters"><summary>Más filtros <ChevronDown size={15} aria-hidden="true" /></summary><div><label className="debt-field">Categoría<select value={category} onChange={(e) => { setCategory(e.target.value); setVisible(12); }}><option value="">Todas</option><option value="none">Sin categoría</option>{Object.entries(debtCategories).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label className="debt-field">Pendiente desde<input inputMode="decimal" value={min} onChange={(e) => { setMin(e.target.value); setVisible(12); }} placeholder="0.00" /></label><label className="debt-field">Pendiente hasta<input inputMode="decimal" value={max} onChange={(e) => { setMax(e.target.value); setVisible(12); }} placeholder="Sin máximo" /></label></div></details>{(status || due || category || query || min || max) && <button className="debt-text-button" onClick={reset}>Limpiar filtros</button>}
        </div>{invalidRange && <p className="debt-error" role="alert">Usa importes desde cero y hasta 2 decimales; el máximo debe ser igual o mayor al mínimo.</p>}
        {!all.length ? <div className="debt-empty"><HandCoins size={36} aria-hidden="true" /><h3>Tus deudas, con un plan claro.</h3><p>Registra a quién le debes y cuánto queda. Cada pago conservará su vínculo con tus movimientos reales.</p><button className="button" disabled={loading || busy || !!editor || !!payment} onClick={() => open(null)}>Registrar tu primera deuda en {currency}</button></div> : !matches.length ? <div className="debt-empty"><h3>No hay deudas con estos filtros.</h3><p>Prueba otro estado, vencimiento o importe.</p><button className="button button-secondary" onClick={reset}>Limpiar filtros</button></div> : <><div className={`debt-grid ${view}`}>{matches.slice(0, visible).map((debt) => {
          const state = debtState(debt), timing = deadline(debt, today), left = remaining(debt), expanded = selected === debt.id;
          const progressValue = Number(BigInt(debt.paid_minor) * 10000n / BigInt(debt.amount_minor));
          return <article className={`debt-card ${state}`} key={debt.id}><div className="debt-card-heading"><span className="debt-icon"><DebtSymbol icon={debt.icon} /></span><div><h3>{debt.name}</h3><p>{debt.creditor}</p></div><span className={`debt-badge ${state}`}>{state === "paid" && <Check size={13} aria-hidden="true" />}{debtStates[state]}</span></div><div className="debt-amount"><span>Pendiente</span><strong>{formatMoney(left, currency)}</strong><small>de {formatMoney(BigInt(debt.amount_minor), currency)} · pagado {formatMoney(BigInt(debt.paid_minor), currency)}</small></div>
            <progress className="debt-progress" max={10000} value={progressValue} aria-label={`Pagado de ${debt.name}`} />
            <div className={`debt-deadline ${timing}`}><CalendarDays size={16} aria-hidden="true" /><span>{debt.due_date ? `${timing === "overdue" ? "Vencida desde el " : timing === "upcoming" ? "Vence el " : "Vencimiento: "}${date(debt.due_date)}` : "Sin fecha de vencimiento"}</span></div><p className="debt-card-coverage">{state === "paid" ? "Esta deuda ya está cubierta." : available >= left ? `Al pagar quedarían ${formatMoney(available - left, currency)} disponibles.` : `Faltan ${formatMoney(left - available, currency)} para cubrirla hoy.`}</p>
            <div className="debt-card-actions"><button className="button button-secondary" aria-expanded={expanded} aria-controls={`detail-${debt.id}`} onClick={() => setSelected(expanded ? null : debt.id)}>{expanded ? "Cerrar detalle" : "Ver detalle"}</button>{state !== "paid" && <button className="button" disabled={busy || loading || !!error} onClick={() => open(debt, true)}>Registrar pago</button>}</div>
            {expanded && <div className="debt-detail" id={`detail-${debt.id}`}><dl><div><dt>Categoría de deuda</dt><dd>{debt.category ? debtCategories[debt.category] : "Sin categoría"}</dd></div></dl>{debt.detail && <p className="debt-description">{debt.detail}</p>}<div className="debt-detail-actions"><button disabled={busy || loading} onClick={() => open(debt)}>Editar deuda</button><button className="debt-danger" disabled={busy || loading} onClick={() => { if (window.confirm(`¿Eliminar «${debt.name}» de la lista? Sus gastos no se anularán. El registro y sus pagos se conservarán en tu exportación para mantener la trazabilidad.`)) void execute({ action: "delete", id: debt.id, expectedVersion: debt.version }); }}>Eliminar deuda</button></div><h4>Historial de pagos</h4>{!debt.payments.length ? <p>Todavía no registraste pagos.</p> : <ol className="debt-payments">{debt.payments.map((p) => <li key={p.id}><div><strong>{formatMoney(BigInt(p.amount_minor), currency)}</strong><span>{p.active ? "Aplicado" : "Sin efecto en esta deuda"}</span><time dateTime={p.occurred_at}>{new Intl.DateTimeFormat("es-PE", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(p.occurred_at))}</time><p>{p.description}</p>{p.note && <p>{p.note}</p>}</div><button disabled={busy} onClick={() => onMovement(p.effective_id, currency)}>Ver movimiento</button>{p.active && <><button disabled={busy || loading || !!editor || !!payment} onClick={() => { if (window.confirm("¿Desvincular este pago? Volverá a estar pendiente en la deuda. El gasto y el saldo de la cuenta se conservarán.")) void execute({ action: "unlink", id: debt.id, paymentId: p.id }); }}>Desvincular pago</button>{p.created_expense && <button disabled={busy || loading || !!editor || !!payment} className="debt-danger" onClick={() => { if (window.confirm("¿Anular el gasto de este pago? Se revertirá en la cuenta y el importe volverá a estar pendiente. La historia se conservará.")) void execute({ action: "voidpay", id: debt.id, paymentId: p.id }); }}>Anular gasto</button>}</>}</li>)}</ol>}</div>}
          </article>;
        })}</div>{matches.length > visible && <button className="button button-secondary debt-load-more" onClick={() => setVisible((n) => n + 12)}>Mostrar más deudas</button>}</>}
      </section>
    </>}
  </div>;
}
