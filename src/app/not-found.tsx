import Link from "next/link";
import { AuthShell } from "@/modules/identity/presentation/auth-shell";
export default function NotFound() { return <AuthShell><div className="form-heading"><h1>No encontramos esta página</h1><p>Vuelve al acceso de Finzi para continuar.</p></div><Link href="/login" className="button button-primary">Ir a iniciar sesión</Link></AuthShell>; }
