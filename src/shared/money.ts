export type Currency = "PEN" | "USD";
export function openingMinor(value: string): bigint {
  const text = value.trim();
  if (!/^-?\d{1,16}(?:[.,]\d{1,2})?$/.test(text)) throw new Error("Usa hasta 16 dígitos y 2 decimales, sin separadores de miles.");
  const [whole, cents = ""] = text.replace("-", "").split(/[.,]/);
  const minor = BigInt(whole) * 100n + BigInt(cents.padEnd(2, "0"));
  return text.startsWith("-") ? -minor : minor;
}
export function decimalMoney(minor: bigint): string {
  const absolute = minor < 0n ? -minor : minor;
  return `${minor < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
export function formatMoney(minor: bigint, currency: Currency): string {
  const absolute = minor < 0n ? -minor : minor;
  return `${minor < 0n ? "−" : ""}${currency === "PEN" ? "S/" : "US$"} ${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(absolute / 100n)}.${String(absolute % 100n).padStart(2, "0")}`;
}
