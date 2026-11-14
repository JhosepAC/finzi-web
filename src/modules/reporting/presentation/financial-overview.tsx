"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Plus, Wallet } from "lucide-react";
import type { Account } from "@/modules/accounts";
import { movementPageSchema, type MovementPage } from "@/modules/transactions/domain/movement";
import { formatMoney, type Currency } from "@/shared/money";
import { monthRange } from "@/shared/time";
import "./overview.css";

export function FinancialOverview({ accounts, timezone, preferredCurrency, now, revision, onRegister, onAccounts, onCreateAccount, onMovements }: { accounts: Account[]; timezone: string; preferredCurrency: Currency; now: string; revision: number; onRegister: (kind: "income" | "expense") => void; onAccounts: () => void; onCreateAccount: () => void; onMovements: () => void }) {
  const [currency, setCurrency] = useState(preferredCurrency);
  const [page, setPage] = useState<MovementPage | null>(null);
  const [errorUrl, setErrorUrl] = useState("");
  const [retry, setRetry] = useState(0);
  const [loadedCurrency, setLoaded] = useState<Currency | null>(null);
  const range = monthRange(now, timezone);
  const url = `/api/v1/movements?${new URLSearchParams({ currency, from: range.from, to: range.to, status: "posted", limit: "5" })}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(async (response) => { if (!response.ok) throw new Error(); return movementPageSchema.parse(await response.json()); })
      .then((data) => { if (!controller.signal.aborted) { setPage(data); setLoaded(data.currency_code); setErrorUrl(""); } }).catch(() => { if (!controller.signal.aborted) setErrorUrl(url); });
    return () => controller.abort();
  }, [url, revision, retry]);
  const error = errorUrl === url;
  const visible = loadedCurrency === currency ? page : null;
  const selectedAccounts = accounts.filter((a) => a.currency_code === currency);
  const balance = selectedAccounts.reduce((sum, account) => sum + BigInt(account.balance_minor), 0n);
  if (!accounts.length) return <section className="home-real-empty"><span className="empty-brand" aria-hidden="true"><Wallet size={32} /></span><h2>Empieza por tu primera cuenta.</h2><p>Registra el efectivo o la cuenta bancaria con la que comienzas. Después podrás añadir tus ingresos y gastos.</p><button className="home-primary-button" onClick={onCreateAccount}><Plus size={18} aria-hidden="true" />Crear mi primera cuenta</button><small>No pediremos números de cuenta ni documentos bancarios.</small></section>;
  const month = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: timezone }).format(new Date(now));
  return <div className="financial-overview"><div className="overview-toolbar"><label htmlFor="overview-currency">Moneda del resumen<select id="overview-currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}><option value="PEN">Soles · PEN</option><option value="USD">Dólares · USD</option></select></label><button className="home-primary-button" disabled={!accounts.some((a) => a.status === "active")} onClick={() => onRegister("expense")}><Plus size={18} aria-hidden="true" />Registrar movimiento</button></div>
    <div className="overview-summary"><section className="overview-balance"><div><h2>Saldo actual en {currency}</h2><Wallet size={21} aria-hidden="true" /></div><strong>{formatMoney(balance, currency)}</strong><p>{selectedAccounts.length} {selectedAccounts.length === 1 ? "cuenta registrada" : "cuentas registradas"}, incluidas las archivadas</p><button onClick={onAccounts}>Ver cuentas<ArrowUpRight size={16} aria-hidden="true" /></button></section><section className="home-panel overview-month"><h2>{month}</h2>{visible ? <dl><div><dt><ArrowDownLeft size={17} aria-hidden="true" />Ingresos</dt><dd className="income">{formatMoney(BigInt(visible.income_minor), currency)}</dd></div><div><dt><ArrowUpRight size={17} aria-hidden="true" />Gastos</dt><dd className="expense">{formatMoney(BigInt(visible.expense_minor), currency)}</dd></div><div><dt>Flujo neto</dt><dd>{formatMoney(BigInt(visible.income_minor) - BigInt(visible.expense_minor), currency)}</dd></div></dl> : <p className="overview-loading">{error ? "El resumen no está disponible." : "Cargando el resumen…"}</p>}<p>Registros vigentes en tu zona horaria. Las aperturas no son ingresos.</p></section></div>
    {error && <div className="overview-error" role="alert">No pudimos actualizar el resumen.{visible && " Se conservan los últimos datos."} <button className="home-text-button" onClick={() => setRetry((v) => v + 1)}>Actualizar resumen</button></div>}
    <section className="home-panel overview-recent" aria-labelledby="overview-recent-title"><div className="panel-heading"><h2 id="overview-recent-title">Movimientos de {month}</h2><button className="home-text-button" onClick={onMovements}>Ver historial</button></div>{visible ? visible.movements.length ? <ul>{visible.movements.map((m) => <li key={m.id}><span><strong>{m.description}</strong><small>{m.account_name} · {new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", timeZone: timezone }).format(new Date(m.occurred_at))}</small></span><strong className={m.kind}>{m.kind === "income" ? "+" : "−"}{formatMoney(BigInt(m.amount_minor), currency)}</strong></li>)}</ul> : <div className="overview-empty"><p>Todavía no hay ingresos o gastos vigentes en este mes y moneda.</p><button className="home-text-button" onClick={() => onRegister("income")}>Registrar ingreso</button></div> : <p className="overview-loading">{error ? "Los movimientos no están disponibles." : "Cargando movimientos…"}</p>}</section>
  </div>;
}
