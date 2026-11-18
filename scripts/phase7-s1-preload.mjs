import { Server } from "node:http";
import { readFileSync } from "node:fs";
import { wrapPilotFetch } from "./phase7-s1-policy.mjs";
const bridge = process.env.FINZI_S1_BRIDGE, token = process.env.FINZI_S1_GUARD;
if (bridge !== "http://127.0.0.1:3031" || !/^[a-f0-9]{64}$/.test(token ?? "")) throw new Error("PILOT_PRELOAD_INVALID");
const nativeFetch = globalThis.fetch;
globalThis.fetch = wrapPilotFetch(nativeFetch, bridge, token);
const original = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
  if (event === "request") {
    const [req, res] = args, path = new URL(req.url, "http://127.0.0.1:3030").pathname;
    if (path === "/dashboard" && process.env.FINZI_S1_STATE_FILE) {
      let verified = false;
      try { const state = JSON.parse(readFileSync(process.env.FINZI_S1_STATE_FILE, "utf8")); verified = !state.stopped && state.loginVerified === true; } catch { /* No dashboard data during this pilot. */ }
      res.writeHead(verified ? 200 : 403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(verified ? "Acceso con la nueva contraseña verificado. El piloto no abre datos financieros. Avisa al operador para cerrar la prueba." : "El piloto no permite acceder al dashboard financiero."); return true;
    }
    if (process.env.FINZI_S1_STATE_FILE && !path.startsWith("/_next/") && !path.startsWith("/__nextjs")) {
      let paused = true, stopped = true;
      try { const state = JSON.parse(readFileSync(process.env.FINZI_S1_STATE_FILE, "utf8")); stopped = state.stopped; paused = stopped || state.cpuGate.paused; } catch { /* Fail closed without running Next's session redirect. */ }
      if (paused) {
        res.writeHead(503, { "content-type": req.method === "POST" ? "application/json" : "text/plain; charset=utf-8", "cache-control": "no-store" });
        const message = stopped ? "Piloto detenido por un control de seguridad o presupuesto. Espera la revisión del operador; no solicites otro correo." : "Piloto en pausa por CPU. Espera la confirmación del operador y vuelve a esta misma página; no solicites otro correo.";
        res.end(req.method === "POST" ? JSON.stringify({ ok: false, code: stopped ? "PILOT_STOPPED" : "CPU_PAUSED", message }) : message);
        return true;
      }
    }
    const allowedGet = ["/", "/register", "/login", "/forgot-password", "/verify-email", "/auth/confirm", "/onboarding", "/reset-password", "/session", "/api/v1/auth/session", "/favicon.ico", "/icon.svg"].includes(path) || path.startsWith("/_next/") || path.startsWith("/__nextjs");
    const allowedPost = ["register", "verify", "forgot-password", "reset-password", "logout", "login"].some(a => path === "/api/v1/auth/" + a);
    if (!(req.method === "GET" || req.method === "HEAD" ? allowedGet : req.method === "POST" && allowedPost)) {
      res.writeHead(403); res.end("This route is outside the authorized S1 pilot."); return true;
    }
    if (!path.startsWith("/_next/") && !path.startsWith("/__nextjs")) res.once("finish", () => {
      const cookies = res.getHeader("set-cookie"), list = Array.isArray(cookies) ? cookies : cookies ? [String(cookies)] : [];
      const session = list.filter(c => /^sb-[\w-]+-auth-token(?:\.\d+)?=/.test(c) && !c.includes("-code-verifier=") && !/auth-token(?:\.\d+)?=;/.test(c));
      const safe = { path, method: req.method, status: res.statusCode,
        sessionCookiePresent: /sb-[\w-]+-auth-token(?:\.\d+)?=/.test(req.headers.cookie ?? ""),
        sessionCookieSet: session.length > 0,
        httpOnly: session.length > 0 && session.every(c => /;\s*HttpOnly/i.test(c)),
        sameSiteLax: session.length > 0 && session.every(c => /;\s*SameSite=Lax/i.test(c)) };
      nativeFetch(bridge + "/observe", { method: "POST", headers: { "x-finzi-s1-guard": token, "content-type": "application/json" }, body: JSON.stringify(safe) }).catch(() => {});
    });
  }
  return original.call(this, event, ...args);
};
