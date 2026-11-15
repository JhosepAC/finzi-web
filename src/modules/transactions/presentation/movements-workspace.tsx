"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Pencil, Copy, ChevronDown, ChevronLeft, ChevronRight, Plus, Archive, Trash2, Search, Wallet, SlidersHorizontal, RotateCcw, CalendarDays } from "lucide-react";
import type { Account } from "@/modules/accounts";
import { CategorySymbol } from "@/modules/classification";
import { catalogSchema, type Category } from "@/modules/classification/domain/category";
import { formatMoney, type Currency } from "@/shared/money";
import { periodRange, todayInZone, periodLabels, type Period } from "@/shared/period";
import type { MovementFilters, MovementHistoryState, HistoryCursor } from "../domain/history";
import { monthRange } from "@/shared/time";
import { movementPageSchema, type Movement, type MovementPage, type MovementKind } from "../domain/movement";
import { MovementForm } from "./movement-form";
import { Toast } from "@/shared/ui";
import { MovementRemovalForm } from "./movement-removal-form";
import { MovementTrace } from "./movement-trace";
import "./movements.css";

type Filters = MovementFilters;
type Cursor = HistoryCursor;
const invalidRange = (filters: Filters) => filters.period === "custom" && (!filters.from || !filters.to || filters.from > filters.to);
const rangeError = "Elige un intervalo válido. Se mantienen los resultados del último intervalo aplicado.";
export function MovementsWorkspace({ accounts, preferredCurrency, timezone, now, initialKind, initialState, onStateChange, onChanged, onAccounts, onCategories, setGuard }: { accounts: Account[]; preferredCurrency: Currency; timezone: string; now: string; initialKind: "income" | "expense" | null; initialState?: MovementHistoryState | null; onStateChange?: (state: MovementHistoryState) => void; onChanged: () => Promise<boolean>; onAccounts: () => void; onCategories: () => void; setGuard: (guard: () => boolean) => void }) {
  const defaults: Filters = { currency: preferredCurrency, kind: "", accountId: "", categoryId: "", period: "month", ...monthRange(now, timezone), query: "", status: "all" };
  const restored = initialState?.draftFilters ?? initialState?.filters ?? defaults;
  const unapplied = !invalidRange(restored) && initialState && JSON.stringify(restored) !== JSON.stringify(initialState.filters);
  const [filters, setFilters] = useState(invalidRange(restored) ? initialState?.filters ?? defaults : restored);
  const [draftFilters, setDraftFilters] = useState(restored);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [contextError, setContextError] = useState(false);
  const [contextRevision, setContextRevision] = useState(0);
  const [page, setPage] = useState<MovementPage | null>(null);
  const [loadedUrl, setLoadedUrl] = useState("");
  const [cursor, setCursor] = useState<Cursor>(unapplied ? null : initialState?.cursor ?? null);
  const [previous, setPrevious] = useState<Cursor[]>(unapplied ? [] : initialState?.previous ?? []);
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
  const [removal, setRemoval] = useState<{ movement: Movement; mode: "archive" | "delete" } | null>(null);
  const [filterError, setFilterError] = useState(invalidRange(restored) ? rangeError : "");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const historyTitle = useRef<HTMLHeadingElement>(null);
  const entryDialog = useRef<HTMLDialogElement>(null);
  const removalDialog = useRef<HTMLDialogElement>(null);
  const traceDialog = useRef<HTMLDialogElement>(null);
  const traceOpener = useRef<HTMLElement | null>(null);
  const entryOpener = useRef<HTMLElement | null>(null);
  const removalOpener = useRef<HTMLElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);
  useEffect(() => {
    if (open && entryDialog.current?.querySelector(".ledger-entry") && !entryDialog.current.open) entryDialog.current.showModal();
  }, [open, categories, accounts, entryKind]);
  useEffect(() => { if (removal && !removalDialog.current?.open) removalDialog.current?.showModal(); }, [removal]);
  useEffect(() => {
    if (traceId && !open && !removal) { if (!traceDialog.current?.open) traceDialog.current?.showModal(); }
    else traceDialog.current?.close();
  }, [traceId, open, removal]);
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
  const date = (value: string) => new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeZone: timezone }).format(new Date(value));
  const time = (value: string) => new Intl.DateTimeFormat("es-PE", { timeStyle: "short", timeZone: timezone }).format(new Date(value));
  const extraFilterCount = Number(Boolean(draftFilters.categoryId)) + Number(draftFilters.status !== "all");
  function updateFilters(next: Filters, debounce = false) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (next.period !== "all" && next.period !== "custom") next = { ...next, ...periodRange(next.period as Exclude<Period, "custom">, todayInZone(new Date().toISOString(), timezone)) };
    setDraftFilters(next);
    if (invalidRange(next)) {
      setFilterError(rangeError); return;
    }
    setFilterError("");
    const commit = () => { setFilters(next); setCursor(null); setPrevious([]); };
    if (debounce) searchTimer.current = setTimeout(commit, 300); else commit();
  }
  function closeEntry() {
    entryDialog.current?.close(); setOpen(false); setReplacing(null); setDuplicating(null); setDirty(false); setPending(false);
    requestAnimationFrame(() => { if (entryOpener.current?.isConnected) entryOpener.current.focus({ preventScroll: true }); });
  }
  function showTrace(id: string) {
    traceOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTraceId(id);
  }
  function closeTrace() {
    traceDialog.current?.close(); setTraceId(null);
    requestAnimationFrame(() => { (traceOpener.current?.isConnected ? traceOpener.current : historyTitle.current)?.focus({ preventScroll: true }); });
  }
  function closeRemoval() {
    removalDialog.current?.close(); setRemoval(null); setDirty(false); setPending(false);
    requestAnimationFrame(() => { if (removalOpener.current?.isConnected) removalOpener.current.focus({ preventScroll: true }); });
  }
  function startRemoval(movement: Movement, mode: "archive" | "delete") {
    removalOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRemoval({ movement, mode });
  }
  async function saved(kind: MovementKind, currency: Currency, alreadyVoid: boolean) {
    await onChanged();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    entryOpener.current = null;
    entryDialog.current?.close(); setOpen(false); setDirty(false); setPending(false);
    setFilterError("");
    const next = { ...defaults, currency, period: "all" }; setFilters(next); setDraftFilters(next); setCursor(null); setPrevious([]); setRevision((v) => v + 1);
    setMessage(replacing ? (alreadyVoid ? "Esta edición ya estaba confirmada y dejó de estar vigente. Consulta su trazabilidad." : "Edición guardada. El registro anterior se conserva como reemplazado.") : alreadyVoid ? "Este registro ya estaba confirmado y archivado. Se conservó su historial." : kind === "transfer" ? "Transferencia guardada." : kind === "income" ? "Ingreso guardado." : "Gasto guardado.");
    setReplacing(null); setDuplicating(null);
    requestAnimationFrame(() => historyTitle.current?.focus({ preventScroll: true }));
  }
  async function start(kind: MovementKind, original: Movement | null = null, mode: "replace" | "duplicate" = "replace") {
    if (preparing || pending || (dirty && !window.confirm("Tienes un registro sin confirmar. ¿Quieres descartarlo?"))) return;
    entryOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPreparing(true);
    try { if (!await onChanged()) return;
    setReplacing(mode === "replace" ? original : null); setDuplicating(mode === "duplicate" ? original : null); setEntryKind(kind); setEntrySession((v) => v + 1); setOpen(true); setTraceId(null);
    } finally { setPreparing(false); }
  }
  function actions(movement: Movement) {
    if (movement.deleted_at) return null;
    const blocked = preparing || open || Boolean(removal);
    const unavailable = !activeAccounts.length || ((!categories || contextError) && movement.kind !== "transfer");
    return <div className="ledger-record-actions">
      {movement.status === "posted" && <><button className="home-text-button" disabled={blocked || unavailable} onClick={() => start(movement.kind, movement)}><Pencil size={16} aria-hidden="true" />Editar movimiento</button><button className="home-text-button" disabled={blocked} onClick={() => startRemoval(movement, "archive")}><Archive size={16} aria-hidden="true" />Archivar movimiento</button></>}
      <button className="home-text-button" disabled={blocked || unavailable} onClick={() => start(movement.kind, movement, "duplicate")}><Copy size={16} aria-hidden="true" />Duplicar movimiento</button>
      <button className="home-text-button ledger-delete-trigger" disabled={blocked} onClick={() => startRemoval(movement, "delete")}><Trash2 size={16} aria-hidden="true" />Eliminar movimiento</button>
    </div>;
  }
  return <div className="ledger-workspace">
    <Toast message={message} onClose={() => setMessage("")} />
    <div className="ledger-toolbar"><div className="ledger-currency"><label htmlFor="filter-currency">Moneda</label><select id="filter-currency" value={draftFilters.currency} disabled={Boolean(removal) || pending} onChange={(event) => updateFilters({ ...draftFilters, currency: event.target.value as Currency, accountId: "" })}><option value="PEN">PEN · Soles</option><option value="USD">USD · Dólares</option></select></div><button className="button button-secondary ledger-transfer-button" disabled={preparing || Boolean(removal) || !activeAccounts.length} onClick={() => start("transfer")}><ArrowLeftRight size={17} aria-hidden="true" />Transferir</button><button className="home-primary-button" disabled={preparing || Boolean(removal) || !categories || contextError || !activeAccounts.length} onClick={() => start("expense")}><Plus size={18} aria-hidden="true" />{preparing ? "Preparando…" : "Registrar movimiento"}</button></div>
    {!activeAccounts.length && <div className="ledger-prerequisite"><Wallet size={25} aria-hidden="true" /><div><h2>Necesitas una cuenta activa.</h2><p>Crea una cuenta con su saldo inicial para registrar ingresos y gastos.</p></div><button className="home-text-button" onClick={onAccounts}>Ir a Cuentas</button></div>}
    {contextError ? <div className="ledger-error" role="alert">No pudimos cargar las categorías. <button className="home-text-button" onClick={() => setContextRevision((v) => v + 1)}>Reintentar categorías</button></div> : categories && !categories.some((c) => !c.effective_archived) && <div className="ledger-prerequisite"><div><h2>Organiza tus categorías antes de registrar.</h2><p>Para ingresos y gastos necesitas una categoría activa del mismo tipo. Las transferencias no usan categoría.</p></div><button className="home-text-button" onClick={onCategories}>Ir a Categorías</button></div>}
    <dialog ref={entryDialog} className="finzi-dialog ledger-dialog" aria-labelledby="movement-form-title" onCancel={(event) => { event.preventDefault(); if (!pending && (!dirty || window.confirm("Tienes un registro sin confirmar. ¿Quieres descartarlo?"))) closeEntry(); }} onClose={closeEntry}>
      {open && (categories || entryKind === "transfer") && activeAccounts.length > 0 && <MovementForm key={entrySession} accounts={accounts} categories={categories ?? []} initialKind={entryKind} replacing={replacing} duplicating={duplicating} timezone={timezone} onDirty={onDirty} onCancel={closeEntry} onSave={saved} />}
    </dialog>
    <dialog ref={removalDialog} className="finzi-dialog ledger-remove-dialog" aria-labelledby="movement-removal-title" aria-describedby="movement-removal-copy" onCancel={(event) => { event.preventDefault(); if (!pending && (!dirty || window.confirm("¿Quieres descartar el motivo sin confirmar la operación?"))) closeRemoval(); }} onClose={closeRemoval}>
      {removal && <MovementRemovalForm key={`${removal.movement.id}-${removal.mode}`} movement={removal.movement} mode={removal.mode} onDirty={onDirty} onCancel={closeRemoval} onReload={() => { closeRemoval(); setRevision((value) => value + 1); void onChanged(); }} onSaved={async () => {
        const deleting = removal.mode === "delete";
        await onChanged(); removalOpener.current = null; closeRemoval(); setMessage(deleting ? "Movimiento eliminado." : "Movimiento archivado. Se conserva en el historial."); setCursor(null); setPrevious([]); setRevision((v) => v + 1);
        requestAnimationFrame(() => historyTitle.current?.focus({ preventScroll: true }));
      }} />}
    </dialog>
    {visible && <section className="ledger-totals" aria-label="Totales de los filtros aplicados"><div><span><ArrowDownLeft size={15} aria-hidden="true" />Ingresos</span><strong className="income">{formatMoney(BigInt(visible.income_minor), visible.currency_code)}</strong></div><div><span><ArrowUpRight size={15} aria-hidden="true" />Gastos</span><strong className="expense">{formatMoney(BigInt(visible.expense_minor), visible.currency_code)}</strong></div><div><span><ArrowLeftRight size={15} aria-hidden="true" />Flujo neto</span><strong>{formatMoney(BigInt(visible.income_minor) - BigInt(visible.expense_minor), visible.currency_code)}</strong></div><p>Totales de los filtros aplicados en {visible.currency_code}. Solo movimientos vigentes; las aperturas y transferencias quedan fuera.</p></section>}
    <section className="home-panel ledger-filter-panel" aria-label="Filtrar movimientos">
      <form className="ledger-filters" onSubmit={(event) => event.preventDefault()} action="/dashboard" method="post">
        <fieldset className="ledger-filter-fields" disabled={Boolean(removal) || pending}>
          <div className="ledger-type-filter" role="group" aria-label="Tipo de movimiento">{([["", "Todos"], ["income", "Ingresos"], ["expense", "Gastos"], ["transfer", "Transferencias"]] as const).map(([kind, label]) => <button key={kind} type="button" aria-pressed={draftFilters.kind === kind} onClick={() => updateFilters({ ...draftFilters, kind, categoryId: "" })}>{label}</button>)}</div>
          <div className="field ledger-search"><label className="sr-only" htmlFor="filter-query">Buscar movimientos</label><div><Search size={17} aria-hidden="true" /><input id="filter-query" type="search" placeholder="Buscar descripción o nota" value={draftFilters.query} maxLength={200} onChange={(event) => updateFilters({ ...draftFilters, query: event.target.value }, true)} /></div></div>
          <div className="field ledger-period-filter"><label htmlFor="filter-period"><CalendarDays size={15} aria-hidden="true" />Período</label><select id="filter-period" value={draftFilters.period} onChange={(event) => updateFilters({ ...draftFilters, period: event.target.value })}>{Object.entries(periodLabels).filter(([key]) => key !== "custom").map(([key, label]) => <option value={key} key={key}>{label} actual</option>)}<option value="all">Todo</option><option value="custom">Personalizado</option></select></div>
          <div className="field ledger-account-filter"><label htmlFor="filter-account"><Wallet size={15} aria-hidden="true" />Cuenta</label><select id="filter-account" value={draftFilters.accountId} onChange={(event) => updateFilters({ ...draftFilters, accountId: event.target.value })}><option value="">Todas</option>{accounts.filter((account) => account.currency_code === draftFilters.currency).map((account) => <option key={account.id} value={account.id}>{account.name}{account.status === "archived" ? " (archivada)" : ""}</option>)}</select></div>
          <details className="ledger-more-filters"><summary><SlidersHorizontal size={15} aria-hidden="true" /><span>Más filtros</span>{extraFilterCount > 0 && <span className="ledger-filter-count" aria-label={`${extraFilterCount} activos`}>{extraFilterCount}</span>}<ChevronDown size={14} aria-hidden="true" /></summary><div className="ledger-filter-extra">
            <div className="field"><label htmlFor="filter-category">Categoría</label><select id="filter-category" value={draftFilters.categoryId} disabled={draftFilters.kind === "transfer"} onChange={(event) => updateFilters({ ...draftFilters, categoryId: event.target.value })}><option value="">Todas las categorías</option>{categories?.filter((category) => !draftFilters.kind || category.kind === draftFilters.kind).map((category) => <option key={category.id} value={category.id}>{category.parent_id ? `${categories.find((parent) => parent.id === category.parent_id)?.name} / ` : ""}{category.name}{category.effective_archived ? " (archivada)" : ""}</option>)}</select></div>
            <div className="field"><label htmlFor="filter-status">Estado</label><select id="filter-status" value={draftFilters.status} onChange={(event) => updateFilters({ ...draftFilters, status: event.target.value })}><option value="all">Todos los estados</option><option value="posted">Vigentes</option><option value="void">Archivados y reemplazados</option><option value="replaced">Reemplazados</option></select></div>
          </div></details>
          <button className="home-text-button ledger-clear" type="button" onClick={() => { updateFilters({ ...defaults, currency: filters.currency, period: "all" }); setError(""); }}><RotateCcw size={14} aria-hidden="true" />Limpiar filtros</button>
          {draftFilters.period === "custom" && <div className="ledger-filter-extra ledger-wide"><div className="field"><label htmlFor="filter-from">Desde</label><input id="filter-from" type="date" value={draftFilters.from} onChange={(event) => updateFilters({ ...draftFilters, from: event.target.value })} /></div><div className="field"><label htmlFor="filter-to">Hasta</label><input id="filter-to" type="date" value={draftFilters.to} onChange={(event) => updateFilters({ ...draftFilters, to: event.target.value })} /></div></div>}
        </fieldset>
      </form>
      {filterError && <p className="ledger-filter-error" role="alert">{filterError}</p>}
      {extraFilterCount > 0 && <p className="ledger-active-filters">{draftFilters.categoryId && <span>Categoría: {categories?.find((c) => c.id === draftFilters.categoryId)?.name ?? "seleccionada"}</span>}{draftFilters.status !== "all" && <span>Estado: {draftFilters.status === "posted" ? "Vigentes" : draftFilters.status === "replaced" ? "Reemplazados" : "Archivados y reemplazados"}</span>}</p>}
    </section>
    <dialog ref={traceDialog} className="finzi-dialog ledger-trace-dialog" aria-labelledby="trace-title" onCancel={(event) => { event.preventDefault(); if (!pending && !preparing) closeTrace(); }}>
      {traceId && <MovementTrace id={traceId} revision={revision} timezone={timezone} locked={open || Boolean(removal) || pending || preparing} onOpen={setTraceId} onClose={closeTrace} actions={actions} />}
    </dialog>
    <section className="home-panel ledger-history" aria-labelledby="ledger-history-title" aria-busy={loading}>
      <div className="ledger-history-heading"><h2 ref={historyTitle} tabIndex={-1} id="ledger-history-title">Historial de movimientos</h2><span role="status">{loading ? "Actualizando…" : visible ? `${visible.total_count} ${visible.total_count === 1 ? "registro" : "registros"}` : ""}</span></div>
      {error && !loading && <div className="ledger-error" role="alert">{error}{visible && " Se muestran los últimos datos cargados para estos filtros."}<button className="home-text-button" onClick={() => setRevision((value) => value + 1)}>Reintentar consulta</button></div>}
      {visible && visible.movements.length > 0 && <div className="ledger-column-headings" aria-hidden="true"><span>Movimiento</span><span>Cuenta</span><span>Fecha</span><span>Importe</span><span /></div>}
      {loading && !visible ? <div className="ledger-skeleton" aria-label="Cargando movimientos"><div /><div /><div /></div> : visible?.movements.length ? <div className="ledger-rows">{visible.movements.map((movement) => <details className={`ledger-record ${movement.status}`} key={movement.id}>
        <summary><span className={`ledger-kind-icon ${movement.kind}`} aria-hidden="true">{movement.kind === "transfer" ? <ArrowLeftRight size={20} /> : movement.kind === "income" ? <ArrowDownLeft size={20} /> : <CategorySymbol category={categories?.find((category) => category.id === movement.category_id)} />}</span>
          <span className="ledger-record-name"><strong>{movement.description}</strong><small>{movement.kind === "transfer" ? `Hacia ${movement.destination_name}` : `${movement.parent_name ? `${movement.parent_name} / ` : ""}${movement.category_name}`}</small><small className="ledger-mobile-account">{movement.account_name}</small></span>
          <span className="ledger-record-account"><span className="sr-only">{movement.kind === "transfer" ? "Desde " : "Cuenta "}</span><span>{movement.account_name}</span></span>
          <time dateTime={movement.occurred_at}>{date(movement.occurred_at)}<small>{time(movement.occurred_at)}</small></time>
          <span className="ledger-record-amount"><strong className={movement.kind}>{movement.kind === "transfer" ? "" : movement.kind === "income" ? "+" : "−"}{formatMoney(BigInt(movement.amount_minor), movement.currency_code)}</strong><small>{movement.replaced_by_id ? "Reemplazado" : movement.status === "void" ? "Archivado" : movement.kind === "transfer" ? "Transferencia" : movement.kind === "income" ? "Ingreso" : "Gasto"}</small></span><ChevronDown size={16} className="ledger-chevron" aria-hidden="true" />
        </summary>
        <div className="ledger-record-detail">{movement.note && <p className="ledger-record-note">{movement.note}</p>}{movement.status === "void" && <p><strong>{movement.replaced_by_id ? "Motivo de la edición:" : "Motivo de archivado:"}</strong> {movement.void_reason}</p>}{actions(movement)}{movement.replaces_id && <p>Este registro reemplaza uno anterior. Motivo: {movement.replacement_reason}</p>}{movement.kind === "transfer" && <p>Sale de {movement.account_name} y entra a {movement.destination_name}. No se cuenta como ingreso ni gasto.</p>}<button className="home-text-button" disabled={preparing || open || Boolean(removal)} onClick={() => showTrace(movement.id)}>Ver trazabilidad</button></div>
      </details>)}</div> : !error && !loading && <div className="ledger-empty"><h3>{filters.period === "all" && !filters.query && !filters.kind && !filters.accountId && !filters.categoryId && filters.status === "all" ? `Aún no has registrado movimientos en ${filters.currency}.` : "No hay movimientos con estos filtros."}</h3><p>Registra un ingreso, gasto o transferencia, o limpia los filtros para consultar tu historial.</p></div>}
      {visible && <div className="ledger-pagination"><button className="home-text-button" disabled={loading || Boolean(removal) || !previous.length} onClick={() => { setCursor(previous[previous.length - 1]); setPrevious((all) => all.slice(0, -1)); }}><ChevronLeft size={17} aria-hidden="true" />Anterior</button><span>Página {previous.length + 1}</span><button className="home-text-button" disabled={loading || Boolean(removal) || !visible.has_more} onClick={() => { setPrevious((all) => [...all, cursor]); setCursor(visible.next_cursor); }}>Siguiente<ChevronRight size={17} aria-hidden="true" /></button></div>}
    </section>
  </div>;
}
