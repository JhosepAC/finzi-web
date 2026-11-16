"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { chartScale, statisticsSeries, type Statistics } from "../domain/statistics";
import { formatMoney } from "@/shared/money";
import { dateLabel } from "@/shared/period";

const titles = { flow: "Ingresos vs. gastos", balance: "Evolución del balance", savings: "Tendencia de ahorro" };
export function StatisticsTimeChart({ report, mode, onRange }: { report: Statistics; mode: keyof typeof titles; onRange: (from: string, to: string) => void }) {
  const series = statisticsSeries(report), [selected, setSelected] = useState(Math.max(0, series.findLastIndex((point) => point.current.income > 0n || point.current.expense > 0n)));
  const [chartType, setChartType] = useState("bars"); const [showIncome, setShowIncome] = useState(true); const [showExpense, setShowExpense] = useState(true);
  const index = Math.min(Math.max(selected, 0), series.length - 1), active = series[index];
  const hasPrevious = report.previous_movement_count > 0;
  const values = series.flatMap((s) => mode === "flow" ? [...(showIncome ? [s.current.income] : []), ...(showExpense ? [s.current.expense] : [])] : mode === "balance" ? [s.cumulative, ...(hasPrevious ? [s.previousCumulative] : [])] : [s.current.savings, ...(hasPrevious ? [s.previous.savings] : [])]);
  const scale = chartScale(values), x = (i: number) => 20 + (i + .5) * 680 / Math.max(series.length, 1);
  const currentValue = (i: number) => mode === "balance" ? series[i].cumulative : series[i].current.savings;
  const previousValue = (i: number) => mode === "balance" ? series[i].previousCumulative : series[i].previous.savings;
  const path = (previous = false) => series.map((_, i) => `${i ? "L" : "M"}${x(i)},${20 + scale.y(previous ? previousValue(i) : currentValue(i))}`).join(" ");
  const flowPath = (kind: "income" | "expense") => series.map((point, i) => `${i ? "L" : "M"}${x(i)},${20 + scale.y(point.current[kind])}`).join(" ");
  const money = (value: bigint) => formatMoney(value, report.currency_code);
  return <section className={`statistics-panel statistics-chart ${mode}`} aria-labelledby={`statistics-${mode}`}>
    <div className="statistics-panel-heading"><h2 id={`statistics-${mode}`}>{titles[mode]}</h2><span>{{ day: "Por día", week: "Por intervalo de 7 días", month: "Por mes" }[report.granularity]}</span></div>
    <p className="statistics-explanation">{mode === "flow" ? "Compara el dinero que entra y sale en cada intervalo." : mode === "balance" ? "Ingresos menos gastos acumulados desde el inicio del período. Excluye aperturas y transferencias." : "Excedente positivo de cada intervalo, sin acumular. Los déficits de otros intervalos reducen el ahorro total del período."}</p>
    {report.movement_count || report.previous_movement_count ? <>
      <div className="statistics-chart-tools"><div className="statistics-legend">{mode === "flow" ? <><button type="button" aria-pressed={showIncome} onClick={() => setShowIncome(!showIncome)}><i className="income" />Ingresos</button><button type="button" aria-pressed={showExpense} onClick={() => setShowExpense(!showExpense)}><i className="expense" />Gastos</button></> : <><span><i className={mode === "savings" ? "savings" : "balance"} />Período elegido</span>{hasPrevious && <span><i className="previous" />Anterior de igual duración</span>}</>}</div>{mode === "flow" && <div className="statistics-chart-modes" role="group" aria-label="Tipo de gráfico">{[["bars", "Barras"], ["lines", "Líneas"]].map(([key, label]) => <button key={key} type="button" aria-pressed={chartType === key} onClick={() => setChartType(key)}>{label}</button>)}</div>}</div>
      <div className="statistics-chart-scale"><span>Máx. {money(scale.high)}</span><span>Mín. {money(scale.low)}</span></div>
      <svg className="statistics-svg" viewBox="0 0 720 200" preserveAspectRatio="none" role="img" aria-label={`${titles[mode]}. Selecciona un intervalo con los controles inferiores para consultar cifras exactas.`}>
        {[0, 40, 80, 120, 160].map((y) => <line key={y} x1="20" x2="700" y1={20 + y} y2={20 + y} className="statistics-gridline" />)}
        {mode === "flow" && chartType === "lines" && <>{showIncome && <path d={flowPath("income")} className="statistics-line flow-income" />}{showExpense && <path d={flowPath("expense")} className="statistics-line flow-expense" />}</>}
        <line x1="20" x2="700" y1={20 + scale.y(0n)} y2={20 + scale.y(0n)} className="statistics-zero" />
        {mode !== "flow" && <>{hasPrevious && <path d={path(true)} className="statistics-line previous" />}<path d={path()} className={`statistics-line ${mode}`} /></>}
        {series.map((point, i) => <g key={point.from} aria-hidden="true" className={`statistics-point ${i === index ? "selected" : ""}`} onPointerEnter={() => setSelected(i)} onClick={() => setSelected(i)}>
          <rect x={x(i) - 340 / series.length} y="16" width={680 / series.length} height="174" fill="transparent" />
          {mode === "flow" ? <>{chartType === "bars" && showIncome && <rect className="statistics-bar income" x={x(i) - 220 / series.length} y={20 + scale.y(point.current.income)} width={190 / series.length} height={160 - scale.y(point.current.income)} rx="3" />}{chartType === "bars" && showExpense && <rect className="statistics-bar expense" x={x(i) + 30 / series.length} y={20 + scale.y(point.current.expense)} width={190 / series.length} height={160 - scale.y(point.current.expense)} rx="3" />}{chartType === "lines" && <>{showIncome && <circle cx={x(i)} cy={20 + scale.y(point.current.income)} r={i === index ? 5 : 2} className="statistics-dot flow-income" />}{showExpense && <circle cx={x(i)} cy={20 + scale.y(point.current.expense)} r={i === index ? 5 : 2} className="statistics-dot flow-expense" />}</>}</> : <circle cx={x(i)} cy={20 + scale.y(currentValue(i))} r={i === index ? 5 : 2.5} className={`statistics-dot ${mode}`} />}
        </g>)}
      </svg>
      <div className="statistics-axis-dates"><span>{dateLabel(report.from)}</span><span>{dateLabel(report.to)}</span></div>
      <div className="statistics-point-controls"><button type="button" aria-label={`Intervalo anterior de ${titles[mode]}`} disabled={index === 0} onClick={() => setSelected(index - 1)}><ChevronLeft size={18} aria-hidden="true" /></button><label><span className="sr-only">Intervalo de {titles[mode]}</span><select value={index} onChange={(e) => setSelected(Number(e.target.value))}>{series.map((point, i) => <option key={point.from} value={i}>{dateLabel(point.from)}{point.from !== point.to ? ` – ${dateLabel(point.to)}` : ""}</option>)}</select></label><button type="button" aria-label={`Intervalo siguiente de ${titles[mode]}`} disabled={index === series.length - 1} onClick={() => setSelected(index + 1)}><ChevronRight size={18} aria-hidden="true" /></button></div>
      {active && <div className="statistics-readout" aria-live="polite">{mode === "flow" ? <><div><span>Ingresos</span><strong>{money(active.current.income)}</strong></div><div><span>Gastos</span><strong>{money(active.current.expense)}</strong></div></> : <><div><span>{mode === "balance" ? "Balance acumulado" : "Ahorro del intervalo"}</span><strong>{money(currentValue(index))}</strong></div><div><span>Anterior equivalente</span><strong>{hasPrevious ? money(previousValue(index)) : "Sin movimientos"}</strong></div>{hasPrevious && <p>{dateLabel(active.previous_from)} – {dateLabel(active.previous_to)}</p>}</>}</div>}
      {series.length < 2 && <p className="statistics-explanation">Hay un solo intervalo; todavía no alcanza para identificar una tendencia.</p>}
      {active && <button type="button" className="statistics-text-button" onClick={() => onRange(mode === "balance" ? report.from : active.from, active.to)}>Ver movimientos {mode === "balance" ? "hasta este cierre" : "del intervalo"}</button>}
    </> : <div className="statistics-chart-empty">Sin ingresos ni gastos en estos períodos. El gráfico aparecerá al registrar movimientos.</div>}
  </section>;
}

const categoryColors: Record<string, string> = { blue: "#1d4ed8", green: "#247b68", amber: "#a36414", purple: "#7c4fb4", rose: "#a74667", cyan: "#15758b", slate: "#65738c" };
export function StatisticsDonut({ report, onCategory }: { report: Statistics; onCategory: (id: string) => void }) {
  const groups = report.categories.filter((c) => BigInt(c.amount_minor) > 0n), total = BigInt(report.expense_minor);
  const top = groups.slice(0, 5), rest = groups.slice(5), [selected, setSelected] = useState(0);
  const slices = [...top.map((c) => ({ id: c.id, name: c.name, amount: BigInt(c.amount_minor) })), ...(rest.length ? [{ id: "other", name: "Otras categorías", amount: rest.reduce((n, c) => n + BigInt(c.amount_minor), 0n) }] : [])];
  const colors = [...top.map((c) => categoryColors[c.color] ?? "#65738c"), "#65738c"];
  const active = slices[Math.min(selected, slices.length - 1)]; let offset = 0;
  const percent = (amount: bigint) => { const value = total ? (amount * 10000n + total / 2n) / total : 0n; return value === 0n && amount > 0n ? "Menos de 0,01%" : `${(Number(value) / 100).toLocaleString("es-PE", { maximumFractionDigits: 2 })}%`; };
  return <section className="statistics-panel statistics-distribution" aria-labelledby="statistics-distribution"><div className="statistics-panel-heading"><h2 id="statistics-distribution">Distribución de gastos</h2><span>{groups.length} categorías</span></div><p className="statistics-explanation">Cada categoría agrupa a sus subcategorías una sola vez. Porcentajes redondeados.</p>
    {total > 0n ? <><div className="statistics-donut-layout"><div className="statistics-donut"><svg viewBox="0 0 200 200" aria-hidden="true">{slices.map((slice, i) => {
      const length = Number(slice.amount * 1000000n / total) / 10000, start = offset; offset += length;
      return <circle key={slice.id} cx="100" cy="100" r="72" pathLength="100" fill="none" stroke={colors[i]} strokeWidth={i === selected ? 30 : 24} strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} transform="rotate(-90 100 100)" onPointerEnter={() => setSelected(i)} onClick={() => setSelected(i)} />;
    })}</svg><div><strong>{active ? percent(active.amount) : "0%"}</strong><span>del gasto total</span></div></div><ul className="statistics-donut-legend">{slices.map((slice, i) => <li key={slice.id}><button type="button" aria-pressed={selected === i} onFocus={() => setSelected(i)} onClick={() => setSelected(i)}><i style={{ background: colors[i] }} aria-hidden="true" /><span>{slice.name}</span><strong>{percent(slice.amount)}</strong><small>{formatMoney(slice.amount, report.currency_code)}</small></button></li>)}</ul></div>
      {active && <div className="statistics-donut-detail"><p><strong>{active.name}</strong><span>{formatMoney(active.amount, report.currency_code)}</span></p>{active.id !== "other" ? <button type="button" className="statistics-text-button" onClick={() => onCategory(active.id)}>Ver sus movimientos</button> : <details><summary>Ver las demás categorías</summary><ul>{rest.map((c) => <li key={c.id}><button type="button" className="statistics-text-button" onClick={() => onCategory(c.id)}>{c.name} · {formatMoney(BigInt(c.amount_minor), report.currency_code)} · {percent(BigInt(c.amount_minor))}</button></li>)}</ul></details>}</div>}
    </> : <div className="statistics-chart-empty">No hay gastos en este período y moneda. No se calcula una distribución sin gastos.</div>}
  </section>;
}
