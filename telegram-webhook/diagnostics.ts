const codes = new Set(["42501", "55P03", "40001", "42883", "57014", "08006", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_METHOD_NOT_IMPLEMENTED", "ERR_NOT_IMPLEMENTED", "ERR_TLS_INVALID_PROTOCOL_VERSION"]);
const internal = new Set(["invalid_database", "invalid_role", "invalid_cipher", "invalid_configuration", "connect_timeout", "unexpected_custody_write", "invalid_identity", "unexpected_telegram_method", "outbox_limit"]);
export function diagnostic(error: unknown, stage: "receive" | "batch", phase = "unknown") {
 const e = error as { code?: string; message?: string };
 const code = e?.code && (codes.has(e.code) || /^[A-Z][A-Z0-9_]{0,47}$/.test(e.code)) ? e.code : e?.message && internal.has(e.message) ? e.message : "unclassified";
 console.error(JSON.stringify({ component: "telegram_transport", stage, phase, code }));
}
