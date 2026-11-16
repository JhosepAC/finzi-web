"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { movementSchema, type Movement } from "../domain/movement";
import { formatMoney } from "@/shared/money";

export function MovementTrace({ id, revision, timezone, locked, onOpen, onClose, actions }: { id: string; revision: number; timezone: string; locked: boolean; onOpen: (id: string) => void; onClose: () => void; actions: (movement: Movement) => ReactNode }) {
  const [record, setRecord] = useState<Movement | null>(null);
  const [failed, setFailed] = useState("");
  const [attempt, setAttempt] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const key = `${id}:${revision}:${attempt}`;
  const [loaded, setLoaded] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/movements?id=${id}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.message ?? "No pudimos consultar este registro."); return movementSchema.parse(body.movement); })
      .then((data) => { if (!controller.signal.aborted) { setRecord(data); setFailed(""); } })
      .catch((error) => { if (!controller.signal.aborted) { setRecord(null); setFailed(error instanceof Error ? error.message : "No pudimos consultar este registro."); } })
      .finally(() => { if (!controller.signal.aborted) setLoaded(key); });
    return () => controller.abort();
  }, [id, key]);
  useEffect(() => { if (loaded === key) title.current?.focus({ preventScroll: true }); }, [loaded, key]);
  const m = loaded === key ? record : null;
  const date = (value: string) => new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "medium", timeZone: timezone }).format(new Date(value));
  return <section className="home-panel ledger-trace" aria-labelledby="trace-title" aria-busy={loaded !== key}>
    <div className="ledger-trace-heading"><h2 id="trace-title" ref={title} tabIndex={-1}>Trazabilidad del movimiento</h2><button className="home-text-button" disabled={locked} onClick={onClose}><X size={17} aria-hidden="true" />Cerrar detalle</button></div>
    <p>Consulta el registro anterior y cada reemplazo, sin cambiar los filtros del historial.</p>
    {loaded !== key ? <p role="status">Consultando registro…</p> : failed ? <div role="alert"><p>{failed}</p><button className="home-text-button" onClick={() => setAttempt((v) => v + 1)}>Reintentar consulta</button></div> : m && <>
      <div className="ledger-trace-main"><div><h3>{m.description}</h3><p>{m.account_name}{m.destination_name ? ` → ${m.destination_name}` : ` · ${m.category_name}`}</p></div><div><strong>{formatMoney(BigInt(m.amount_minor), m.currency_code)}</strong><span>{m.deleted_at ? "Eliminado" : m.replaced_by_id ? "Reemplazado" : m.status === "void" ? "Archivado" : "Vigente"} · {m.kind === "transfer" ? "Transferencia" : m.kind === "income" ? "Ingreso" : "Gasto"}</span></div></div>
      {m.deleted_at && <p>Eliminado de la lista el {date(m.deleted_at)}. Su efecto en los saldos está retirado. Motivo: {m.deletion_reason}</p>}
      <dl className="ledger-trace-meta"><div><dt>Ocurrió</dt><dd>{date(m.occurred_at)}</dd></div><div><dt>Registrado</dt><dd>{date(m.recorded_at)}</dd></div>{m.voided_at && <div><dt>{m.replaced_by_id ? "Reemplazado" : "Archivado"}</dt><dd>{date(m.voided_at)}</dd></div>}</dl>
      {m.note && <p className="ledger-record-note">{m.note}</p>}
      {m.void_reason && (!m.deleted_at || m.void_reason !== m.deletion_reason) && <p><strong>{m.replaced_by_id ? "Motivo del reemplazo" : "Motivo de archivado"}:</strong> {m.void_reason}</p>}{m.replacement_reason && <p><strong>Motivo de esta edición:</strong> {m.replacement_reason}</p>}
      <div className="ledger-trace-links">{m.replaces_id ? <button className="home-text-button" disabled={locked} onClick={() => onOpen(m.replaces_id!)}><ArrowLeft size={17} aria-hidden="true" />Ver registro anterior</button> : <span>Registro original</span>}{m.replaced_by_id && <button className="home-text-button" disabled={locked} onClick={() => onOpen(m.replaced_by_id!)}>Ver reemplazo<ArrowRight size={17} aria-hidden="true" /></button>}</div>
      {actions(m)}
      <details className="ledger-reference"><summary>Identificador y versión</summary><p>{m.id} · Versión {m.version}</p></details>
    </>}
  </section>;
}
