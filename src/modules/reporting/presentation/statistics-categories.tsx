"use client";
import { useState } from "react";
import { comparison } from "../domain/overview";
import type { Statistics } from "../domain/statistics";
import { formatMoney } from "@/shared/money";

export function StatisticsCategories({ report, onCategory }: { report: Statistics; onCategory: (id: string) => void }) {
  const [mode, setMode] = useState("largest"), [limit, setLimit] = useState(10);
  const total = BigInt(report.expense_minor);
  const rows = report.categories.filter((c) => mode !== "largest" && !report.previous_movement_count ? false : mode === "increase" ? BigInt(c.amount_minor) > BigInt(c.previous_amount_minor) : mode === "reduction" ? BigInt(c.amount_minor) < BigInt(c.previous_amount_minor) : BigInt(c.amount_minor) > 0n);
  rows.sort((a, b) => {
    const av = BigInt(a.amount_minor) - (mode === "largest" ? 0n : BigInt(a.previous_amount_minor));
    const bv = BigInt(b.amount_minor) - (mode === "largest" ? 0n : BigInt(b.previous_amount_minor));
    return av === bv ? a.name.localeCompare(b.name, "es") : (av > bv ? -1 : 1) * (mode === "reduction" ? -1 : 1);
  });
  const money = (value: string | bigint) => formatMoney(BigInt(value), report.currency_code);
  return <section className="statistics-panel statistics-categories" aria-labelledby="statistics-category-title"><div className="statistics-panel-heading"><h2 id="statistics-category-title">Dónde cambia tu gasto</h2><span>{rows.length} categorías</span></div>
    <p className="statistics-explanation">Compara con el intervalo anterior indicado arriba. Una reducción es menor gasto registrado, no dinero reservado automáticamente.</p>
    <div className="statistics-segments" role="group" aria-label="Análisis por categorías">{[["largest", "Más gasto"], ["increase", "Mayor incremento"], ["reduction", "Menor gasto"]].map(([key, label]) => <button type="button" key={key} aria-pressed={mode === key} onClick={() => { setMode(key); setLimit(10); }}>{label}</button>)}</div>
    {!rows.length ? <p className="statistics-empty-inline">{mode === "largest" ? "No hay gastos en este período y moneda." : !report.previous_movement_count ? "No hay movimientos en el período anterior para comparar categorías." : mode === "increase" ? "No hay categorías con un gasto mayor al del intervalo anterior." : "No hay categorías con un gasto menor al del intervalo anterior."}</p> : <><p className="statistics-table-note">Importes en {report.currency_code}. La participación usa el gasto del período elegido; las subcategorías no se suman otra vez.</p><div className="statistics-table-scroll" tabIndex={0} role="region" aria-label="Comparación de gastos por categorías"><table><caption className="sr-only">Gasto actual, anterior y variación por categoría en {report.currency_code}.</caption><thead><tr><th scope="col">Categoría</th><th scope="col">Gasto actual</th><th scope="col">Del total</th><th scope="col">Anterior</th><th scope="col">Variación</th><th scope="col">Detalle</th></tr></thead><tbody>{rows.slice(0, limit).map((c) => {
      const change = comparison(BigInt(c.amount_minor), BigInt(c.previous_amount_minor));
      const hundredths = total ? (BigInt(c.amount_minor) * 10000n + total / 2n) / total : 0n;
      return <tr key={c.id}><th scope="row">{c.name}{(c.children.length > 1 || c.children[0]?.id !== c.id) && <details><summary>Subcategorías</summary><ul>{c.children.map((child) => <li key={child.id}><button type="button" className="statistics-text-button" onClick={() => onCategory(child.id)}>{child.id === c.id ? "Sin subcategoría" : child.name}</button><span>{money(child.amount_minor)}<small>Anterior: {money(child.previous_amount_minor)}</small></span></li>)}</ul></details>}</th><td>{money(c.amount_minor)}</td><td>{hundredths === 0n && BigInt(c.amount_minor) > 0n ? "Menos de 0,01%" : `${(Number(hundredths) / 100).toLocaleString("es-PE", { maximumFractionDigits: 2 })}%`}</td><td>{money(c.previous_amount_minor)}</td><td><span>{change.difference > 0n ? "+" : ""}{money(change.difference)}</span><small>{report.previous_movement_count ? change.percent ?? "Sin base porcentual" : "Sin movimientos anteriores"}</small></td><td><button type="button" className="statistics-text-button" onClick={() => onCategory(c.id)} aria-label={`Ver movimientos de ${c.name}`}>Ver movimientos</button></td></tr>;
    })}</tbody></table></div>{rows.length > limit && <button type="button" className="button button-secondary" onClick={() => setLimit((n) => n + 10)}>Mostrar más categorías</button>}</>}
  </section>;
}
