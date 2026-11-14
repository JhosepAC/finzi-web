import { authSchemas, getFieldErrors, type AuthAction, type AuthIdentity, type AuthResult } from "../domain/auth";

export type GatewayResult = { error: string | null };
export interface AuthGateway {
  register(email: string, password: string): Promise<GatewayResult>;
  login(email: string, password: string): Promise<GatewayResult>;
  recover(email: string): Promise<GatewayResult>;
  resend(email: string): Promise<GatewayResult>;
  verify(tokenHash: string, type: "signup" | "recovery"): Promise<GatewayResult>;
  identity(): Promise<AuthIdentity | null>;
  recoverySession(): Promise<boolean>;
  updatePassword(password: string): Promise<GatewayResult>;
  logout(scope: "local" | "global"): Promise<GatewayResult>;
  ensureProfile(): Promise<GatewayResult>;
}
export type ServiceResponse = { status: number; body: AuthResult };
const fail = (status: number, code: string, message: string): ServiceResponse => ({ status, body: { ok: false, code, message } });
const success = (message: string, redirectTo?: string, status = 200): ServiceResponse => ({ status, body: { ok: true, message, ...(redirectTo ? { redirectTo } : {}) } });
const unavailable = () => fail(503, "AUTH_UNAVAILABLE", "El acceso no está disponible ahora. Inténtalo de nuevo en unos minutos.");
const registrationMessage = "Si este correo puede registrarse, recibirás un enlace para confirmar tu cuenta. Si ya tienes una, puedes iniciar sesión o recuperar tu contraseña.";
const recoveryMessage = "Si hay una cuenta asociada a este correo, recibirás un enlace para restablecer tu contraseña.";
function rateLimited(error: string | null) { return error === "over_request_rate_limit" || error === "over_email_send_rate_limit" || error === "rate_limit"; }
function providerFailure(error: string | null): ServiceResponse {
  return rateLimited(error) ? fail(429, "TOO_MANY_ATTEMPTS", "Has realizado varios intentos. Espera unos minutos antes de volver a intentarlo.") : unavailable();
}

export async function executeAuth(action: AuthAction, input: unknown, gateway: AuthGateway): Promise<ServiceResponse> {
  const parsed = authSchemas[action].safeParse(input);
  if (!parsed.success) return { status: 422, body: { ok: false, code: "VALIDATION_ERROR", message: "Revisa los campos indicados.", fieldErrors: getFieldErrors(parsed.error) } };
  const data = parsed.data;
  try {
    switch (action) {
      case "register": {
        const { email, password } = data as { email: string; password: string };
        const { error } = await gateway.register(email, password);
        if (error === "weak_password") return { status: 422, body: { ok: false, code: "WEAK_PASSWORD", message: "Elige una contraseña más segura.", fieldErrors: { password: "El proveedor rechazó esta contraseña. Prueba una frase más larga y diferente." } } };
        if (error && !["user_already_exists", "email_exists"].includes(error)) return providerFailure(error);
        return success(registrationMessage, "/verify-email", 202);
      }
      case "login": {
        const { email, password } = data as { email: string; password: string };
        const { error } = await gateway.login(email, password);
        if (rateLimited(error)) return providerFailure(error);
        if (error && !["invalid_credentials", "email_not_confirmed", "user_not_found"].includes(error)) return providerFailure(error);
        if (error) return fail(401, "SIGN_IN_FAILED", "No pudimos iniciar sesión. Revisa el correo, la contraseña y la confirmación de tu cuenta.");
        const user = await gateway.identity();
        if (!user?.verified) {
          await gateway.logout("local");
          return fail(401, "SIGN_IN_FAILED", "No pudimos iniciar sesión. Revisa el correo, la contraseña y la confirmación de tu cuenta.");
        }
        const profile = await gateway.ensureProfile();
        if (profile.error) { await gateway.logout("local"); return unavailable(); }
        return success("Sesión iniciada.", "/dashboard");
      }
      case "forgot-password": {
        const { error } = await gateway.recover((data as { email: string }).email);
        if (error && !["user_not_found", "email_not_found"].includes(error)) return providerFailure(error);
        return success(recoveryMessage, undefined, 202);
      }
      case "resend": {
        const { error } = await gateway.resend((data as { email: string }).email);
        if (error && !["user_not_found", "email_not_found", "email_already_confirmed"].includes(error)) return providerFailure(error);
        return success("Si tu cuenta necesita confirmación, recibirás un nuevo enlace en tu correo.", undefined, 202);
      }
      case "verify": {
        const { tokenHash, type } = data as { tokenHash: string; type: "signup" | "recovery" };
        const { error } = await gateway.verify(tokenHash, type);
        if (error && ["otp_expired", "otp_disabled", "access_denied", "validation_failed", "invalid_credentials"].includes(error)) return fail(400, "INVALID_LINK", "Este enlace no es válido o ya expiró. Solicita uno nuevo.");
        if (error) return providerFailure(error);
        const user = await gateway.identity();
        if (!user?.verified) return fail(401, "INVALID_SESSION", "No se pudo confirmar una sesión válida. Solicita un nuevo enlace.");
        if (type === "recovery") {
          if (!await gateway.recoverySession()) { await gateway.logout("local"); return fail(400, "INVALID_LINK", "No se pudo validar el enlace de recuperación. Solicita uno nuevo."); }
          return success("Enlace verificado.", "/reset-password");
        }
        if ((await gateway.ensureProfile()).error) { await gateway.logout("local"); return unavailable(); }
        return success("Correo confirmado.", "/onboarding");
      }
      case "reset-password": {
        if (!await gateway.identity() || !await gateway.recoverySession()) return fail(401, "RECOVERY_REQUIRED", "El enlace de recuperación expiró. Solicita uno nuevo.");
        const { error } = await gateway.updatePassword((data as { password: string }).password);
        if (error === "same_password") return fail(422, "SAME_PASSWORD", "Elige una contraseña diferente de la anterior.");
        if (error) return providerFailure(error);
        const signedOut = await gateway.logout("global");
        if (signedOut.error) return fail(503, "SIGN_OUT_INCOMPLETE", "La contraseña cambió, pero no pudimos cerrar todas las sesiones. Vuelve a intentar cerrar la sesión.");
        return success("Contraseña actualizada. Inicia sesión con tu nueva contraseña.", "/login?notice=password-updated");
      }
      case "logout": {
        const { error } = await gateway.logout((data as { scope: "local" | "global" }).scope);
        if (error && error !== "session_not_found") return providerFailure(error);
        return success("Sesión cerrada.", "/login?notice=signed-out");
      }
    }
  } catch {
    return unavailable();
  }
}
