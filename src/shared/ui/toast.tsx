"use client";

import { useEffect } from "react";
import { Check, CircleAlert, X } from "lucide-react";
import "./toast.css";

export type ToastType = "success" | "error" | "info";

export type ToastProps = {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: () => void;
};

export function Toast({ message, type = "success", duration = 4000, onClose }: ToastProps) {
  useEffect(() => {
    if (!message || duration <= 0) return;
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onClose]);

  if (!message) return null;

  return (
    <div className="finzi-toast-container" aria-live="polite" role="status">
      <div className={`finzi-toast finzi-toast-${type}`}>
        <span className="finzi-toast-icon" aria-hidden="true">
          {type === "error" ? <CircleAlert size={18} /> : <Check size={18} />}
        </span>
        <span className="finzi-toast-message">{message}</span>
        <button
          type="button"
          className="finzi-toast-close"
          onClick={onClose}
          aria-label="Cerrar notificación"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
