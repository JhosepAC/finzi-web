"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { CalendarClock, ArrowDownLeft, ChevronDown, LayoutGrid, ChartNoAxesCombined, HandCoins, Menu, Settings2, ShieldCheck, Tag, Wallet, X } from "lucide-react";
import { FinziMark } from "@/modules/identity/presentation/auth-shell";
import type { FinancialProfile } from "@/modules/identity/domain/profile";
import { AccountsWorkspace, type Account } from "@/modules/accounts";
import { CategoriesWorkspace } from "@/modules/classification";
import { MovementsWorkspace, type MovementFilters, type MovementHistoryState } from "@/modules/transactions";
import type { OverviewSelection } from "../domain/overview";
import { monthRange } from "@/shared/time";
import { todayInZone } from "@/shared/period";
import { DebtsWorkspace } from "@/modules/debts";
import { StatisticsWorkspace } from "./statistics-workspace";
import type { StatisticsSelection } from "../domain/statistics";
import { FinancialOverview } from "./financial-overview";

import { FixedExpensesWorkspace } from "@/modules/fixed-expenses";
type View = "fixed-expenses" | "home" | "movements" | "accounts" | "categories" | "debts" | "statistics";
export function DashboardHome({ profile, realAccounts, now }: { profile: FinancialProfile; realAccounts: Account[]; now: string }) {
  const [view, setView] = useState<View>("home");
  const [accounts, setAccounts] = useState(realAccounts);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [intent, setIntent] = useState<"income" | "expense" | null>(null);
  const [overviewSelection, setOverviewSelection] = useState<OverviewSelection>(() => ({ currency: profile.preferred_currency ?? "PEN",period: "month",anchor: todayInZone(now,profile.timezone ?? "UTC"),...monthRange(now,profile.timezone ?? "UTC"),accountId: "" }));
  const [statisticsSelection, setStatisticsSelection] = useState<StatisticsSelection>(() => ({ currency: profile.preferred_currency ?? "PEN", period: "month", from: monthRange(now, profile.timezone ?? "UTC").from, to: todayInZone(now, profile.timezone ?? "UTC") }));
  const [historyState, setHistoryState] = useState<MovementHistoryState | null>(null);
  const [createAccount, setCreateAccount] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navDialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const navigationGuard = useRef<() => boolean>(() => true);
  const setGuard = useCallback((guard: () => boolean) => { navigationGuard.current = guard; }, []);
  function go(next: View) {
    if (next !== view && !navigationGuard.current()) return false;
    setView(next); setIntent(null); setCreateAccount(false); navDialog.current?.close();
    requestAnimationFrame(() => heading.current?.focus()); return true;
  }
  async function changed() {
    setRevision((value) => value + 1); setMessage("");
    try {
      const response = await fetch("/api/v1/accounts", { cache: "no-store", signal: AbortSignal.timeout(15000) }); const data = await response.json();
      if (!response.ok || !Array.isArray(data.accounts)) throw new Error();
      setAccounts(data.accounts); return true;
    } catch { setMessage("No pudimos actualizar los saldos. Se conservan los últimos datos; actualízalos desde Cuentas."); return false; }
  }
  function showMovements(focus?: Partial<MovementFilters>, id?: string) {
    if (!go("movements")) return;
    if (focus) { const filters: MovementFilters = { currency: overviewSelection.currency,kind: "",accountId: "",categoryId: "",period: "all",from: "",to: "",query: "",status: "posted",...focus }; setHistoryState({ filters,draftFilters: filters,cursor: null,previous: [],traceId: id ?? null }); }
  }
  const navigation = <><nav className="home-nav" aria-label="Navegación principal">{([['home', 'Inicio', LayoutGrid], ['movements', 'Movimientos', ArrowDownLeft], ['statistics', 'Estadísticas', ChartNoAxesCombined], ['accounts', 'Cuentas', Wallet], ['categories', 'Categorías', Tag], ['debts', 'Deudas', HandCoins], ['fixed-expenses', 'Gastos Fijos', CalendarClock]] as const).map(([key, label, Icon]) => <button key={key} type="button" aria-current={view === key ? "page" : undefined} onClick={() => go(key)}><Icon size={19} aria-hidden="true" />{label}</button>)}</nav><div className="home-nav-secondary"><Link href="/profile"><Settings2 size={19} aria-hidden="true" />Mi perfil</Link><Link href="/security"><ShieldCheck size={19} aria-hidden="true" />Sesión y seguridad</Link><Link href="/data"><Wallet size={19} aria-hidden="true" />Mis datos</Link></div></>;
  return <div className="home-app"><a className="skip-link" href="#home-main">Saltar al contenido</a>
    <aside className="home-sidebar"><Link href="/dashboard" onClick={(event) => { event.preventDefault(); go("home"); }} className="wordmark" aria-label="Finzi, inicio"><FinziMark /><span>finzi</span></Link>{navigation}</aside>
    <div className="home-body"><header className="home-topbar"><button type="button" className="home-icon-button mobile-nav-trigger" aria-expanded={menuOpen} aria-controls="dashboard-navigation" onClick={() => { navDialog.current?.showModal(); setMenuOpen(true); }} aria-label="Abrir navegación"><Menu size={21} /></button><h1 ref={heading} tabIndex={-1} className="home-page-title">{{ home: `Hola, ${profile.display_name}.`, movements: "Tus movimientos.", accounts: "Tus cuentas.", categories: "Tus categorías.", debts: "Tus deudas.", "fixed-expenses": "Tus gastos fijos.", statistics: "Tus estadísticas." }[view]}</h1><details className="home-profile"><summary><span className="home-avatar" aria-hidden="true">{profile.display_name?.split(/\s+/).map((part) => Array.from(part)[0] ?? "").slice(0, 2).join("").toUpperCase()}</span><span className="profile-name">{profile.display_name}</span><ChevronDown size={15} aria-hidden="true" /><span className="sr-only">Abrir menú de perfil</span></summary><div className="profile-popover"><Link href="/profile">Editar mi perfil</Link><Link href="/security">Gestionar mi sesión</Link></div></details></header>
      <main className="home-main" id="home-main">
        {view === "home" ? <FinancialOverview accounts={accounts} timezone={profile.timezone ?? "UTC"} selection={overviewSelection} onSelection={setOverviewSelection} now={now} revision={revision} onRegister={(kind) => { if (go("movements")) setIntent(kind); }} onAccounts={() => go("accounts")} onCreateAccount={() => { if (go("accounts")) setCreateAccount(true); }} onMovements={showMovements} />
          : view === "statistics" ? <StatisticsWorkspace selection={statisticsSelection} onSelection={setStatisticsSelection} timezone={profile.timezone ?? "UTC"} now={now} revision={revision} onMovements={showMovements} /> : view === "accounts" ? <AccountsWorkspace initialAccounts={accounts} preferredCurrency={profile.preferred_currency ?? "PEN"} timezone={profile.timezone ?? "UTC"} onAccountsChange={setAccounts} onChanged={changed} startCreating={createAccount} />
          : view === "fixed-expenses" ? <FixedExpensesWorkspace preferredCurrency={profile.preferred_currency ?? "PEN"} timezone={profile.timezone ?? "UTC"} onChanged={changed} setGuard={setGuard} onMovement={(id, currency) => showMovements({ currency }, id)} /> : view === "debts" ? <DebtsWorkspace accounts={accounts} preferredCurrency={profile.preferred_currency ?? "PEN"} timezone={profile.timezone ?? "UTC"} onChanged={changed} setGuard={setGuard} onAccounts={() => go("accounts")} onCategories={() => go("categories")} onMovement={(id, currency) => showMovements({ currency }, id)} /> : view === "categories" ? <CategoriesWorkspace /> : <MovementsWorkspace accounts={accounts} timezone={profile.timezone ?? "UTC"} preferredCurrency={profile.preferred_currency ?? "PEN"} now={now} initialKind={intent} initialState={historyState} onStateChange={setHistoryState} onChanged={changed} setGuard={setGuard} onAccounts={() => go("accounts")} onCategories={() => go("categories")} />}
        <div className="home-status" role="status" aria-live="polite">{message}</div>
      </main>
    </div><dialog id="dashboard-navigation" ref={navDialog} className="home-nav-dialog" aria-label="Navegación principal" onClose={() => setMenuOpen(false)}><div className="dialog-heading"><span className="wordmark"><FinziMark /><span>finzi</span></span><button className="home-icon-button" onClick={() => navDialog.current?.close()} aria-label="Cerrar navegación"><X size={21} /></button></div>{navigation}</dialog>
  </div>;
}
