// Explicit, disposable UI sample. Never persisted or used as a source of real balances.
export type Currency = "PEN" | "USD";
export type DemoAccount = { id: string; name: string; type: string; currency: Currency; openingMinor: string };
export type DemoMovement = { id: string; accountId: string; kind: "income" | "expense"; amountMinor: string; description: string; category: string; date: string };
export const SAMPLE_CUTOFF = "2026-11-14";
export const SAMPLE_MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
export const CATEGORIES = { income: ["Sueldo", "Trabajo independiente", "Otros ingresos"], expense: ["Alimentación", "Vivienda", "Transporte", "Servicios", "Ocio", "Otros gastos"] };

export function parseMinor(value: string, signed = false): bigint {
  const normalized = value.trim();
  if (!(signed ? /^-?\d{1,9}(?:[.,]\d{1,2})?$/ : /^\d{1,9}(?:[.,]\d{1,2})?$/).test(normalized)) throw new Error("Usa un importe de hasta 9 dígitos y 2 decimales.");
  const negative = normalized.startsWith("-");
  const [whole, cents = ""] = normalized.replace("-", "").split(/[.,]/);
  const amount = BigInt(whole) * 100n + BigInt(cents.padEnd(2, "0"));
  if (!signed && amount <= 0n) throw new Error("El importe debe ser mayor que cero.");
  return negative ? -amount : amount;
}
export function decimal(minor: bigint): string {
  const absolute = minor < 0n ? -minor : minor;
  return `${minor < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
export function money(minor: bigint, currency: Currency): string {
  const absolute = minor < 0n ? -minor : minor;
  const whole = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(absolute / 100n);
  return `${minor < 0n ? "−" : ""}${currency === "PEN" ? "S/" : "US$"} ${whole}.${String(absolute % 100n).padStart(2, "0")}`;
}
export function createSample(): { accounts: DemoAccount[]; movements: DemoMovement[] } {
  const accounts: DemoAccount[] = [
    { id: "bank", name: "Cuenta del día a día", type: "Bancaria", currency: "PEN", openingMinor: "480000" },
    { id: "savings", name: "Ahorros personales", type: "Ahorros", currency: "PEN", openingMinor: "250000" },
    { id: "cash", name: "Efectivo", type: "Efectivo", currency: "PEN", openingMinor: "35000" },
    { id: "dollars", name: "Ahorros en dólares", type: "Ahorros", currency: "USD", openingMinor: "100000" }
  ];
  const movements = SAMPLE_MONTHS.flatMap((month, index): DemoMovement[] => [
    { id: `${month}-salary`, accountId: "bank", kind: "income", amountMinor: "420000", description: "Sueldo mensual", category: "Sueldo", date: `${month}-01` },
    { id: `${month}-freelance`, accountId: "bank", kind: "income", amountMinor: (35000n + BigInt(index) * 5000n).toString(), description: "Proyecto independiente", category: "Trabajo independiente", date: `${month}-04` },
    { id: `${month}-rent`, accountId: "bank", kind: "expense", amountMinor: "140000", description: "Alquiler del departamento", category: "Vivienda", date: `${month}-03` },
    { id: `${month}-food`, accountId: "bank", kind: "expense", amountMinor: (60500n + BigInt(index) * 950n).toString(), description: "Compras del supermercado", category: "Alimentación", date: `${month}-08` },
    { id: `${month}-services`, accountId: "bank", kind: "expense", amountMinor: "28500", description: "Internet y servicios", category: "Servicios", date: `${month}-10` },
    { id: `${month}-transport`, accountId: "cash", kind: "expense", amountMinor: "4500", description: "Transporte de la semana", category: "Transporte", date: `${month}-11` },
    { id: `${month}-leisure`, accountId: "bank", kind: "expense", amountMinor: (19000n + BigInt(index) * 1250n).toString(), description: "Una salida con amigos", category: "Ocio", date: `${month}-12` },
    { id: `${month}-usd-in`, accountId: "dollars", kind: "income", amountMinor: "32000", description: "Trabajo independiente", category: "Trabajo independiente", date: `${month}-02` },
    { id: `${month}-usd-out`, accountId: "dollars", kind: "expense", amountMinor: "4500", description: "Herramientas de trabajo", category: "Servicios", date: `${month}-09` }
  ]);
  return { accounts, movements };
}
export function balance(account: DemoAccount, movements: DemoMovement[]): bigint {
  return movements.filter((m) => m.accountId === account.id && m.date >= "2026-06-01" && m.date <= SAMPLE_CUTOFF).reduce((total, m) => total + BigInt(m.amountMinor) * (m.kind === "income" ? 1n : -1n), BigInt(account.openingMinor));
}
export function summarize(accounts: DemoAccount[], movements: DemoMovement[], currency: Currency, month: string) {
  const owned = accounts.filter((a) => a.currency === currency);
  const ids = new Set(owned.map((a) => a.id));
  const scoped = movements.filter((m) => ids.has(m.accountId) && m.date >= "2026-06-01" && m.date <= SAMPLE_CUTOFF);
  const period = scoped.filter((m) => m.date.startsWith(month));
  const income = period.filter((m) => m.kind === "income").reduce((sum, m) => sum + BigInt(m.amountMinor), 0n);
  const expense = period.filter((m) => m.kind === "expense").reduce((sum, m) => sum + BigInt(m.amountMinor), 0n);
  const categories = CATEGORIES.expense.map((name) => ({ name, amount: period.filter((m) => m.kind === "expense" && m.category === name).reduce((sum, m) => sum + BigInt(m.amountMinor), 0n) })).filter((c) => c.amount > 0n).sort((a, b) => a.amount === b.amount ? a.name.localeCompare(b.name, "es") : a.amount > b.amount ? -1 : 1);
  const shares = categories.map((c, index) => ({ index, value: Number(c.amount * 100n / expense), remainder: c.amount * 100n % expense }));
  const missing = 100 - shares.reduce((sum, c) => sum + c.value, 0);
  [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1).slice(0, missing).forEach((c) => { c.value += 1; });
  return { accounts: owned, movements: period, income, expense, net: income - expense, total: owned.reduce((sum, a) => sum + balance(a, scoped), 0n), categories: categories.map((c, index) => ({ ...c, share: shares[index].value })) };
}
export function sampleCsv(accounts: DemoAccount[], movements: DemoMovement[]): string {
  const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  const lines = [["Datos simulados Finzi", "Fecha", "Descripción", "Tipo", "Categoría", "Cuenta", "Moneda", "Importe"]];
  for (const m of movements) {
    const account = accounts.find((a) => a.id === m.accountId);
    if (account) lines.push(["Muestra", m.date, m.description, m.kind === "income" ? "Ingreso" : "Gasto", m.category, account.name, account.currency, decimal(BigInt(m.amountMinor))]);
  }
  return "\uFEFF" + lines.map((row) => row.map(cell).join(",")).join("\r\n");
}

export function newSampleMovement(input: { accountId: string; kind: "income" | "expense"; amount: string; description: string; category: string; date: string }, accounts: DemoAccount[]): DemoMovement {
  if (!accounts.some((a) => a.id === input.accountId)) throw new Error("Elige una cuenta de la muestra.");
  if (!CATEGORIES[input.kind]?.includes(input.category)) throw new Error("Elige una categoría válida.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date + "T12:00:00Z").toISOString().slice(0, 10) !== input.date || input.date < "2026-06-01" || input.date > SAMPLE_CUTOFF) throw new Error("Elige una fecha entre el 1 de junio y el 14 de noviembre de 2026.");
  const description = input.description.trim();
  if (!description || description.length > 120) throw new Error("Escribe una descripción de hasta 120 caracteres.");
  return { id: crypto.randomUUID(), accountId: input.accountId, kind: input.kind, amountMinor: parseMinor(input.amount).toString(), description, category: input.category, date: input.date };
}
