"use client";
import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChartNoAxesCombined, RefreshCw } from "lucide-react";
import { comparison } from "../domain/overview";
import { rateLabel, statisticsMetrics, statisticsPeriods, statisticsQuerySchema, statisticsSchema, statisticsSeries, type Statistics, type StatisticsSelection } from "../domain/statistics";
import type { MovementFilters } from "@/modules/transactions";
import { dateLabel, todayInZone } from "@/shared/period";
import { formatMoney } from "@/shared/money";
import { StatisticsDonut, StatisticsTimeChart } from "./statistics-charts";
import { StatisticsCategories } from "./statistics-categories";
import "./statistics.css";

type Load = { url: string; report: Statistics | null; loading: boolean; error: string };
export function StatisticsWorkspace({ selection, onSelection, timezone, now, revision, onMovements }: { selection: StatisticsSelection; onSelection: (value: StatisticsSelection) => void; timezone: string; now: string; revision: number; onMovements: (filters: Partial<MovementFilters>) => void }) {
  const [state, setState] = useState<Load>({ url: "", report: null, loading: true, error: "" }), [retry, setRetry] = useState(0);
  const query = { currency: selection.currency, period: selection.period, ...(selection.period === "custom" ? { from: selection.from, to: selection.to } : {}) };
  const parsed = statisticsQuerySchema.safeParse(query), today = state.report?.today ?? todayInZone(now, timezone);
  const valid = parsed.success && (selection.period !== "custom" || selection.to <= today);
  const url = valid ? `/api/v1/statistics?${new URLSearchParams(query)}` : "";
  const view = state.url === url ? state : null, report = view?.report ?? null;
  const loading = valid && (view?.loading ?? true);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState((old) => ({ url, report: old.url === url ? old.report : null, loading: true, error: "" }));
      try {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        const body = await response.json(); if (!response.ok) throw new Error(body.message ?? "No pudimos cargar las estadísticas.");
        const report = statisticsSchema.parse(body); if (!controller.signal.aborted) setState({ url, report, loading: false, error: "" });
      } catch (error) { if (!controller.signal.aborted) setState((old) => ({ url, report: old.url === url ? old.report : null, loading: false, error: error instanceof Error ? error.message : "No pudimos cargar las estadísticas." })); }
    }, selection.period === "custom" ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [url, revision, retry, selection.period]);
  useEffect(() => { const focus = () => setRetry((v) => v + 1); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, []);
  function drill(extra: Partial<MovementFilters>) { if (report) onMovements({ currency: report.currency_code, period: "custom", from: report.from, to: report.to, kind: "", accountId: "", categoryId: "", query: "", status: "posted", ...extra }); }
  const metrics = report && statisticsMetrics(report.income_minor, report.expense_minor), previous = report && statisticsMetrics(report.previous_income_minor, report.previous_expense_minor);
  const money = (value: bigint) => formatMoney(value, selection.currency);
  function change(value: bigint, old: bigint) {
    if (!report?.previous_movement_count) return <span className="statistics-comparison">Sin movimientos anteriores</span>;
    const c = comparison(value, old);
    return <span className="statistics-comparison"><span>{c.difference > 0n ? <ArrowUpRight size={14} aria-hidden="true" /> : c.difference < 0n ? <ArrowDownLeft size={14} aria-hidden="true" /> : null}{c.percent ?? "Sin base porcentual"}</span><small>{c.difference > 0n ? "+" : ""}{money(c.difference)} frente al anterior</small></span>;
  }
  return <div className="statistics-workspace">
    <div className="statistics-toolbar"><label>Período<select value={selection.period} onChange={(e) => onSelection({ ...selection, period: e.target.value as StatisticsSelection["period"] })}>{Object.entries(statisticsPeriods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Moneda<select value={selection.currency} onChange={(e) => onSelection({ ...selection, currency: e.target.value as StatisticsSelection["currency"] })}><option value="PEN">Soles · PEN</option><option value="USD">Dólares · USD</option></select></label>
      {selection.period === "custom" && <><label>Fecha inicial<input type="date" min="1900-01-01" max={today} value={selection.from} onChange={(e) => onSelection({ ...selection, from: e.target.value })} aria-invalid={!valid} aria-describedby={!valid ? "statistics-period-error" : undefined} /></label><label>Fecha final<input type="date" min="1900-01-01" max={today} value={selection.to} onChange={(e) => onSelection({ ...selection, to: e.target.value })} aria-invalid={!valid} aria-describedby={!valid ? "statistics-period-error" : undefined} /></label></>}
      <button type="button" className="button button-secondary" disabled={loading || !valid} onClick={() => setRetry((v) => v + 1)}><RefreshCw size={16} aria-hidden="true" />Actualizar</button>
    </div>
    {!valid && <p id="statistics-period-error" className="statistics-error" role="alert">Elige ambas fechas, desde 1900 y hasta hoy. La fecha final debe ser igual o posterior a la inicial y el intervalo no debe superar 3660 días.</p>}
    {view?.error && <div role="alert" className="statistics-error">{view.error} {report && "Se conserva la última consulta de estos mismos filtros, sin actualizar."}<button type="button" className="statistics-text-button" onClick={() => setRetry((v) => v + 1)}>Reintentar estadísticas</button></div>}
    {loading && <div role="status" className="statistics-loading">Consultando tu historial real…</div>}
    {valid && report && metrics && previous && <div aria-busy={loading}>
      <div className="statistics-range"><h2>{dateLabel(report.from)} – {dateLabel(report.to)}</h2><p>Frente al {dateLabel(report.previous_from)} – {dateLabel(report.previous_to)} · Misma cantidad de días.</p><p>Zona {report.timezone}. {report.to === report.today ? "Hoy incluye los movimientos registrados hasta ahora. " : ""}Actualizado {new Intl.DateTimeFormat("es-PE", { timeZone: report.timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(report.as_of))}.</p></div>
      <section className="statistics-metrics" aria-label="Resumen estadístico">
        {([["income", "Total de ingresos", metrics.income, previous.income], ["expense", "Total de gastos", metrics.expense, previous.expense], ["net", "Balance disponible", metrics.net, previous.net], ["savings", "Total de ahorros", metrics.savings, previous.savings]] as const).map(([key, label, value, old]) => <article key={key} className={`statistics-metric ${key}`}><h3>{label}</h3><strong>{money(value)}</strong>{change(value, old)}<p>{key === "net" ? "Ingresos menos gastos. Puede ser negativo." : key === "savings" ? "Excedente positivo del período." : "Solo movimientos vigentes."}</p></article>)}
        <article className="statistics-metric rate"><h3>Porcentaje de ahorro</h3><strong>{rateLabel(metrics.rate)}</strong><span className="statistics-comparison">{metrics.rate !== null && previous.rate !== null ? `${metrics.rate > previous.rate ? "+" : ""}${rateLabel(metrics.rate - previous.rate).replace("%", " pp")} frente al anterior` : "Sin base comparable"}</span><p>{metrics.rate === null ? "Se necesitan ingresos para calcularlo." : "Ahorro calculado / ingresos."}</p></article>
      </section>
      <p className="statistics-method">El balance y el ahorro se calculan con ingresos y gastos del período; no son el saldo de tus cuentas ni dinero reservado. Las transferencias y aperturas quedan fuera. Si hay déficit, el ahorro calculado es cero.</p>
      {!report.movement_count && <div className="statistics-empty"><ChartNoAxesCombined size={30} aria-hidden="true" /><div><h3>Sin ingresos ni gastos en este período.</h3><p>Prueba otro intervalo o consulta tus movimientos para registrar los que faltan.</p></div><button type="button" className="button button-secondary" onClick={() => drill({})}>Ir a Movimientos</button></div>}
      <div className="statistics-visuals" key={url}><StatisticsTimeChart report={report} mode="flow" onRange={(from, to) => drill({ from, to })} /><StatisticsDonut report={report} onCategory={(categoryId) => drill({ kind: "expense", categoryId })} /><StatisticsTimeChart report={report} mode="balance" onRange={(from, to) => drill({ from, to })} /><StatisticsTimeChart report={report} mode="savings" onRange={(from, to) => drill({ from, to })} /></div>
      <StatisticsCategories key={`categories-${url}`} report={report} onCategory={(categoryId) => drill({ kind: "expense", categoryId })} />
      <details className="statistics-data statistics-panel"><summary>Ver datos exactos de los gráficos</summary><p className="statistics-table-note">Importes en {report.currency_code}. El balance se acumula desde el inicio; el ahorro de cada intervalo no se suma para obtener el total cuando existen déficits.</p><div className="statistics-table-scroll" tabIndex={0} role="region" aria-label="Datos estadísticos por intervalo"><table><caption className="sr-only">Valores exactos de los gráficos por intervalo, en {report.currency_code}.</caption><thead><tr><th scope="col">Intervalo</th><th scope="col">Ingresos</th><th scope="col">Gastos</th><th scope="col">Balance acumulado</th><th scope="col">Ahorro del intervalo</th><th scope="col">Ahorro anterior equivalente</th><th scope="col">Detalle</th></tr></thead><tbody>{statisticsSeries(report).map((point) => <tr key={point.from}><th scope="row">{dateLabel(point.from)}{point.from !== point.to && ` – ${dateLabel(point.to)}`}</th><td>{money(point.current.income)}</td><td>{money(point.current.expense)}</td><td>{money(point.cumulative)}</td><td>{money(point.current.savings)}</td><td>{report.previous_movement_count ? money(point.previous.savings) : "Sin movimientos"}<small>{dateLabel(point.previous_from)} – {dateLabel(point.previous_to)}</small></td><td><button type="button" className="statistics-text-button" onClick={() => drill({ from: point.from, to: point.to })}>Ver movimientos</button></td></tr>)}</tbody></table></div></details>
    </div>}
  </div>;
}
