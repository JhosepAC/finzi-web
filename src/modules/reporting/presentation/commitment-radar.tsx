"use client";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { fixedCatalogSchema } from "@/modules/fixed-expenses";
import { CategorySymbol, type Category } from "@/modules/classification";
import { debtCatalogSchema, DebtSymbol } from "@/modules/debts";
import { formatMoney, type Currency } from "@/shared/money";
import { dateLabel } from "@/shared/period";

type Item = { id: string; name: string; due: string | null; amount: bigint; category?: Category; icon?: "wallet" | "home" | "book" | "cart" | "heart" | "briefcase" };
export function CommitmentRadar({ currency, revision, onFixed, onDebts }: { currency: Currency; revision: number; onFixed: () => void; onDebts: () => void }) {
  const [tab, setTab] = useState<"fixed" | "debts">("fixed");
  const [state, setState] = useState<{ fixed: Item[]; debts: Item[]; today: string; currency: Currency } | null>(null);
  const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const options = { cache: "no-store" as const, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) };
        const results = await Promise.all([fetch("/api/v1/fixed-expenses", options), fetch("/api/v1/debts", options)]);
        if (results.some((r) => !r.ok)) throw new Error();
        const [fixed, debts] = await Promise.all([results[0].json().then((v) => fixedCatalogSchema.parse(v)), results[1].json().then((v) => debtCatalogSchema.parse(v))]);
        if (!controller.signal.aborted) {
          setState({ currency, today: fixed.today, fixed: fixed.expenses.filter((e) => !e.deleted_at && e.next_due).map((e) => ({ id: e.id, name: e.name, due: e.next_due, amount: BigInt(e.amount_minor), currency: e.currency_code, category: fixed.categories.find((c) => c.id === e.category_id) })).filter((e) => e.currency === currency), debts: debts.debts.filter((e) => !e.deleted_at && e.currency_code === currency && BigInt(e.amount_minor) > BigInt(e.paid_minor)).map((e) => ({ id: e.id, name: e.name, due: e.due_date, amount: BigInt(e.amount_minor) - BigInt(e.paid_minor), icon: e.icon })) }); setError("");
        }
      } catch { if (!controller.signal.aborted) { setState(null); setError("No pudimos consultar tus compromisos."); } }
    }
    void load(); return () => controller.abort();
  }, [currency, revision, retry]);
  // Never show another currency while the next request is pending.
  const current = state?.currency === currency ? state : null;
  const rows = current?.[tab].toSorted((a,b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")) ?? [];
  return <section className="home-panel overview-radar" aria-labelledby="overview-radar-title"><div className="panel-heading"><h2 id="overview-radar-title">Radar de compromisos</h2></div><div className="overview-category-switch" role="group" aria-label="Compromisos pendientes"><button aria-pressed={tab === "fixed"} onClick={() => setTab("fixed")}>Gastos fijos</button><button aria-pressed={tab === "debts"} onClick={() => setTab("debts")}>Deudas</button></div><p className="overview-radar-scope">Próximos pagos en {currency}, independientes del período y la cuenta.</p>{error ? <div role="alert" className="overview-error">{error}<button className="home-text-button" onClick={() => setRetry((v) => v + 1)}>Reintentar compromisos</button></div> : !current ? <p role="status" className="overview-empty">Consultando compromisos…</p> : rows.length ? <ul>{rows.slice(0,3).map((item) => <li key={item.id}><span className="overview-radar-icon" aria-hidden="true">{tab === "fixed" ? <CategorySymbol category={item.category} /> : <DebtSymbol icon={item.icon ?? "wallet"} />}</span><div><strong>{item.name}</strong><small className={item.due && item.due < current!.today ? "overdue" : ""}>{item.due ? `${item.due < current!.today ? "Atrasado · " : "Vence "}${dateLabel(item.due)}` : "Sin vencimiento"}</small></div><strong>{formatMoney(item.amount,currency)}</strong></li>)}</ul> : <p className="overview-empty">Sin {tab === "fixed" ? "gastos fijos" : "deudas"} pendientes en esta moneda.</p>}<button className="home-text-button overview-radar-link" onClick={tab === "fixed" ? onFixed : onDebts}>Ver {tab === "fixed" ? "gastos fijos" : "deudas"}<ChevronRight size={16} /></button></section>;
}
