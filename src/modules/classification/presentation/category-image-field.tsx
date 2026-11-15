"use client";

import { useRef } from "react";
import Image from "next/image";
import { ImagePlus, Trash2 } from "lucide-react";

export function CategoryImageField({ image, pending, disabled, error, onPick, onClear }: { image: string | null; pending: boolean; disabled: boolean; error: string; onPick: (file: File) => void; onClear: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="category-image-field">
    <div className={`category-image-preview ${image ? "has-image" : ""}`}>{image ? <Image src={image} alt="Imagen de la categoría" width={76} height={76} unoptimized /> : <ImagePlus size={22} aria-hidden="true" />}</div>
    <div className="category-image-actions">
      <input ref={input} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || pending} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onPick(file); }} />
      <div className="category-image-buttons">
        <button type="button" className="home-text-button" disabled={disabled || pending} onClick={() => input.current?.click()}>{image ? "Reemplazar imagen" : "Añadir imagen"}</button>
        {image && <button type="button" className="home-text-button" disabled={disabled || pending} onClick={onClear}><Trash2 size={15} aria-hidden="true" />Quitar</button>}
      </div>
      <p className="field-hint">PNG, JPG o WebP · máximo 1 MB</p>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  </div>;
}
