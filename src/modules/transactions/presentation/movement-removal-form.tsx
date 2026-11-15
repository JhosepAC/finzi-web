"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, LoaderCircle, Trash2, X } from "lucide-react";
import { formatMoney } from "@/shared/money";
import { deleteMovementSchema, voidMovementSchema, type Movement } from "../domain/movement";

export function MovementRemovalForm({ movement, mode, onDirty, onSaved, onCancel, onReload }: {
  movement: Movement; mode: "archive" | "delete"; onDirty: (dirty: boolean, pending: boolean) => void;
  onSaved: () => Promise<void>; onCancel: () => void; onReload: () => void;
}) {
  const deleting = mode === "delete";
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const reasonInput = useRef<HTMLInputElement>(null);
  useEffect(() => { reasonInput.current?.focus(); }, []);
  useEffect(() => { onDirty(Boolean(reason), pending); return () => onDirty(false, false); }, [reason, pending, onDirty]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || conflict) return;
    const parsed = (deleting ? deleteMovementSchema : voidMovementSchema).safeParse({ id: movement.id, expectedVersion: movement.version, reason });
    if (!parsed.success) { setMessage(`Escribe el motivo de ${deleting ? "eliminación" : "archivado"}, hasta 300 caracteres.`); reasonInput.current?.focus(); return; }
    setPending(true); setMessage("");
    try {
      const response = await fetch("/api/v1/movements", { method: deleting ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (response.ok && body.ok) { await onSaved(); return; }
      setUncertain(response.status >= 500); setConflict(body.code === "CONFLICT");
      setMessage(body.message ?? "No pudimos confirmar el resultado. Puedes reintentar la misma operación.");
    } catch { setUncertain(true); setMessage("No pudimos confirmar el resultado. Reintenta; su efecto no se repetirá."); }
    finally { setPending(false); }
  }
  function cancel() { if (!uncertain || window.confirm("La operación podría haberse completado. Consulta el historial antes de volver a intentarlo.")) onCancel(); }
  return <>
    <div className="dialog-heading"><h2 id="movement-removal-title">{deleting ? "Eliminar movimiento" : "Archivar movimiento"}</h2><button type="button" className="home-icon-button" aria-label="Cerrar confirmación" onClick={cancel} disabled={pending}><X size={20} /></button></div>
    <div className="ledger-removal-record"><strong>{movement.description}</strong><span>{formatMoney(BigInt(movement.amount_minor), movement.currency_code)}</span></div>
    <p id="movement-removal-copy" className="delete-copy">{deleting ? "Saldrá de tu lista de movimientos. Su trazabilidad se conservará y podrás consultarla desde los registros vinculados o en tu exportación." : "Se conservará visible en el historial como archivado."} {movement.status === "posted" ? movement.kind === "transfer" ? "Se retirará su efecto de ambas cuentas al mismo tiempo." : "Dejará de afectar el saldo y los indicadores." : "Este registro ya no afecta tus saldos; sus reemplazos conservan su efecto."}</p>
    <form className="ledger-void-form" action="/api/v1/movements" method="post" onSubmit={submit} noValidate aria-busy={pending}>
      <div className="field"><label htmlFor="movement-removal-reason">Motivo de {deleting ? "eliminación" : "archivado"}</label><input ref={reasonInput} id="movement-removal-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} disabled={pending || uncertain} aria-describedby="movement-removal-error" aria-invalid={Boolean(message)} /></div>
      <div id="movement-removal-error" className="ledger-feedback" role="alert">{message}</div>
      {conflict && <button className="home-text-button" type="button" onClick={onReload}>Cerrar y consultar movimientos</button>}
      <div className="ledger-entry-actions"><button className="button button-secondary" type="button" onClick={cancel} disabled={pending}>Conservar movimiento</button><button className={`button ${deleting ? "button-danger" : "button-primary"}`} type="submit" disabled={pending || conflict}>{pending ? <LoaderCircle size={17} className="loading-icon" aria-hidden="true" /> : deleting ? <Trash2 size={17} aria-hidden="true" /> : <Archive size={17} aria-hidden="true" />}{pending ? deleting ? "Eliminando…" : "Archivando…" : deleting ? "Confirmar eliminación" : "Confirmar archivado"}</button></div>
    </form>
  </>;
}
