"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, ArrowRight, BriefcaseBusiness, ChevronDown, Download, Eye, EyeOff, FlaskConical, Home, LayoutGrid, ListFilter, Menu, Plus, Search, Settings2, ShieldCheck, ShoppingBasket, TrainFront, Utensils, Wallet, X, type LucideIcon } from "lucide-react";
import { FinziMark } from "@/modules/identity/presentation/auth-shell";
import { AccountsWorkspace, type Account } from "@/modules/accounts";
import type { FinancialProfile } from "@/modules/identity/domain/profile";
import { balance, CATEGORIES, createSample, decimal, money, newSampleMovement, parseMinor, SAMPLE_CUTOFF, SAMPLE_MONTHS, sampleCsv, summarize, type Currency, type DemoAccount, type DemoMovement } from "../domain/demo";

type View = "home" | "movements" | "accounts";
const colors = ["#1d4ed8", "#52a4d7", "#8395c4", "#e3a763", "#26365a", "#b2bfd8"];
const icons: Record<string, LucideIcon> = { Vivienda: Home, Alimentación: ShoppingBasket, Transporte: TrainFront, Ocio: Utensils, Servicios: Settings2, Sueldo: BriefcaseBusiness };
const monthName = (month: string, short = false) => new Intl.DateTimeFormat("es-PE", { month: short ? "short" : "long", timeZone: "UTC" }).format(new Date(month + "-01T12:00:00Z")).replace(".", "");
const dateName = (date: string) => new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
const percentage = (amount: bigint, total: bigint) => total === 0n ? 0 : Number(amount * 10000n / total) / 100;

export function DashboardHome({ profile, demo, realAccounts }: { profile: FinancialProfile; demo: boolean; realAccounts: Account[] }) {
  const router = useRouter();
  const [sample, setSample] = useState(createSample);
  const [currency, setCurrency] = useState<Currency>(profile.preferred_currency ?? "PEN");
  const [month, setMonth] = useState("2026-11");
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [hidden, setHidden] = useState(false);
  const [notice, setNotice] = useState("");
  const [changingMode, startTransition] = useTransition();
  const navDialog = useRef<HTMLDialogElement>(null);
  const movementDialog = useRef<HTMLDialogElement>(null);
  const accountDialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [editing, setEditing] = useState<DemoAccount | null>(null);
  const [movementSession, setMovementSession] = useState(0);
  useEffect(() => { if (editing && !accountDialog.current?.open) accountDialog.current?.showModal(); }, [editing]);
  const summary = summarize(sample.accounts, sample.movements, currency, month);
  const display = (amount: bigint) => hidden ? "••••••" : money(amount, currency);
  const movements = summary.movements.filter((m) => (kindFilter === "all" || m.kind === kindFilter) && `${m.description} ${m.category} ${sample.accounts.find((a) => a.id === m.accountId)?.name}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es"))).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const chart = SAMPLE_MONTHS.map((value) => ({ month: value, ...summarize(sample.accounts, sample.movements, currency, value) }));
  const maxBar = chart.reduce((max, point) => [max, point.income, point.expense].reduce((a, b) => a > b ? a : b), 1n);

  function go(next: View) {
    setView(next); setQuery(""); setKindFilter("all"); navDialog.current?.close();
    requestAnimationFrame(() => heading.current?.focus());
  }
  function setDemo(enabled: boolean) {
    setSample(createSample()); setView("home"); setQuery(""); setNotice(""); setKindFilter("all");
    startTransition(() => router.replace(enabled ? "/dashboard?demo=1" : "/dashboard", { scroll: false }));
  }
  function exportSample() {
    const blob = new Blob([sampleCsv(sample.accounts, movements)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = `finzi-muestra-${currency}-${month}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Se descargó la muestra del período y los filtros actuales.");
  }
  function addMovement(movement: DemoMovement) {
    const account = sample.accounts.find((a) => a.id === movement.accountId)!;
    setSample((previous) => ({ ...previous, movements: [...previous.movements, movement] }));
    setCurrency(account.currency); setMonth(movement.date.slice(0, 7)); setQuery(""); setKindFilter("all");
    setNotice("Movimiento de prueba añadido. Los importes de la muestra se actualizaron.");
    movementDialog.current?.close();
  }
  function editAccount(account: DemoAccount) { setEditing(account); }
  const navigation = <>
    <nav className="home-nav" aria-label="Navegación principal">
      {([["home", "Inicio", LayoutGrid], ["movements", "Movimientos", ArrowDownLeft], ["accounts", "Cuentas", Wallet]] as const).map(([key, label, Icon]) => <button key={key} type="button" aria-current={view === key ? "page" : undefined} onClick={() => go(key)}><Icon size={19} aria-hidden="true" />{label}{view === key && <span className="nav-dot" />}</button>)}
    </nav>
    <div className="home-nav-secondary"><Link href="/onboarding?edit=1"><Settings2 size={19} aria-hidden="true" />Mi perfil</Link><Link href="/session"><ShieldCheck size={19} aria-hidden="true" />Sesión y seguridad</Link></div>
  </>;

  function accountsPanel(full = false) {
    return <section className={`home-panel accounts-panel ${full ? "accounts-full" : ""}`} aria-labelledby="accounts-title">
      <div className="panel-heading"><h2 id="accounts-title">Mis cuentas</h2>{!full && <button className="home-text-button" onClick={() => go("accounts")}>Ver cuentas<ArrowRight size={15} aria-hidden="true" /></button>}</div>
      <p className="panel-caption">Cuentas de ejemplo en {currency}</p>
      <div className="sample-accounts">{summary.accounts.map((account) => <button className="sample-account" key={account.id} onClick={() => editAccount(account)} aria-label={`Editar saldo inicial de prueba de ${account.name}`}>
        <span className="account-symbol"><Wallet size={19} aria-hidden="true" /></span><span className="account-name"><strong>{account.name}</strong><small>{account.type}</small></span><span className="account-value"><strong>{display(balance(account, sample.movements))}</strong><small>Editar apertura</small></span>
      </button>)}</div>
      <p className="account-explanation">El saldo incluye la apertura y todos los movimientos de la muestra hasta el 14 nov. No cambia con el filtro mensual.</p>
    </section>;
  }
  function movementPanel(full = false) {
    const listed = full ? movements : movements.slice(0, 5);
    return <section className="home-panel movements-panel" aria-labelledby="movements-title"><div className="panel-heading"><h2 id="movements-title">{full ? "Movimientos del período" : "Últimos movimientos"}</h2>{!full && <button className="home-text-button" onClick={() => go("movements")}>Ver todos<ArrowRight size={15} aria-hidden="true" /></button>}</div>
      {full && <div className="movement-filters"><label><ListFilter size={16} aria-hidden="true" /><span>Tipo</span><select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}><option value="all">Todos</option><option value="income">Ingresos</option><option value="expense">Gastos</option></select></label><span>{movements.length} resultados</span><button className="home-text-button" onClick={exportSample}><Download size={16} aria-hidden="true" />Descargar muestra CSV</button></div>}
      {listed.length ? <div className="movement-table"><table><thead><tr><th scope="col">Movimiento</th><th scope="col">Fecha</th><th scope="col">Cuenta</th><th scope="col">Importe</th></tr></thead><tbody>{listed.map((movement) => { const Icon = icons[movement.category] ?? Wallet; return <tr key={movement.id}><td><div className="movement-description"><span className={`movement-icon ${movement.kind}`}><Icon size={18} aria-hidden="true" /></span><span><strong>{movement.description}</strong><small>{movement.category}</small></span></div></td><td>{dateName(movement.date)}</td><td>{sample.accounts.find((a) => a.id === movement.accountId)?.name}</td><td className={`movement-amount ${movement.kind}`}>{hidden ? "••••••" : `${movement.kind === "income" ? "+" : "−"}${money(BigInt(movement.amountMinor), currency)}`}</td></tr>; })}</tbody></table></div> : <div className="home-no-results"><Search size={28} aria-hidden="true" /><h3>No hay movimientos con estos filtros.</h3><p>Prueba otra búsqueda o cambia el período.</p><button className="home-text-button" onClick={() => { setQuery(""); setKindFilter("all"); }}>Limpiar búsqueda y tipo</button></div>}
      {!full && <p className="table-footnote">Solo movimientos de muestra de {monthName(month)} de 2026.</p>}
    </section>;
  }

  return <div className="home-app">
    <a className="skip-link" href="#home-main">Saltar al contenido</a>
    <aside className="home-sidebar"><Link href={demo ? "/dashboard?demo=1" : "/dashboard"} onClick={() => go("home")} className="wordmark" aria-label="Finzi, inicio"><FinziMark /><span>finzi</span></Link>{navigation}<div className="sidebar-foot"><span className="sidebar-illustration" aria-hidden="true"><Wallet size={25} /></span><p>Una moneda a la vez.<small>PEN y USD, siempre por separado.</small></p></div><span className="sidebar-free">Gratuita. Sin publicidad.</span></aside>
    <div className="home-body">
      <header className="home-topbar"><button type="button" className="home-icon-button mobile-nav-trigger" onClick={() => navDialog.current?.showModal()} aria-label="Abrir navegación"><Menu size={21} /></button><span className="home-breadcrumb">Mi espacio<span aria-hidden="true">/</span><strong>{view === "home" ? "Inicio" : view === "movements" ? "Movimientos" : "Cuentas"}</strong></span>
        {demo && <label className="home-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Buscar movimientos</span><input type="search" placeholder="Buscar movimientos" value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value) setView("movements"); }} /></label>}
        <details className="home-profile"><summary><span className="home-avatar" aria-hidden="true">{profile.display_name?.split(/\s+/).map((part) => Array.from(part)[0] ?? "").slice(0, 2).join("").toUpperCase()}</span><span className="profile-name">{profile.display_name}</span><ChevronDown size={15} aria-hidden="true" /><span className="sr-only">Abrir menú de perfil</span></summary><div className="profile-popover"><Link href="/onboarding?edit=1">Editar mi perfil</Link><Link href="/session">Gestionar mi sesión</Link></div></details>
      </header>
      <main className="home-main" id="home-main">
        <div className="home-title-row"><div><h1 ref={heading} tabIndex={-1}>{view === "home" ? `Hola, ${profile.display_name}.` : view === "movements" ? "Tus movimientos." : "Tus cuentas."}</h1><p>{view === "home" ? "Un vistazo a tu dinero, con todo en su lugar." : view === "movements" ? "Encuentra los detalles detrás de cada importe." : "Cada cuenta tiene su propio punto de partida."}</p></div>{demo && <button className="home-primary-button" onClick={() => movementDialog.current?.showModal()}><Plus size={18} aria-hidden="true" />Añadir movimiento de prueba</button>}</div>
        {demo ? <>
          <div className="demo-banner"><span className="demo-badge"><FlaskConical size={16} aria-hidden="true" />Datos de prueba</span><p>Esta muestra no representa tus finanzas. Los cambios se reinician al recargar.</p><button disabled={changingMode} onClick={() => setDemo(false)}>Salir de la muestra<ArrowRight size={15} aria-hidden="true" /></button></div>
          <div className="home-controls"><div className="currency-switch" role="group" aria-label="Moneda del dashboard">{(["PEN", "USD"] as const).map((code) => <button key={code} aria-pressed={currency === code} onClick={() => setCurrency(code)}>{code === "PEN" ? "S/" : "US$"}<span>{code}</span></button>)}</div><label className="period-select"><span>Período</span><select value={month} onChange={(e) => setMonth(e.target.value)}>{[...SAMPLE_MONTHS].reverse().map((value) => <option key={value} value={value}>{monthName(value)} 2026</option>)}</select><ChevronDown size={16} aria-hidden="true" /></label><button className="home-icon-button visibility-button" onClick={() => setHidden(!hidden)} aria-label={hidden ? "Mostrar importes" : "Ocultar importes"}>{hidden ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          {view === "home" ? <>
            <section className="summary-grid" aria-label="Resumen de muestra"><article className="balance-card"><div className="balance-title"><h2>Saldo actual</h2><Wallet size={21} aria-hidden="true" /></div><p className="balance-figure">{display(summary.total)}</p><span>En {summary.accounts.length} {summary.accounts.length === 1 ? "cuenta" : "cuentas"} de prueba · {currency}</span><div className="balance-bottom"><small>Al 14 nov. 2026</small><button onClick={() => go("accounts")}>Ver cuentas<ArrowUpRight size={16} aria-hidden="true" /></button></div></article>
            <article className="home-panel stat-card"><span className="stat-icon income"><ArrowDownLeft size={20} aria-hidden="true" /></span><h2>Ingresos del mes</h2><p>{display(summary.income)}</p><div className="stat-footer"><small>{summary.movements.filter((m) => m.kind === "income").length} ingresos en {monthName(month)}</small><button aria-label="Ver ingresos" onClick={() => { go("movements"); setKindFilter("income"); }}><ArrowUpRight size={17} /></button></div></article>
            <article className="home-panel stat-card"><span className="stat-icon expense"><ArrowUpRight size={20} aria-hidden="true" /></span><h2>Gastos del mes</h2><p>{display(summary.expense)}</p><div className="stat-footer"><small>{summary.movements.filter((m) => m.kind === "expense").length} gastos en {monthName(month)}</small><button aria-label="Ver gastos" onClick={() => { go("movements"); setKindFilter("expense"); }}><ArrowUpRight size={17} /></button></div></article></section>
            <div className="analytics-grid"><section className="home-panel cashflow-panel" aria-labelledby="cashflow-title"><div className="panel-heading"><h2 id="cashflow-title">Tu dinero en movimiento</h2><span className="chart-range">Jun – nov 2026</span></div><div className="cashflow-subheading"><div><span>Flujo de {monthName(month)}</span><strong className={summary.net >= 0n ? "income" : "expense"}>{display(summary.net)}</strong></div><div className="chart-legend"><span><i />Ingresos</span><span><i />Gastos</span></div></div><div className="bar-chart" aria-label="Ingresos y gastos por mes">{chart.map((point) => <button key={point.month} className={`month-bar ${point.month === month ? "selected" : ""}`} onClick={() => setMonth(point.month)} aria-pressed={point.month === month} aria-label={`${monthName(point.month)}: ${hidden ? "importes ocultos" : `ingresos ${money(point.income, currency)}, gastos ${money(point.expense, currency)}`}`}><span className="bar-pair"><i style={{ height: `${percentage(point.income, maxBar)}%` }} /><i style={{ height: `${percentage(point.expense, maxBar)}%` }} /></span><span>{monthName(point.month, true)}</span><span className="bar-tooltip">{hidden ? "Importes ocultos" : `${money(point.income, currency)} / ${money(point.expense, currency)}`}</span></button>)}</div><p className="chart-note">Ingresos menos gastos del mes. El saldo actual incluye las aperturas.</p></section>
            <section className="home-panel category-panel" aria-labelledby="categories-title"><div className="panel-heading"><h2 id="categories-title">¿En qué se va?</h2><span className="chart-range">{monthName(month)}</span></div><div className="category-body"><div className="donut-chart"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="46" fill="none" stroke="#eef1f7" strokeWidth="13" />{summary.categories.map((category, index) => <circle key={category.name} cx="60" cy="60" r="46" pathLength="100" fill="none" stroke={colors[index % colors.length]} strokeWidth="13" strokeDasharray={`${percentage(category.amount, summary.expense)} ${100 - percentage(category.amount, summary.expense)}`} strokeDashoffset={-percentage(summary.categories.slice(0, index).reduce((sum, c) => sum + c.amount, 0n), summary.expense)} transform="rotate(-90 60 60)" />)}</svg><div className="donut-center"><span>Gastos del mes</span><strong>{display(summary.expense)}</strong></div></div><ul className="category-legend">{summary.categories.map((category, index) => <li key={category.name}><span className="category-dot" style={{ background: colors[index % colors.length] }} /><span>{category.name}</span><strong>{hidden ? "•••" : `${category.share}%`}</strong></li>)}{!summary.categories.length && <li>Sin gastos en este período.</li>}</ul></div></section></div>
            <div className="details-grid">{movementPanel()}{accountsPanel()}</div>
          </> : view === "movements" ? movementPanel(true) : accountsPanel(true)}
        </> : <AccountsWorkspace preferredCurrency={profile.preferred_currency ?? "PEN"} initialAccounts={realAccounts} timezone={profile.timezone ?? "UTC"} view={view} onViewAccounts={() => go("accounts")} onExplore={() => setDemo(true)} />}
        <div className="home-status" role="status" aria-live="polite">{notice}</div>
        <footer className="home-footer"><span>{demo ? "Muestra de junio a noviembre de 2026. No se guarda en tus cuentas." : "Datos reales. Aperturas separadas de ingresos."}</span><span>{demo ? `${currency} · Sin conversión automática` : "PEN y USD · Sin conversión automática"}</span></footer>
      </main>
    </div>
    <dialog ref={navDialog} className="home-nav-dialog" aria-label="Navegación principal"><div className="dialog-heading"><span className="wordmark"><FinziMark /><span>finzi</span></span><button className="home-icon-button" onClick={() => navDialog.current?.close()} aria-label="Cerrar navegación"><X size={21} /></button></div>{navigation}</dialog>
    <dialog ref={movementDialog} className="sample-dialog" aria-labelledby="movement-dialog-title" onClose={() => setMovementSession((previous) => previous + 1)}><MovementForm key={`${movementSession}-${currency}-${month}`} defaultDate={`${month}-14`} accounts={sample.accounts.filter((a) => a.currency === currency)} onClose={() => movementDialog.current?.close()} onSave={addMovement} /></dialog>
    <dialog ref={accountDialog} className="sample-dialog" aria-labelledby="account-dialog-title" onClose={() => setEditing(null)}>{editing && <OpeningForm key={editing.id} account={editing} onClose={() => accountDialog.current?.close()} onSave={(openingMinor) => { setSample((previous) => ({ ...previous, accounts: previous.accounts.map((a) => a.id === editing.id ? { ...a, openingMinor } : a) })); accountDialog.current?.close(); setNotice("Saldo inicial de prueba actualizado. No se registró como ingreso."); }} />}</dialog>
  </div>;
}

function MovementForm({ accounts, defaultDate, onSave, onClose }: { defaultDate: string; accounts: DemoAccount[]; onSave: (m: DemoMovement) => void; onClose: () => void }) {
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [category, setCategory] = useState(CATEGORIES.expense[0]);
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { const movement = newSampleMovement({ kind, accountId: String(data.get("accountId")), amount: String(data.get("amount")), description: String(data.get("description")), category, date: String(data.get("date")) }, accounts); onSave(movement); event.currentTarget.reset(); setError(""); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "Revisa los campos."); const amount = event.currentTarget.elements.namedItem("amount"); if (amount instanceof HTMLElement) amount.focus(); }
  }
  return <><div className="dialog-heading"><div><span className="dialog-context">Datos de prueba</span><h2 id="movement-dialog-title">Añadir movimiento</h2></div><button type="button" className="home-icon-button" onClick={onClose} aria-label="Cerrar formulario"><X size={20} /></button></div><p className="dialog-description">Solo cambia esta muestra. No registra operaciones en tus cuentas.</p><form method="dialog" className="sample-form" onSubmit={submit}><fieldset className="movement-kind"><legend>Tipo de movimiento</legend>{([['expense', 'Gasto'], ['income', 'Ingreso']] as const).map(([value, label]) => <label key={value}><input type="radio" name="kind" value={value} checked={kind === value} onChange={() => { setKind(value); setCategory(CATEGORIES[value][0]); }} /><span>{label}</span></label>)}</fieldset><div className="field"><label htmlFor="sample-description">Descripción</label><input id="sample-description" name="description" required maxLength={120} placeholder="Por ejemplo, compra del mercado" /></div><div className="sample-form-row"><div className="field"><label htmlFor="sample-amount">Importe en {accounts[0]?.currency}</label><input id="sample-amount" name="amount" required inputMode="decimal" placeholder="0.00" aria-invalid={Boolean(error)} aria-describedby={error ? "sample-form-error" : undefined} onChange={() => setError("")} /></div><div className="field"><label htmlFor="sample-date">Fecha de la muestra</label><input id="sample-date" name="date" type="date" required min="2026-06-01" max={SAMPLE_CUTOFF} defaultValue={defaultDate} /></div></div><div className="field"><label htmlFor="sample-account">Cuenta de prueba</label><select id="sample-account" name="accountId">{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></div><div className="field"><label htmlFor="sample-category">Categoría</label><select id="sample-category" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES[kind].map((name) => <option key={name}>{name}</option>)}</select></div><p id="sample-form-error" className="field-error" role="alert">{error}</p><div className="sample-form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit">Añadir a la muestra</button></div></form></>;
}
function OpeningForm({ account, onSave, onClose }: { account: DemoAccount; onSave: (minor: string) => void; onClose: () => void }) {
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); try { onSave(parseMinor(String(new FormData(event.currentTarget).get("opening")), true).toString()); setError(""); } catch (problem) { setError(problem instanceof Error ? problem.message : "Revisa el importe."); const input = event.currentTarget.elements.namedItem("opening"); if (input instanceof HTMLElement) input.focus(); } }
  return <><div className="dialog-heading"><div><span className="dialog-context">Cuenta de prueba</span><h2 id="account-dialog-title">Saldo inicial</h2></div><button type="button" className="home-icon-button" onClick={onClose} aria-label="Cerrar saldo inicial"><X size={20} /></button></div><p className="dialog-description">{account.name}. La apertura es al 1 jun. 2026; no se contará como ingreso. Puedes usar cero o un valor negativo.</p><form method="dialog" onSubmit={submit} className="sample-form"><div className="field"><label htmlFor="sample-opening">Saldo inicial en {account.currency}</label><input id="sample-opening" name="opening" key={account.openingMinor} required inputMode="decimal" defaultValue={decimal(BigInt(account.openingMinor))} /></div><p className="field-error" role="alert">{error}</p><div className="sample-form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary">Guardar saldo de prueba</button></div></form></>;
}
