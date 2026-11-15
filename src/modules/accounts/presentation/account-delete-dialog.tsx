"use client";

import { LoaderCircle, X } from "lucide-react";
import { formatMoney } from "@/shared/money";
import type { Account } from "../domain/account";

export function AccountDeleteDialog({ account, pending, message, onClose, onDelete }: {
  account: Account; pending: boolean; message: string; onClose: () => void; onDelete: () => void;
}) {
  const balance = BigInt(account.balance_minor);
  return <>
    <div className="dialog-heading"><h2 id="account-delete-title">Eliminar cuenta</h2><button className="home-icon-button" onClick={onClose} disabled={pending} aria-label="Cerrar"><X size={20} /></button></div>
    <p className="delete-account-name">«{account.name}»</p>
    <p className="delete-copy" id="account-delete-copy">La cuenta saldrá de tus saldos y de la lista de cuentas. Sus movimientos se conservan en el historial y se mostrarán como «Cuenta eliminada».</p>
    {balance !== 0n && <p className="delete-copy">Su saldo actual de {formatMoney(balance, account.currency_code)} dejará de contar en tus totales. Esta acción no se puede deshacer.</p>}
    <div className="feedback-slot" role="alert">{message && <p className="field-error">{message}</p>}</div>
    <div className="finzi-form-actions">
      <button type="button" className="button button-secondary" disabled={pending} onClick={onClose}>Cancelar</button>
      <button type="button" className="button button-danger" disabled={pending} onClick={onDelete}>{pending && <LoaderCircle className="loading-icon" size={18} aria-hidden="true" />}{pending ? "Eliminando…" : "Eliminar cuenta"}</button>
    </div>
  </>;
}
