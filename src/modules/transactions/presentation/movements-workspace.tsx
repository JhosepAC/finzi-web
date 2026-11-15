"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Pencil, Copy, ChevronDown, ChevronLeft, ChevronRight, Plus, RefreshCw, Search, Wallet } from "lucide-react";
import type { Account } from "@/modules/accounts";
import { catalogSchema, type Category } from "@/modules/classification/domain/category";
import { formatMoney, type Currency } from "@/shared/money";
import { periodRange, todayInZone, periodLabels, type Period } from "@/shared/period";
import type { MovementFilters, MovementHistoryState, HistoryCursor } from "../domain/history";
import { monthRange } from "@/shared/time";
import { movementPageSchema, voidMovementSchema, type Movement, type MovementPage, type MovementKind } from "../domain/movement";
import { MovementForm } from "./movement-form";
import { MovementTrace } from "./movement-trace";
import "./movements.css";

type Filters = MovementFilters;
type Cursor = HistoryCursor;
export function MovementsWorkspace({ accounts, preferredCurrency, timezone, now, initialKind, initialState, onStateChange, onChanged, onAccounts, onCategories, setGuard }: { accounts: Account[]; preferredCurrency: Currency; timezone: string; now: string; initialKind: "income" | "expense" | null; initialState?: MovementHistoryState | null; onStateChange?: (state: MovementHistoryState) => void; onChanged: () => Promise<boolean>; onAccounts: () => void; onCategories: () => void; setGuard: (guard: () => boolean) => void }) {
  const defaults: Filters = { currency: preferredCurrency, kind: "", accountId: "", categoryId: "", period: "month", ...monthRange(now, timezone), query: "", status: "all" };
  const [filters, setFilters] = useState(initialState?.filters ?? defaults);
  const [draftFilters, setDraftFilters] = useState(initialState?.draftFilters ?? defaults);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [contextError, setContextError] = useState(false);
  const [contextRevision, setContextRevision] = useState(0);
  const [page, setPage] = useState<MovementPage | null>(null);
  const [loadedUrl, setLoadedUrl] = useState("");
  const [cursor, setCursor] = useState<Cursor>(initialState?.cursor ?? null);
  const [previous, setPrevious] = useState<Cursor[]>(initialState?.previous ?? []);
  const [revision, setRevision] = useState(0);
  const [settledRequest, setSettledRequest] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(initialKind !== null);
  const [entryKind, setEntryKind] = useState<MovementKind>(initialKind ?? "expense");
  const [replacing, setReplacing] = useState<Movement | null>(null);
  const [traceId, setTraceId] = useState<string | null>(initialState?.traceId ?? null);
  const [duplicating, setDuplicating] = useState<Movement | null>(null);
  const [entrySession, setEntrySession] = useState(0);
  const [voiding, setVoiding] = useState<(Movement & { surface: "history" | "trace" }) | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const historyTitle = useRef<HTMLHeadingElement>(null);
  const formStart = useRef<HTMLDivElement>(null);
  useEffect(() => { onStateChange?.({ filters,draftFilters,cursor,previous,traceId }); },[filters,draftFilters,cursor,previous,traceId,onStateChange]);
  const onDirty = useCallback((value: boolean, saving: boolean) => { setDirty(value); setPending(saving); }, []);
  useEffect(() => {
    setGuard(() => pending || preparing ? false : !dirty || window.confirm("Tienes un registro sin confirmar. ¿Quieres salir y descartar el formulario?"));
    const unload = (event: BeforeUnloadEvent) => { if (dirty || pending || preparing) event.preventDefault(); };
    window.addEventListener("beforeunload", unload);
    return () => { setGuard(() => true); window.removeEventListener("beforeunload", unload); };
  }, [dirty, pending, preparing, setGuard]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/categories", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(); return catalogSchema.parse(data).categories; })
      .then((data) => { if (!controller.signal.aborted) { setCategories(data); setContextError(false); } }).catch(() => { if (!controller.signal.aborted) setContextError(true); });
    return () => controller.abort();
  }, [contextRevision]);
  const params = new URLSearchParams({ currency: filters.currency, status: filters.status });
  for (const key of ["kind", "accountId", "categoryId", "query"] as const) if (filters[key]) params.set(key, filters[key]);
  if (filters.period !== "all") { if (filters.from) params.set("from", filters.from); if (filters.to) params.set("to", filters.to); }
  if (cursor) { params.set("cursorAt", cursor.at); params.set("cursorId", cursor.id); }
  const url = `/api/v1/movements?${params}`;
  const requestKey = `${url}#${revision}`;
  const loading = requestKey !== settledRequest;
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "No pudimos cargar los movimientos."); return movementPageSchema.parse(data); })
      .then((data) => { if (!controller.signal.aborted) { setPage(data); setLoadedUrl(url); setError(""); } })
      .catch(() => { if (!controller.signal.aborted) setError("No pudimos cargar esta consulta. Reintenta para actualizar los movimientos."); })
      .finally(() => { if (!controller.signal.aborted) setSettledRequest(requestKey); });
    return () => controller.abort();
  }, [url, requestKey]);
  const visible = page && loadedUrl === url ? page : null;
  const activeAccounts = accounts.filter((a) => a.status === "active");
  const date = (value: string) => new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draftFilters.period === "custom" && (!draftFilters.from || !draftFilters.to || draftFilters.from > draftFilters.to)) { setError("Elige un intervalo válido: la fecha inicial debe ser anterior o igual a la final."); return; }
    const next = draftFilters.period !== "all" && draftFilters.period !== "custom" ? { ...draftFilters, ...periodRange(draftFilters.period as Exclude<Period,"custom">,todayInZone(new Date().toISOString(),timezone)) } : draftFilters;
    setFilters(next); setCursor(null); setPrevious([]); setRevision((v) => v + 1);
  }
  async function saved(kind: MovementKind, currency: Currency, alreadyVoid: boolean) {
    await onChanged();
    setOpen(false); setDirty(false); setPending(false);
    const next = { ...defaults, currency, period: "all" }; setFilters(next); setDraftFilters(next); setCursor(null); setPrevious([]); setRevision((v) => v + 1);
    setMessage(replacing ? (alreadyVoid ? "Esta edición ya estaba confirmada y dejó de estar vigente. Consulta su trazabilidad." : "Edición guardada. El registro anterior se conserva como reemplazado.") : alreadyVoid ? "Este registro ya estaba confirmado y archivado. Se conservó su historial." : kind === "transfer" ? "Transferencia guardada." : kind === "income" ? "Ingreso guardado." : "Gasto guardado.");
    setReplacing(null); setDuplicating(null);
    requestAnimationFrame(() => historyTitle.current?.focus({ preventScroll: true }));
  }
  async function start(kind: MovementKind, original: Movement | null = null, mode: "replace" | "duplicate" = "replace") {
    if (preparing || pending || (dirty && !window.confirm("Tienes un registro sin confirmar. ¿Quieres descartarlo?"))) return;
    setPreparing(true);
    try { if (!await onChanged()) return;
    setReplacing(mode === "replace" ? original : null); setDuplicating(mode === "duplicate" ? original : null); setEntryKind(kind); setEntrySession((v) => v + 1); setOpen(true); setTraceId(null);
    requestAnimationFrame(() => { formStart.current?.scrollIntoView({ behavior: "instant", block: "start" }); formStart.current?.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true }); });
    } finally { setPreparing(false); }
  }
  function actions(movement: Movement, surface: "history" | "trace" = "history") {
    if (voiding?.id === movement.id && voiding.surface === surface) return <VoidForm movement={voiding} onDirty={onDirty} onCancel={() => setVoiding(null)} onSaved={async () => { await onChanged(); setVoiding(null); setDirty(false); setPending(false); setMessage("Movimiento archivado. Se conserva en el historial."); setRevision((v) => v + 1); }} />;
    const blocked = preparing || open || Boolean(voiding), unavailable = !activeAccounts.length || ((!categories || contextError) && movement.kind !== "transfer");
    return <div className="ledger-record-actions">{movement.status === "posted" && <><button className="home-text-button" disabled={blocked || unavailable} onClick={() => start(movement.kind,movement)}><Pencil size={16} aria-hidden="true" />Editar movimiento</button><button className="home-text-button" disabled={blocked} onClick={() => setVoiding({ ...movement,surface })}>Archivar movimiento</button></>}<button className="home-text-button" disabled={blocked || unavailable} onClick={() => start(movement.kind,movement,"duplicate")}><Copy size={16} aria-hidden="true" />Duplicar movimiento</button></div>;
  }
  return <div className="ledger-workspace">
    <div className="ledger-toolbar"><p>Ingresos, gastos y transferencias reales</p><button className="home-text-button" disabled={loading || pending || preparing} onClick={() => { setRevision((v) => v + 1); setContextRevision((v) => v + 1); void onChanged(); }}><RefreshCw size={16} aria-hidden="true" />Actualizar movimientos</button>{!open && <><button className="button button-secondary ledger-transfer-button" disabled={preparing || Boolean(voiding) || !activeAccounts.length} onClick={() => start("transfer")}><ArrowLeftRight size={18} aria-hidden="true" />Transferir</button><button className="home-primary-button" disabled={preparing || Boolean(voiding) || !categories || contextError || !activeAccounts.length} onClick={() => start("expense")}><Plus size={18} aria-hidden="true" />Registrar movimiento</button></>}</div>
    {!activeAccounts.length && <div className="ledger-prerequisite"><Wallet size={25} aria-hidden="true" /><div><h2>Necesitas una cuenta activa.</h2><p>Crea una cuenta con su saldo inicial para registrar ingresos y gastos.</p></div><button className="home-text-button" onClick={onAccounts}>Ir a Cuentas</button></div>}
    {contextError ? <div className="ledger-error" role="alert">No pudimos cargar las categorías. <button className="home-text-button" onClick={() => setContextRevision((v) => v + 1)}>Actualizar categorías</button></div> : categories && !categories.some((c) => !c.effective_archived) && <div className="ledger-prerequisite"><div><h2>Organiza tus categorías antes de registrar.</h2><p>Para ingresos y gastos necesitas una categoría activa del mismo tipo. Las transferencias no usan categoría.</p></div><button className="home-text-button" onClick={onCategories}>Ir a Categorías</button></div>}
    <div ref={formStart}>{open && (categories || entryKind === "transfer") && activeAccounts.length > 0 && <MovementForm key={entrySession} accounts={accounts} categories={categories ?? []} initialKind={entryKind} replacing={replacing} duplicating={duplicating} timezone={timezone} onDirty={onDirty} onCancel={() => { setOpen(false); setReplacing(null); setDuplicating(null); setDirty(false); setPending(false); }} onSave={saved} />}</div>
    {traceId && <MovementTrace id={traceId} revision={revision} timezone={timezone} locked={open || Boolean(voiding) || pending} onOpen={setTraceId} onClose={() => setTraceId(null)} actions={(movement) => actions(movement, "trace")} />}
    <section className="home-panel ledger-history" aria-labelledby="ledger-history-title"><div className="ledger-history-heading"><h2 ref={historyTitle} tabIndex={-1} id="ledger-history-title">Historial de movimientos</h2><span>{visible ? `${visible.total_count} ${visible.total_count === 1 ? "registro" : "registros"}` : ""}</span></div>
      <form className="ledger-filters" onSubmit={apply} action="/dashboard" method="post"><fieldset className="ledger-filter-fields" disabled={Boolean(voiding) || pending}><div className="field"><label htmlFor="filter-currency">Moneda</label><select id="filter-currency" value={draftFilters.currency} onChange={(e) => setDraftFilters({ ...draftFilters, currency: e.target.value as Currency, accountId: "" })}><option value="PEN">Soles · PEN</option><option value="USD">Dólares · USD</option></select></div><div className="field"><label htmlFor="filter-kind">Tipo</label><select id="filter-kind" value={draftFilters.kind} onChange={(e) => setDraftFilters({ ...draftFilters, kind: e.target.value, categoryId: "" })}><option value="">Todos los tipos</option><option value="income">Ingresos</option><option value="expense">Gastos</option><option value="transfer">Transferencias</option></select></div><div className="field"><label htmlFor="filter-period">Período</label><select id="filter-period" value={draftFilters.period} onChange={(e) => setDraftFilters({ ...draftFilters, period: e.target.value })}>{Object.entries(periodLabels).filter(([key]) => key !== "custom").map(([key,label]) => <option value={key} key={key}>{label} actual</option>)}<option value="all">Todo el historial</option><option value="custom">Personalizado</option></select></div><div className="field"><label htmlFor="filter-account">Cuenta</label><select id="filter-account" value={draftFilters.accountId} onChange={(e) => setDraftFilters({ ...draftFilters, accountId: e.target.value })}><option value="">Todas las cuentas</option>{accounts.filter((a) => a.currency_code === draftFilters.currency).map((a) => <option key={a.id} value={a.id}>{a.name}{a.status === "archived" ? " (archivada)" : ""}</option>)}</select></div>
        <details className="ledger-more-filters"><summary>Más filtros</summary><div className="ledger-filter-extra"><div className="field"><label htmlFor="filter-category">Categoría</label><select id="filter-category" value={draftFilters.categoryId} disabled={draftFilters.kind === "transfer"} onChange={(e) => setDraftFilters({ ...draftFilters, categoryId: e.target.value })}><option value="">Todas las categorías</option>{categories?.filter((c) => !draftFilters.kind || c.kind === draftFilters.kind).map((c) => <option key={c.id} value={c.id}>{c.parent_id ? `${categories.find((p) => p.id === c.parent_id)?.name} / ` : ""}{c.name}{c.effective_archived ? " (archivada)" : ""}</option>)}</select><small>El padre incluye sus subcategorías.</small></div><div className="field"><label htmlFor="filter-status">Estado</label><select id="filter-status" value={draftFilters.status} onChange={(e) => setDraftFilters({ ...draftFilters, status: e.target.value })}><option value="all">Todos los estados</option><option value="posted">Vigentes</option><option value="void">Archivados y reemplazados</option><option value="replaced">Reemplazados</option></select></div></div></details>
        {draftFilters.period === "custom" && <div className="ledger-filter-extra ledger-wide"><div className="field"><label htmlFor="filter-from">Desde</label><input id="filter-from" type="date" value={draftFilters.from} onChange={(e) => setDraftFilters({ ...draftFilters, from: e.target.value })} /></div><div className="field"><label htmlFor="filter-to">Hasta</label><input id="filter-to" type="date" value={draftFilters.to} onChange={(e) => setDraftFilters({ ...draftFilters, to: e.target.value })} /></div></div>}
        <div className="field ledger-search"><label htmlFor="filter-query">Buscar movimientos</label><div><Search size={18} aria-hidden="true" /><input id="filter-query" type="search" value={draftFilters.query} maxLength={200} onChange={(e) => setDraftFilters({ ...draftFilters, query: e.target.value })} /></div></div><button className="button button-secondary ledger-apply" type="submit">Aplicar filtros</button><button className="home-text-button ledger-clear" type="button" onClick={() => { const clean = { ...defaults,currency: filters.currency,period: "all" }; setFilters(clean); setDraftFilters(clean); setCursor(null); setPrevious([]); setError(""); }}>Limpiar filtros</button></fieldset>
      </form>
      {visible && <div className="ledger-totals" aria-label="Totales de los filtros aplicados"><div><span>Ingresos</span><strong className="income">{formatMoney(BigInt(visible.income_minor), visible.currency_code)}</strong></div><div><span>Gastos</span><strong className="expense">{formatMoney(BigInt(visible.expense_minor), visible.currency_code)}</strong></div><div><span>Flujo neto</span><strong>{formatMoney(BigInt(visible.income_minor) - BigInt(visible.expense_minor), visible.currency_code)}</strong></div><p>Solo registros vigentes. Aperturas y transferencias quedan fuera de ingresos y gastos. El flujo neto puede diferir del cambio de saldo de una cuenta.</p></div>}
      <div className="ledger-feedback" role="status" aria-live="polite">{message}</div>
      {error && !loading && <div className="ledger-error" role="alert">{error}{visible && " Se muestran los últimos datos cargados para estos filtros."}</div>}
      {loading && !visible ? <div className="ledger-skeleton" aria-label="Cargando movimientos"><div /><div /><div /></div> : visible?.movements.length ? <div className="ledger-rows">{visible.movements.map((movement) => <details className={`ledger-record ${movement.status}`} key={movement.id}><summary><span className={`ledger-kind-icon ${movement.kind}`} aria-hidden="true">{movement.kind === "transfer" ? <ArrowLeftRight size={19} /> : movement.kind === "income" ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}</span><span className="ledger-record-name"><strong>{movement.description}</strong><small>{movement.account_name}{movement.kind === "transfer" ? ` → ${movement.destination_name}` : ` · ${movement.parent_name ? `${movement.parent_name} / ` : ""}${movement.category_name}`}</small></span><time dateTime={movement.occurred_at}>{date(movement.occurred_at)}</time><span className="ledger-record-amount"><strong className={movement.kind}>{movement.kind === "transfer" ? "" : movement.kind === "income" ? "+" : "−"}{formatMoney(BigInt(movement.amount_minor), movement.currency_code)}</strong><small>{movement.replaced_by_id ? "Reemplazado" : movement.status === "void" ? "Archivado" : movement.kind === "transfer" ? "Transferencia" : movement.kind === "income" ? "Ingreso" : "Gasto"}</small></span><ChevronDown size={16} className="ledger-chevron" aria-hidden="true" /></summary><div className="ledger-record-detail">{movement.note && <p className="ledger-record-note">{movement.note}</p>}{movement.status === "void" ? <p><strong>{movement.replaced_by_id ? "Motivo de la edición:" : "Motivo de archivado:"}</strong> {movement.void_reason}</p> : null}{actions(movement)}{movement.replaces_id && <p>Este registro reemplaza uno anterior. Motivo: {movement.replacement_reason}</p>}{movement.kind === "transfer" && <p>Sale de {movement.account_name} y entra a {movement.destination_name}. No se cuenta como ingreso ni gasto.</p>}<button className="home-text-button" disabled={preparing || open || Boolean(voiding)} onClick={() => { setTraceId(movement.id); requestAnimationFrame(() => document.getElementById("trace-title")?.scrollIntoView({ behavior: "instant", block: "start" })); }}>Ver trazabilidad</button></div></details>)}</div> : !error && !loading && <div className="ledger-empty"><h3>{filters.period === "all" && !filters.query && !filters.kind && !filters.accountId && !filters.categoryId && filters.status === "all" ? `Aún no has registrado movimientos en ${filters.currency}.` : "No hay movimientos con estos filtros."}</h3><p>Registra un ingreso, gasto o transferencia, o limpia los filtros para consultar tu historial.</p></div>}
      {visible && <div className="ledger-pagination"><button className="home-text-button" disabled={loading || Boolean(voiding) || !previous.length} onClick={() => { setCursor(previous[previous.length - 1]); setPrevious((all) => all.slice(0, -1)); }}><ChevronLeft size={17} aria-hidden="true" />Anterior</button><span>Página {previous.length + 1}</span><button className="home-text-button" disabled={loading || Boolean(voiding) || !visible.has_more} onClick={() => { setPrevious((all) => [...all, cursor]); setCursor(visible.next_cursor); }}>Siguiente<ChevronRight size={17} aria-hidden="true" /></button></div>}
    </section>
  </div>;
}

function VoidForm({ movement, onDirty, onSaved, onCancel }: { movement: Movement; onDirty: (dirty: boolean, pending: boolean) => void; onSaved: () => Promise<void>; onCancel: () => void }) {
  const [reason, setReason] = useState(""); const [pending, setPending] = useState(false); const [message, setMessage] = useState("");
  const reasonInput = useRef<HTMLInputElement>(null);
  useEffect(() => { reasonInput.current?.focus(); }, []);
  useEffect(() => { onDirty(Boolean(reason), pending); return () => onDirty(false, false); }, [reason, pending, onDirty]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const parsed = voidMovementSchema.safeParse({ id: movement.id, expectedVersion: movement.version, reason });
    if (!parsed.success) { setMessage("Escribe el motivo de archivado, hasta 300 caracteres."); reasonInput.current?.focus(); return; }
    setPending(true); setMessage("");
    try {
      const response = await fetch("/api/v1/movements", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), signal: AbortSignal.timeout(15000) }); const body = await response.json();
      if (response.ok && body.ok) { await onSaved(); return; }
      setMessage(body.message ?? "No pudimos confirmar el archivado. Puedes reintentar.");
    } catch { setMessage("No pudimos confirmar el resultado. Reintenta el archivado; no se repetirá su efecto."); }
    finally { setPending(false); }
  }
  return <form className="ledger-void-form" action="/api/v1/movements" method="post" onSubmit={submit} noValidate aria-busy={pending}><h3>Archivar este movimiento</h3><p>{movement.kind === "transfer" ? "Se retirará su efecto de ambas cuentas al mismo tiempo. No se cambia el saldo total." : "Dejará de afectar el saldo y los indicadores."} Se conservará en el historial.</p><div className="field"><label htmlFor={`void-${movement.id}`}>Motivo de archivado</label><input ref={reasonInput} id={`void-${movement.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} disabled={pending} aria-describedby={`void-error-${movement.id}`} aria-invalid={Boolean(message)} /></div><div id={`void-error-${movement.id}`} className="ledger-feedback" role="alert">{message}</div><div className="ledger-entry-actions"><button className="button button-secondary" type="button" onClick={onCancel} disabled={pending}>Conservar movimiento</button><button className="button button-primary" type="submit" disabled={pending}>{pending ? "Archivando…" : "Confirmar archivado"}</button></div></form>;
}
