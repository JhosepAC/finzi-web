"use client";
import { AuthShell } from "@/modules/identity/presentation/auth-shell";
export default function ErrorPage({ reset }: { reset: () => void }) { return <AuthShell><div className="form-heading"><h1>No pudimos cargar esta página</h1><p>Inténtalo otra vez. Si el problema continúa, vuelve más tarde.</p></div><button className="button button-primary" onClick={reset}>Volver a intentar</button></AuthShell>; }
