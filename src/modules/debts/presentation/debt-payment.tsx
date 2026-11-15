"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Account } from "@/modules/accounts";
import { catalogSchema, type Category } from "@/modules/classification/domain/category";
import { movementPageSchema, type Movement, type MovementPage } from "@/modules/transactions/domain/movement";
import { formatMoney, openingMinor } from "@/shared/money";
import { localDateTime, wallTimeToUtc } from "@/shared/time";
import { remaining, type Debt } from "../domain/debt";

export function DebtPayment({ debt, accounts, occupied, timezone, locked, onSave, onCancel, onAccounts, onCategories }: { debt: Debt; accounts: Account[]; occupied: Set<string>; timezone: string; locked: boolean; onSave: (command: unknown) => void; onCancel: () => void; onAccounts: () => void; onCategories: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState("new"); const [amount, setAmount] = useState(""); const [accountId, setAccountId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]); const [expenses, setExpenses] = useState<Movement[]>([]); const [page, setPage] = useState<MovementPage | null>(null);
  const [selected, setSelected] = useState(""); const [now, setNow] = useState(true); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [dateError, setDateError] = useState("");
  const eligible = accounts.filter((a) => a.status === "active" && a.currency_code === debt.currency_code);
  const account = eligible.find((a) => a.id === accountId); const selectedExpense = expenses.find((e) => e.id === selected);
  let payment = 0n; try { payment = mode === "existing" ? BigInt(selectedExpense?.amount_minor ?? "0") : openingMinor(amount); } catch { /* Inline server validation supplies the message on submit. */ }
  async function load(more = false, signal?: AbortSignal) {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ currency: debt.currency_code, kind: "expense", status: "posted", limit: "50" });
      if (more && page?.next_cursor) { params.set("cursorAt", page.next_cursor.at); params.set("cursorId", page.next_cursor.id); }
      const [catalogResponse, movementResponse] = await Promise.all([fetch("/api/v1/categories", { cache: "no-store", signal }), fetch(`/api/v1/movements?${params}`, { cache: "no-store", signal })]);
      if (!catalogResponse.ok || !movementResponse.ok) throw new Error();
      const catalog = catalogSchema.parse(await catalogResponse.json()); const result = movementPageSchema.parse(await movementResponse.json());
      if (signal?.aborted) return;
      setCategories(catalog.categories.filter((c) => c.kind === "expense" && !c.effective_archived)); setPage(result); setExpenses((old) => more ? [...old, ...result.movements] : result.movements);
    } catch { if (!signal?.aborted) setError("No pudimos cargar las categorías o los gastos. Reintenta antes de registrar el pago."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load(false, controller.signal); }); return () => controller.abort(); /* Initial debt is immutable while this form is mounted. */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (loading || error) return; const values = new FormData(event.currentTarget);
    try { onSave({ action: "pay", id: debt.id, requestId, mode, note: values.get("note"), ...(mode === "existing" ? { movementId: selected } : { accountId, categoryId: values.get("categoryId"), amount, occurredAt: now ? null : wallTimeToUtc(String(values.get("occurredAt")), timezone) }) }); }
    catch (e) { setDateError(e instanceof Error ? e.message : "Revisa la fecha del pago."); }
  }
  return <section className="debt-editor" aria-labelledby="debt-payment-title"><div className="debt-section-heading"><div><h2 id="debt-payment-title">Registrar pago de {debt.name}</h2><p>Quedan {formatMoney(remaining(debt), debt.currency_code)} por pagar a {debt.creditor}.</p></div></div>
    <form onSubmit={submit}><fieldset disabled={locked}><div className="debt-mode" role="group" aria-label="Origen del pago"><button type="button" aria-pressed={mode === "new"} onClick={() => setMode("new")}>Crear un gasto nuevo</button><button type="button" aria-pressed={mode === "existing"} onClick={() => setMode("existing")}>Vincular un gasto existente</button></div>
      {loading && <p role="status">Cargando gastos y categorías…</p>}{error && <div role="alert" className="debt-error">{error}<button type="button" onClick={() => void load()}>Reintentar carga</button></div>}
      {mode === "new" ? <><p className="debt-help">Se creará un gasto en Movimientos y se descontará de la cuenta elegida.</p>
        {!eligible.length && <p className="debt-prerequisite">Necesitas una cuenta activa en {debt.currency_code}. <button type="button" onClick={onAccounts}>Ir a Cuentas</button></p>}
        {!loading && !error && !categories.length && <p className="debt-prerequisite">Necesitas una categoría de gasto activa. <button type="button" onClick={onCategories}>Ir a Categorías</button></p>}
        <div className="debt-form-grid"><label className="debt-field">Importe del pago<input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /><small>Máximo {formatMoney(remaining(debt), debt.currency_code)}.</small></label><label className="debt-field">Cuenta del pago<select required value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Elige una cuenta</option>{eligible.map((a) => <option key={a.id} value={a.id}>{a.name} · {formatMoney(BigInt(a.balance_minor), a.currency_code)}</option>)}</select></label>
          <label className="debt-field debt-wide">Categoría del gasto<select name="categoryId" required defaultValue=""><option value="">Elige una categoría</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? `${categories.find((p) => p.id === c.parent_id)?.name ?? ""} / ` : ""}{c.name}</option>)}</select></label>
          <div className="debt-wide"><label className="debt-check"><input type="checkbox" checked={now} onChange={(e) => { setNow(e.target.checked); setDateError(""); }} />Registrar con fecha y hora actuales</label>{!now && <label className="debt-field">Fecha y hora del pago ({timezone})<input name="occurredAt" type="datetime-local" required max={localDateTime(new Date(), timezone)} onChange={() => setDateError("")} aria-invalid={!!dateError} aria-describedby={dateError ? "debt-date-error" : undefined} /></label>}{dateError && <p id="debt-date-error" role="alert" className="debt-error">{dateError}</p>}</div></div>
      </> : <><p className="debt-help">Vincula el importe completo de un gasto ya registrado. El saldo de tus cuentas no volverá a descontarse. Su fecha se conservará.</p><label className="debt-field">Gasto registrado<select required value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Elige un gasto en {debt.currency_code}</option>{expenses.filter((e) => !occupied.has(e.id) && !e.replaced_by_id).map((e) => <option key={e.id} value={e.id} disabled={BigInt(e.amount_minor) > remaining(debt)}>{e.description} · {formatMoney(BigInt(e.amount_minor), e.currency_code)} · {new Intl.DateTimeFormat("es-PE", { timeZone: timezone, dateStyle: "short" }).format(new Date(e.occurred_at))}{BigInt(e.amount_minor) > remaining(debt) ? " (supera el pendiente)" : ""}</option>)}</select></label>
        {!loading && !expenses.some((e) => !occupied.has(e.id) && !e.replaced_by_id) && <p>No hay gastos disponibles en esta página. Puedes crear uno nuevo{page?.has_more ? " o cargar más gastos" : ""}.</p>}{page?.has_more && <button type="button" className="button button-secondary" disabled={loading} onClick={() => void load(true)}>Cargar más gastos</button>}</>}
      <label className="debt-field debt-payment-note">Nota del pago (opcional)<textarea name="note" maxLength={1000} rows={2} /></label>
      {payment > 0n && <div className={`debt-payment-preview ${payment > remaining(debt) || (mode === "new" && account && BigInt(account.balance_minor) < payment) ? "warning" : ""}`}><p>Pendiente después del pago <strong>{formatMoney(remaining(debt) - payment, debt.currency_code)}</strong></p>{account && mode === "new" && <p>Saldo de {account.name} después del gasto <strong>{formatMoney(BigInt(account.balance_minor) - payment, debt.currency_code)}</strong></p>}{payment > remaining(debt) && <p>El pago supera lo que queda por pagar. Reduce el importe.</p>}{mode === "new" && account && BigInt(account.balance_minor) < payment && <p>El saldo quedará negativo. Regístralo solo si el pago realmente ocurrió.</p>}</div>}
      <div className="debt-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button><button type="submit" className="button" disabled={loading || !!error || payment <= 0n || payment > remaining(debt) || (mode === "new" && (!account || !categories.length))}>Registrar pago</button></div>
    </fieldset></form></section>;
}
