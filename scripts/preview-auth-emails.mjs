import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

// Synthetic rendering only: no live tokens, SMTP, Supabase or external assets.
const destination = ".impeccable/review/auth-emails";
function luminance(rgb) {
  const linear = rgb.slice(0, 3).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(a, b) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}
mkdirSync(destination, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chromium") });
try {
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  for (const name of ["confirmation", "recovery", "email-change"]) {
    const html = readFileSync(`supabase/templates/${name}.html`, "utf8")
      .replaceAll("{{ .SiteURL }}", "https://finzi.example.invalid")
      .replaceAll("{{ .TokenHash }}", "a".repeat(56))
      .replaceAll("{{ .ConfirmationURL }}", "https://auth.example.invalid/auth/v1/verify?token=" + "b".repeat(56) + "&amp;type=email_change")
      .replaceAll("{{ .NewEmail }}", "nuevo@example.test");
    assert(!html.includes("{{"));
    for (const width of [320, 800]) for (const colorScheme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Email overflows viewport");
      const action = await page.locator("a.action").boundingBox();
      assert(action && action.height >= 44, "CTA must remain usable on mobile");
      const accent = await page.locator(".brand-accent").evaluate(element => ({
        foreground: getComputedStyle(element).color.match(/[\d.]+/g).map(Number),
        background: getComputedStyle(element.closest(".panel")).backgroundColor.match(/[\d.]+/g).map(Number),
      }));
      assert(contrast(accent.foreground, accent.background) >= 4.5, "Wordmark accent must remain legible in both themes");
      await page.screenshot({ path: join(destination, `${name}-${width}-${colorScheme}.png`), fullPage: true });
    }
  }
  console.log("Auth email previews: 12 responsive/light/dark views passed. Synthetic data only; no network requests.");
} finally { await browser.close(); }
