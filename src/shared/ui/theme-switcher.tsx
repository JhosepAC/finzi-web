"use client";
import { useSyncExternalStore } from "react";
import { SunMoon } from "lucide-react";

type Preference = "light" | "dark" | "system";
const key = "finzi-theme";
function preference(): Preference {
  const value = document.documentElement.dataset.themePreference;
  return value === "light" || value === "dark" ? value : "system";
}
function apply(value: Preference) {
  const dark = value === "dark" || value === "system" && matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePreference = value;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#090909" : "#f3f6fc");
  window.dispatchEvent(new Event("finzi-theme-change"));
}
function subscribe(callback: () => void) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const system = () => { if (preference() === "system") apply("system"); };
  const storage = (event: StorageEvent) => { if (event.key === key) apply(event.newValue === "dark" || event.newValue === "light" ? event.newValue : "system"); };
  window.addEventListener("finzi-theme-change", callback); window.addEventListener("storage", storage); media.addEventListener("change", system);
  return () => { window.removeEventListener("finzi-theme-change", callback); window.removeEventListener("storage", storage); media.removeEventListener("change", system); };
}
export function ThemeSwitcher() {
  const value = useSyncExternalStore(subscribe, preference, () => "system");
  return <label className="theme-switcher"><SunMoon size={17} aria-hidden="true"/><span className="sr-only">Tema de la interfaz</span><select value={value} onChange={(event) => {
    const next = event.target.value as Preference;
    try { localStorage.setItem(key, next); } catch { /* The current tab can still change theme. */ }
    document.cookie = `finzi-theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    apply(next);
  }}><option value="system">Sistema</option><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>;
}
