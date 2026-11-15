"use client";
import { useEffect, useState, type FormEvent } from "react";
import { decimalMoney, formatMoney } from "@/shared/money";
import { localDateTime, wallTimeToUtc } from "@/shared/time";
import { movementPageSchema, type MovementPage } from "@/modules/transactions/domain/movement";
import { frequencies, type FixedExpense, type FixedCatalog, type Occurrence } from "../domain/fixed-expense";

type Common = { catalog: FixedCatalog; locked: boolean; onSave: (c: unknown) => void };
export function FixedExpenseEditor({ expense, catalog, locked, onSave }: Common & { expense: FixedExpense | null }) {
  const [requestId] = useState(() => crypto.randomUUID());
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    onSave({ action: expense ? "update" : "create", ...(expense ? { id: expense.id, expectedVersion: expense.version } : { requestId }), name: data.get("name"), note: data.get("note"), amount: data.get("amount"), categoryId: data.get("category"), currency: expense?.currency_code ?? data.get("currency"), dueDate: expense?.anchor ?? data.get("dueDate"), frequency: expense?.frequency ?? data.get("frequency") });
  }
  const eligible = catalog.categories.filter((c) => c.kind === "expense" && !c.effective_archived);
  return <form onSubmit={submit}><fieldset disabled={locked} className="fixed-form-fields">
    <label className="fixed-wide">Nombre del gasto<input autoFocus name="name" required maxLength={100} defaultValue={expense?.name} autoComplete="off" /></label>
    <label>Monto<input name="amount" inputMode="decimal" required defaultValue={expense ? decimalMoney(BigInt(expense.amount_minor)) : ""} placeholder="0.00" /></label>
    <label>Moneda<select name="currency" defaultValue={expense?.currency_code ?? "PEN"} disabled={!!expense}><option>PEN</option><option>USD</option></select></label>
    <label className="fixed-wide">Categoría<select name="category" required defaultValue={expense?.category_id ?? ""}><option value="">Elige una categoría de gasto</option>{expense && !eligible.some((c) => c.id === expense.category_id) && <option value={expense.category_id} disabled>{expense.category_name} (no disponible)</option>}{eligible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {!eligible.length && <p className="fixed-wide">Crea o restaura una categoría de gasto en Categorías para continuar.</p>}
    <label>Primer vencimiento<input name="dueDate" type="date" required min="2000-01-01" max="2100-12-31" defaultValue={expense?.anchor ?? catalog.today} disabled={!!expense} /></label>
    <label>Frecuencia<select name="frequency" defaultValue={expense?.frequency ?? "monthly"} disabled={!!expense}>{Object.entries(frequencies).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <p className="fixed-help fixed-wide">{expense ? "El monto y la categoría se aplican a los vencimientos sin pagar. Los pagos anteriores se conservan. Para cambiar el calendario o la moneda, elimina el compromiso y crea uno nuevo." : "El calendario parte de esta fecha. Si el día no existe en un mes, vencerá el último día de ese mes. No se crean movimientos hasta confirmar un pago."}</p>
    <label className="fixed-wide">Observaciones (opcional)<textarea name="note" maxLength={2000} rows={3} defaultValue={expense?.note} /></label>
    <button className="button button-primary fixed-wide" type="submit" disabled={!eligible.length}>{expense ? "Guardar cambios" : "Crear gasto fijo"}</button>
  </fieldset></form>;
}

export function FixedExpensePayment({ expense, occurrence, catalog, locked, timezone, onSave }: Common & { expense: FixedExpense; occurrence: Occurrence; timezone: string }) {
  const [requestId] = useState(() => crypto.randomUUID()); const [mode, setMode] = useState("new"); const [accountId, setAccount] = useState("");
  const [dateNow, setDateNow] = useState(true); const [error, setError] = useState("");
  const [page, setPage] = useState<MovementPage | null>(null); const [loading, setLoading] = useState(false);
  useEffect(() => { if (mode !== "existing") return; const abort = new AbortController();
    void fetch(`/api/v1/movements?currency=${expense.currency_code}&kind=expense&status=posted`, { cache: "no-store", signal: abort.signal }).then(async (r) => { if (!r.ok) throw new Error(); return movementPageSchema.parse(await r.json()); }).then(setPage).catch(() => { if (!abort.signal.aborted) setError("No pudimos cargar los gastos. Vuelve a elegir Vincular gasto existente para reintentar."); }); return () => abort.abort();
  }, [mode, expense.currency_code]);
  async function more() {
    if (!page?.next_cursor || loading) return; setLoading(true); setError("");
    try { const params = new URLSearchParams({ currency: expense.currency_code, kind: "expense", status: "posted", cursorAt: page.next_cursor.at, cursorId: page.next_cursor.id });
      const r = await fetch(`/api/v1/movements?${params}`, { cache: "no-store", signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(); const next = movementPageSchema.parse(await r.json()); setPage({ ...next, movements: [...page.movements, ...next.movements] });
    } catch { setError("No pudimos cargar más gastos. Reintenta."); } finally { setLoading(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError(""); let occurredAt: string | null = null;
    if (mode === "new" && !dateNow) { try { occurredAt = wallTimeToUtc(String(data.get("date")), timezone); } catch { setError("La fecha u hora no es válida en tu zona horaria."); return; } }
    onSave({ action: "pay", id: expense.id, expectedVersion: expense.version, ordinal: occurrence.ordinal, requestId, mode, ...(mode === "new" ? { accountId, occurredAt } : { movementId: data.get("movement") }) });
  }
  const account = catalog.accounts.find((a) => a.id === accountId); const amount = BigInt(occurrence.amount_minor);
  const used = new Set(catalog.payments.map((p) => p.movement_id));
  const options = page?.movements.filter((m) => m.amount_minor === occurrence.amount_minor && !m.replaced_by_id && !used.has(m.id)) ?? [];
  return <form onSubmit={submit}><fieldset disabled={locked} className="fixed-payment-fields">
    <p className="fixed-payment-total">{expense.name}<strong>{formatMoney(amount, expense.currency_code)}</strong><span>Vencimiento: {occurrence.due_date}</span></p>
    <label>Cómo registrar el pago<select autoFocus value={mode} onChange={(e) => { setMode(e.target.value); setError(""); }}><option value="new">Crear un gasto nuevo</option><option value="existing">Vincular gasto existente</option></select></label>
    {mode === "new" ? <>
      <label>Cuenta de pago<select required value={accountId} onChange={(e) => setAccount(e.target.value)}><option value="">Elige una cuenta en {expense.currency_code}</option>{catalog.accounts.filter((a) => a.status === "active" && a.currency_code === expense.currency_code).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="fixed-check"><input type="checkbox" checked={dateNow} onChange={(e) => setDateNow(e.target.checked)} />Usar fecha y hora actuales</label>
      {!dateNow && <label>Fecha y hora del pago ({timezone})<input type="datetime-local" name="date" required max={localDateTime(new Date(), timezone)} /></label>}
      {account && <p className="fixed-help">Saldo después del pago: <strong>{formatMoney(BigInt(account.balance_minor) - amount, expense.currency_code)}</strong>{BigInt(account.balance_minor) < amount && <span className="fixed-warning">El saldo quedará negativo. Confirma solo si el pago realmente ocurrió.</span>}</p>}
    </> : <><p className="fixed-help">Vincula un gasto por el importe completo y en la misma moneda. No se volverá a descontar del saldo. Los gastos vinculados a Deudas u otro vencimiento serán rechazados.</p><label>Gasto registrado<select name="movement" required defaultValue=""><option value="">Elige un gasto</option>{options.map((m) => <option key={m.id} value={m.id}>{m.description} · {new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeZone: timezone }).format(new Date(m.occurred_at))}</option>)}</select></label>{page && !options.length && <p>No hay gastos compatibles en los resultados cargados.</p>}{page?.has_more && <button type="button" className="button button-secondary" disabled={loading} onClick={() => void more()}>Cargar más gastos</button>}</>}
    {error && <p role="alert" className="field-error">{error}</p>}
    <button type="submit" className="button button-primary">Confirmar pago</button>
  </fieldset></form>;
}
