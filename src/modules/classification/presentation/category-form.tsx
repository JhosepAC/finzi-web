"use client";

import { useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { Archive, ChevronDown, LoaderCircle, X } from "lucide-react";
import { catalogSchema, categoryColors, categoryIcons, createCategorySchema, updateCategorySchema, type Category, type CategoryCatalog, type CategoryIcon } from "../domain/category";
import { getFieldErrors, type FieldErrors } from "@/modules/identity/domain/auth";
import { CategoryIconPicker } from "./category-icon-picker";
import { CategoryImageField } from "./category-image-field";
import { categoryImageUrl, prepareCategoryImage, type PreparedCategoryImage } from "./category-image";
import { categoryIconComponents } from "./category-icon";

export type Draft = { requestId: string; category: Category | null; parentId: string | null; kind: Category["kind"] };

export function CategoryForm({ draft, categories, onBusy, onClose, onSave, onReload }: { draft: Draft; categories: Category[]; onBusy: (value: boolean) => void; onClose: () => void; onSave: (data: CategoryCatalog, kind: Category["kind"]) => void; onReload: () => Promise<void> }) {
  const category = draft.category;
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [kind, setKind] = useState<Category["kind"]>(category?.kind ?? draft.kind);
  const [parentId, setParent] = useState(category?.parent_id ?? draft.parentId ?? "");
  const [color, setColor] = useState<Category["color"]>(category?.color ?? "blue");
  const [icon, setIcon] = useState<CategoryIcon>(category?.icon ?? "tag");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const iconTrigger = useRef<HTMLButtonElement>(null);
  const [archived, setArchived] = useState(category?.status === "archived");
  const [imagePath] = useState<string | null>(category?.image_path ?? null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [prepared, setPrepared] = useState<PreparedCategoryImage | null>(null);
  const [imageError, setImageError] = useState("");
  const [phase, setPhase] = useState<"idle" | "upload" | "save">("idle");
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const pending = phase !== "idle";
  const PreviewIcon = categoryIconComponents[icon];
  const parent = categories.find((candidate) => candidate.id === parentId);
  const image = prepared?.preview ?? (imageRemoved ? null : imagePath ? categoryImageUrl(imagePath) : null);

  function closeIconPicker() {
    setIconPickerOpen(false);
    iconTrigger.current?.focus();
  }

  async function pick(file: File) {
    setImageError("");
    try { setPrepared(await prepareCategoryImage(file)); setImageRemoved(false); }
    catch (error) {
      setImageError((error as Error).message === "SIZE" ? "La imagen supera 1 MB." : "No pudimos usar esa imagen. Prueba con PNG, JPG o WebP.");
    }
  }
  function clearImage() { setPrepared(null); setImageRemoved(true); setImageError(""); }
  async function discard(path: string) {
    try { await fetch(`/api/v1/categories/image?path=${encodeURIComponent(path)}`, { method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(10000) }); } catch { /* The next save retries; an orphan is never exposed. */ }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || conflict) return;
    const imageValue = imageRemoved ? null : imagePath;
    const input = category
      ? { id: category.id, name, description, color, icon, imagePath: imageValue, archived, expectedVersion: category.version }
      : { requestId: draft.requestId, parentId: parentId || null, kind, name, description, color, icon, imagePath: imageValue };
    const parsed = (category ? updateCategorySchema : createCategorySchema).safeParse(input);
    if (!parsed.success) { const fields = getFieldErrors(parsed.error); setErrors(fields); const field = form.current?.elements.namedItem(Object.keys(fields)[0]); if (field instanceof HTMLElement) field.focus(); return; }
    setPhase("upload"); onBusy(true); setMessage(""); setErrors({}); setImageError("");
    let uploaded: string | null = null;
    try {
      if (prepared) {
        const upload = await fetch("/api/v1/categories/image", { method: "POST", headers: { "Content-Type": prepared.blob.type || "image/webp" }, body: prepared.blob, cache: "no-store", signal: AbortSignal.timeout(20000) });
        const body = await upload.json().catch(() => ({}));
        if (!upload.ok || !body.ok) { setMessage(body.message ?? "No pudimos subir la imagen. Inténtalo de nuevo."); return; }
        uploaded = String(body.path);
      }
      setPhase("save");
      const finalInput = { ...parsed.data, imagePath: uploaded ?? (imageRemoved ? null : imagePath) };
      const response = await fetch("/api/v1/categories", { method: category ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(finalInput), cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (response.ok && body.ok) { onSave(catalogSchema.parse(body), kind); return; }
      if (uploaded) await discard(uploaded);
      setMessage(body.message ?? "No pudimos confirmar el guardado. Reintenta desde este formulario."); setConflict(body.code === "CONFLICT");
      if (body.fieldErrors) setErrors(body.fieldErrors);
    } catch {
      if (uploaded) await discard(uploaded);
      setMessage("No pudimos confirmar el resultado. Conserva el formulario y reintenta; no se duplicará la categoría.");
    } finally { setPhase("idle"); onBusy(false); }
  }
  return <><div className="dialog-heading"><h2 id="category-form-title">{category ? "Editar categoría" : "Nueva categoría"}</h2><button className="home-icon-button" onClick={onClose} disabled={pending} aria-label="Cerrar categoría"><X size={20} /></button></div><form className="finzi-form" ref={form} action="/api/v1/categories" method="post" onSubmit={submit} noValidate aria-busy={pending}>
    <div className="category-preview"><span className={`category-symbol ${image ? "has-image" : `color-${color}`}`} aria-hidden="true">{image ? <Image src={image} alt="" width={42} height={42} unoptimized /> : <PreviewIcon size={24} />}</span><div><strong>{name.trim() || "Tu categoría"}</strong><small>{kind === "expense" ? "Gasto" : "Ingreso"}{parent ? ` en ${parent.name}` : " principal"}</small></div></div>
    <div className="field"><label htmlFor="cat-name">Nombre de la categoría</label><input id="cat-name" name="name" value={name} onChange={(event) => { setName(event.target.value); setErrors({}); }} maxLength={80} disabled={pending} autoComplete="off" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "cat-name-error" : undefined} />{errors.name && <p className="field-error" id="cat-name-error">{errors.name}</p>}</div>
    <div className="finzi-form-row"><div className="field"><label htmlFor="cat-kind">Tipo</label><select id="cat-kind" value={kind} disabled={pending || Boolean(category)} onChange={(event) => { setKind(event.target.value as Category["kind"]); setParent(""); }}><option value="expense">Gasto</option><option value="income">Ingreso</option></select></div><div className="field"><label htmlFor="cat-parent">Categoría principal</label><select id="cat-parent" value={parentId} disabled={pending || Boolean(category)} onChange={(event) => setParent(event.target.value)}><option value="">Sin padre</option>{categories.filter((candidate) => !candidate.parent_id && candidate.kind === kind && (!candidate.effective_archived || candidate.id === parentId)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></div></div>
    <div className="field"><label htmlFor="cat-description">Descripción <span className="optional-label">(opcional)</span></label><textarea id="cat-description" name="description" value={description} onChange={(event) => { setDescription(event.target.value); setErrors({}); }} maxLength={300} rows={2} disabled={pending} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "cat-description-error" : undefined} />{errors.description && <p className="field-error" id="cat-description-error">{errors.description}</p>}</div>
    <div className="category-appearance">
      <div className="field"><span className="field-label" id="cat-icon-label">Icono</span>
        <button ref={iconTrigger} type="button" className="category-icon-trigger" disabled={pending} aria-label={`Elegir icono: ${categoryIcons[icon]}`} aria-expanded={iconPickerOpen} aria-controls={iconPickerOpen ? "cat-icon-options" : undefined} onClick={() => setIconPickerOpen(!iconPickerOpen)}>
          <span className={`category-symbol color-${color}`} aria-hidden="true"><PreviewIcon size={22} /></span>
          <span className="icon-trigger-name">{categoryIcons[icon]}</span><ChevronDown className="icon-trigger-chevron" size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="field"><span className="field-label" id="cat-color-label">Color</span><div className="color-options" role="radiogroup" aria-labelledby="cat-color-label">{Object.entries(categoryColors).map(([value, label]) => <label key={value} className="color-option" title={label}><input type="radio" name="color" value={value} checked={color === value} disabled={pending} onChange={() => setColor(value as Category["color"])} /><span className={`color-dot color-${value}`} aria-hidden="true" /><span className="sr-only">{label}</span></label>)}</div></div>
    </div>
    {iconPickerOpen && <div id="cat-icon-options" className="category-icon-panel" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeIconPicker(); } }}><CategoryIconPicker value={icon} disabled={pending} onClose={closeIconPicker} onChange={(value) => { setIcon(value); closeIconPicker(); }} /></div>}
    <div className="field"><span className="field-label">Imagen <span className="optional-label">(opcional)</span></span><CategoryImageField image={image} pending={phase === "upload"} disabled={pending} error={imageError} onPick={pick} onClear={clearImage} /></div>
    {category && <label className="archive-option"><input type="checkbox" checked={archived} disabled={pending || (parent?.effective_archived && category.status === "archived")} onChange={(event) => setArchived(event.target.checked)} /><span><Archive size={16} aria-hidden="true" />Categoría archivada<small>{parent?.effective_archived ? "Restaura primero la categoría principal para activar esta subcategoría." : category.parent_id ? "Desmarca para restaurarla." : "Sus subcategorías quedarán inactivas mientras esté archivada."}</small></span></label>}
    <div className="feedback-slot" role="alert">{message && <p className="field-error">{message}</p>}</div>{conflict && <button type="button" className="home-text-button" onClick={onReload}>Descartar el borrador y actualizar categorías</button>}
    <div className="finzi-form-actions"><button type="button" className="button button-secondary" disabled={pending} onClick={onClose}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending || conflict}>{pending && <LoaderCircle className="loading-icon" size={18} aria-hidden="true" />}{phase === "upload" ? "Subiendo imagen…" : phase === "save" ? "Guardando…" : category ? "Guardar cambios" : "Crear categoría"}</button></div>
  </form></>;
}
