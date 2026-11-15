"use client";
import { useState, type FormEvent } from "react";
import type { Currency } from "@/shared/money";
import { debtCategories, debtIcons, type Debt, type DebtCommand } from "../domain/debt";
import { decimalMoney } from "@/shared/money";

export function DebtEditor({ debt, currency, locked, onSave, onCancel }: { debt: Debt | null; currency: Currency; locked: boolean; onSave: (command: unknown) => void; onCancel: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID());
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    const command = { action: debt ? "update" : "create", ...(debt ? { id: debt.id, expectedVersion: debt.version } : { requestId }), name: values.get("name"), creditor: values.get("creditor"), amount: values.get("amount"), currency: debt?.currency_code ?? values.get("currency"), icon: values.get("icon"), category: values.get("category") || null, dueDate: values.get("dueDate") || null, detail: values.get("detail") };
    onSave(command as DebtCommand);
  }
  return <section className="debt-editor" aria-labelledby="debt-editor-title"><div className="debt-section-heading"><div><h2 id="debt-editor-title">{debt ? "Editar deuda" : "Registrar una deuda"}</h2><p>Registra lo que debes. Tus cuentas solo cambiarán cuando crees un gasto.</p></div></div>
    <form onSubmit={submit}><fieldset disabled={locked}><div className="debt-form-grid">
      <label className="debt-field">Nombre<input name="name" autoFocus required maxLength={100} defaultValue={debt?.name} placeholder="Por ejemplo, préstamo familiar" /></label>
      <label className="debt-field">A quién le debes<input name="creditor" required maxLength={150} defaultValue={debt?.creditor} placeholder="Persona o entidad" /></label>
      <label className="debt-field">Importe total<input name="amount" inputMode="decimal" required defaultValue={debt ? decimalMoney(BigInt(debt.amount_minor)) : ""} placeholder="0.00" /><small>Sin separadores de miles. Hasta 2 decimales.</small></label>
      <label className="debt-field">Moneda<select name="currency" defaultValue={debt?.currency_code ?? currency} disabled={!!debt}><option value="PEN">Soles · PEN</option><option value="USD">Dólares · USD</option></select>{debt && <small>La moneda se conserva para proteger los pagos vinculados.</small>}</label>
      <label className="debt-field">Vencimiento (opcional)<input name="dueDate" type="date" min="1900-01-01" max="9999-12-31" defaultValue={debt?.due_date ?? ""} /></label>
      <label className="debt-field">Categoría de deuda (opcional)<select name="category" defaultValue={debt?.category ?? ""}><option value="">Sin categoría</option>{Object.entries(debtCategories).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="debt-field">Ícono<select name="icon" defaultValue={debt?.icon ?? "wallet"}>{Object.entries(debtIcons).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="debt-field debt-wide">Detalle (opcional)<textarea name="detail" rows={3} maxLength={2000} defaultValue={debt?.detail} /></label>
    </div><p className="debt-help">El estado se calcula con los pagos: pendiente, pago parcial o pagada. Puedes registrar un pago después de guardar.</p><div className="debt-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button><button className="button" type="submit">{debt ? "Guardar cambios" : "Guardar deuda"}</button></div></fieldset></form>
  </section>;
}
