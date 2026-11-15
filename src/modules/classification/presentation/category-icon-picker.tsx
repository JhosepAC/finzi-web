"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { categoryIconGroups, categoryIcons, type CategoryIcon } from "../domain/category";
import { categoryIconComponents } from "./category-icon";

export function CategoryIconPicker({ value, disabled, onChange, onClose }: { value: CategoryIcon; disabled: boolean; onChange: (icon: CategoryIcon) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    search.current?.focus({ preventScroll: true });
    search.current?.closest(".category-icon-panel")?.scrollIntoView({ block: "nearest" });
  }, []);
  const normalized = query.trim().toLocaleLowerCase("es");
  const groups = useMemo(() => categoryIconGroups
    .map((group) => ({ ...group, icons: group.icons.filter((icon) => !normalized || categoryIcons[icon].toLocaleLowerCase("es").includes(normalized)) }))
    .filter((group) => group.icons.length), [normalized]);
  return <div className="icon-picker">
    <div className="icon-picker-heading"><span>Elige un icono</span><button type="button" className="home-icon-button" aria-label="Cerrar selector de iconos" disabled={disabled} onClick={onClose}><X size={17} aria-hidden="true" /></button></div>
    <label className="icon-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Buscar icono</span><input ref={search} type="search" placeholder="Buscar icono" value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} /></label>
    {groups.length ? <div className="icon-groups" role="radiogroup" aria-labelledby="cat-icon-label">
      {groups.map((group) => <div className="icon-group" key={group.label}><p className="icon-group-label">{group.label}</p><div className="icon-grid">
        {group.icons.map((icon) => { const Icon = categoryIconComponents[icon]; return <label key={icon} className="icon-option" title={categoryIcons[icon]}>
          <input type="radio" name="icon" value={icon} checked={value === icon} disabled={disabled} onChange={() => onChange(icon)} onClick={() => { if (value === icon) onClose(); }} />
          <span className="icon-option-face"><Icon size={20} aria-hidden="true" /></span><span className="sr-only">{categoryIcons[icon]}</span>
        </label>; })}
      </div></div>)}
    </div> : <p className="icon-empty">No hay iconos con ese nombre.</p>}
  </div>;
}
