"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Account } from "@/modules/accounts";
import { MovementForm } from "./movement-form";
import "./movements.css";

export function TransferDialog({ accounts, timezone, onClose, onSaved, setGuard }: { accounts: Account[]; timezone: string; onClose: () => void; onSaved: () => Promise<void>; setGuard?: (guard: () => boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const opener = useRef<HTMLElement | null>(null);
  const [dirty, setDirty] = useState(false); const [pending, setPending] = useState(false);
  const onDirty = useCallback((value: boolean, busy: boolean) => { setDirty(value); setPending(busy); }, []);
  useEffect(() => { opener.current = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => { opener.current?.focus(); }; }, []);
  useEffect(() => {
    const guard = () => pending ? false : !dirty || window.confirm("¿Descartar la transferencia sin guardar?"); setGuard?.(guard);
    const unload = (e: BeforeUnloadEvent) => { if (dirty || pending) e.preventDefault(); }; window.addEventListener("beforeunload", unload);
    return () => { setGuard?.(() => true); window.removeEventListener("beforeunload", unload); };
  }, [dirty, pending, setGuard]);
  return <div className="ledger-workspace"><dialog ref={dialog} className="finzi-dialog ledger-dialog" aria-labelledby="movement-form-title" onCancel={(e) => { e.preventDefault(); if (!pending && (!dirty || window.confirm("¿Descartar la transferencia sin guardar?"))) onClose(); }}><MovementForm accounts={accounts} categories={[]} initialKind="transfer" transferOnly timezone={timezone} onCancel={onClose} onDirty={onDirty} onSave={async () => { await onSaved(); onClose(); }} /></dialog></div>;
}
