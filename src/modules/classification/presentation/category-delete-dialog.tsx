"use client";

import { LoaderCircle, X } from "lucide-react";
import type { Category } from "../domain/category";

export function CategoryDeleteDialog({ category, childCount, pending, message, onClose, onDelete, onArchive }: {
  category: Category; childCount: number; pending: boolean; message: string;
  onClose: () => void; onDelete: () => void; onArchive: () => void;
}) {
  const reasons = [
    category.movement_count > 0 ? `${category.movement_count === 1 ? "Tiene 1 movimiento asociado" : `Tiene ${category.movement_count} movimientos asociados`}.` : "",
    childCount > 0 ? `${childCount === 1 ? "Tiene 1 subcategoría" : `Tiene ${childCount} subcategorías`}.` : "",
  ].filter(Boolean);
  const blocked = reasons.length > 0;
  const canArchive = category.status === "active" && !category.effective_archived;
  return <>
    <div className="dialog-heading"><h2 id="category-delete-title">Eliminar categoría</h2><button className="home-icon-button" onClick={onClose} disabled={pending} aria-label="Cerrar"><X size={20} /></button></div>
    <p className="delete-category-name">«{category.name}»</p>
    {blocked
      ? <p className="delete-copy" id="category-delete-copy">No se puede eliminar. {reasons.join(" ")} {canArchive ? "Archívala para ocultarla sin perder el historial." : ""}</p>
      : <p className="delete-copy" id="category-delete-copy">Se eliminará de forma definitiva. Esta acción no se puede deshacer.</p>}
    <div className="feedback-slot" role="alert">{message && <p className="field-error">{message}</p>}</div>
    <div className="finzi-form-actions">
      <button type="button" className="button button-secondary" disabled={pending} onClick={onClose}>{blocked && !canArchive ? "Cerrar" : "Cancelar"}</button>
      {blocked && canArchive
        ? <button type="button" className="button button-primary" disabled={pending} onClick={onArchive}>{pending && <LoaderCircle className="loading-icon" size={18} aria-hidden="true" />}{pending ? "Archivando…" : "Archivar categoría"}</button>
        : !blocked && <button type="button" className="button button-danger" disabled={pending} onClick={onDelete}>{pending && <LoaderCircle className="loading-icon" size={18} aria-hidden="true" />}{pending ? "Eliminando…" : "Eliminar categoría"}</button>}
    </div>
  </>;
}
