export function localDateTime(instant: string | Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  const get = (name: string) => parts.find((part) => part.type === name)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// Resolve a wall time in the profile's zone, never the browser's zone. Reject
// nonexistent/ambiguous DST times instead of silently picking another instant.
export function wallTimeToUtc(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Elige una fecha y hora válidas.");
  const nominal = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(nominal)) throw new Error("Elige una fecha y hora válidas.");
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = nominal + hours * 3600000;
    offsets.add(new Date(`${localDateTime(new Date(probe), timezone)}:00Z`).getTime() - probe);
  }
  const candidates = [...offsets].map((offset) => nominal - offset).filter((instant) => localDateTime(new Date(instant), timezone) === value);
  if (candidates.length !== 1) throw new Error(candidates.length ? "Esta hora ocurre dos veces por el cambio de horario. Elige otra hora." : "Esta fecha u hora no existe en tu zona horaria. Elige otra.");
  return new Date(candidates[0]).toISOString();
}

export function monthRange(instant: string, timezone: string): { from: string; to: string } {
  const month = localDateTime(instant, timezone).slice(0, 7);
  const [year, number] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}` };
}
