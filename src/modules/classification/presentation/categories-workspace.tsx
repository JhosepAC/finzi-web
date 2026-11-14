"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, BookOpen, BriefcaseBusiness, Car, ChevronRight, Gift, Heart, House, LoaderCircle, Pencil, Plus, RefreshCw, Search, ShoppingCart, Tag, Utensils, Wallet, X, type LucideIcon } from "lucide-react";
import { catalogSchema, categoryColors, categoryIcons, createCategorySchema, updateCategorySchema, type Category, type CategoryCatalog } from "../domain/category";
import { getFieldErrors, type FieldErrors } from "@/modules/identity/domain/auth";
import "./categories.css";

const icons: Record<Category["icon"], LucideIcon> = { tag: Tag, home: House, cart: ShoppingCart, car: Car, heart: Heart, briefcase: BriefcaseBusiness, book: BookOpen, gift: Gift, utensils: Utensils, wallet: Wallet };
type Draft = { requestId: string; category: Category | null; parentId: string | null; kind: Category["kind"] };
async function readResponse(response: Response): Promise<CategoryCatalog> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "No pudimos cargar tus categorías.");
  return catalogSchema.parse(body);
}
export function CategoriesWorkspace() {
  const [catalog, setCatalog] = useState<CategoryCatalog | null>(null);
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [seeding, setSeeding] = useState(false);
  const busy = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/categories", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(readResponse).then((data) => { if (!controller.signal.aborted) setCatalog(data); })
      .catch(() => { if (!controller.signal.aborted) { setFailed(true); setMessage("No pudimos cargar tus categorías. Inténtalo de nuevo."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => { if (draft && !dialog.current?.open) dialog.current?.showModal(); }, [draft]);
  async function refresh() {
    setLoading(true); setMessage(""); setFailed(false);
    try { setCatalog(await readResponse(await fetch("/api/v1/categories", { cache: "no-store", signal: AbortSignal.timeout(15000) }))); }
    catch { setFailed(true); setMessage("No pudimos actualizar. Los últimos datos cargados se conservan; vuelve a intentarlo."); }
    finally { setLoading(false); }
  }
  async function initialize() {
    if (seeding) return;
    setSeeding(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch("/api/v1/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "initialize" }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) { const body = await response.json(); setFailed(true); setMessage(body.message ?? "No pudimos añadir las categorías iniciales."); return; }
      setCatalog(await readResponse(response));
      setMessage("Categorías iniciales añadidas. Puedes personalizarlas.");
    } catch { setFailed(true); setMessage("No pudimos confirmar las categorías iniciales. Reintenta; no se duplicarán ni se reemplazarán tus cambios."); }
    finally { setSeeding(false); }
  }
  const categories = catalog?.categories ?? [];
  const normalized = query.trim().toLocaleLowerCase("es");
  const eligible = (category: Category) => category.kind === kind && (archived || !category.effective_archived);
  const matches = (category: Category) => `${category.name} ${category.description}`.toLocaleLowerCase("es").includes(normalized);
  const sorted = (list: Category[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, "es"));
  const roots = sorted(categories.filter((category) => !category.parent_id && eligible(category) && (matches(category) || categories.some((child) => child.parent_id === category.id && eligible(child) && matches(child)))));
  function open(category: Category | null = null, parentId: string | null = null) { setDraft({ requestId: crypto.randomUUID(), category, parentId, kind }); }
  function saved(data: CategoryCatalog, selectedKind: Category["kind"]) {
    setCatalog(data); setKind(selectedKind); setQuery(""); setArchived(true);
    dialog.current?.close(); setFailed(false); setMessage("Categoría guardada.");
    requestAnimationFrame(() => title.current?.focus({ preventScroll: true }));
  }
  function row(category: Category) {
    const Icon = icons[category.icon];
    return <div className="category-row"><span className={`category-symbol color-${category.color}`} aria-hidden="true"><Icon size={20} /></span><div className="category-row-name"><h3>{category.name}</h3>{category.description && <p>{category.description}</p>}</div><span className={`category-state ${category.effective_archived ? "archived" : ""}`}>{category.status === "archived" ? "Archivada" : category.effective_archived ? "Padre archivado" : "Activa"}</span><div className="category-row-actions">{!category.parent_id && !category.effective_archived && <button className="home-icon-button" disabled={categories.length >= 200} onClick={() => open(null, category.id)} aria-label={`Añadir subcategoría a ${category.name}`}><Plus size={18} /></button>}<button className="home-icon-button" onClick={() => open(category)} aria-label={`Editar categoría ${category.name}`}><Pencil size={17} /></button></div></div>;
  }
  return <div className="categories-workspace" aria-busy={loading}>
    <div className="category-toolbar"><div className="category-kind" role="group" aria-label="Tipo de categorías">{([['expense', 'Gastos'], ['income', 'Ingresos']] as const).map(([value, label]) => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}<span>{catalog ? categories.filter((c) => c.kind === value && !c.effective_archived).length : "—"}</span></button>)}</div><button className="home-text-button" onClick={refresh} disabled={loading || seeding || Boolean(draft)}><RefreshCw size={16} aria-hidden="true" />Actualizar categorías</button><button className="home-primary-button" disabled={!catalog || seeding || categories.length >= 200} onClick={() => open()}><Plus size={18} aria-hidden="true" />Nueva categoría</button></div>
    <section className="home-panel category-library" aria-labelledby="category-library-title"><div className="category-library-heading"><div><h2 ref={title} tabIndex={-1} id="category-library-title">{kind === "expense" ? "Cómo organizas tus gastos" : "De dónde vienen tus ingresos"}</h2><p>Categorías principales y un nivel de subcategorías.</p></div><span>{catalog ? `${categories.length} de 200` : "Cargando…"}</span></div>
      <div className="category-filters"><label className="category-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Buscar categorías</span><input type="search" placeholder="Buscar por nombre o descripción" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="archive-filter"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Mostrar archivadas</label></div>
      {!catalog ? <div className="category-empty"><Tag size={32} aria-hidden="true" /><h3>{loading ? "Cargando tus categorías…" : "Tus categorías no están disponibles."}</h3><p>{loading ? "Estamos consultando tu biblioteca." : "Pulsa Actualizar categorías para reintentar."}</p></div> : roots.length ? <ul className="category-tree">{roots.map((root) => <li key={root.id}>{row(root)}<ul>{sorted(categories.filter((child) => child.parent_id === root.id && eligible(child) && (matches(root) || matches(child)))).map((child) => <li className="category-child" key={child.id}><ChevronRight size={15} aria-hidden="true" />{row(child)}</li>)}</ul></li>)}</ul> : <div className="category-empty"><Tag size={32} aria-hidden="true" /><h3>{query || archived || categories.some((c) => c.kind === kind) ? "No hay categorías para estos filtros." : kind === "expense" ? "Dale un lugar a cada gasto." : "Organiza tus fuentes de ingreso."}</h3><p>{query ? "Prueba con otro nombre o descripción." : categories.some((c) => c.kind === kind) ? "Activa Mostrar archivadas para verlas o restaurarlas." : catalog.initialized ? "Crea una categoría propia para este tipo." : "Crea una categoría propia o comienza con las categorías iniciales."}</p><button className="home-text-button" disabled={seeding || categories.length >= 200} onClick={() => open()}><Plus size={17} aria-hidden="true" />Crear categoría de {kind === "expense" ? "gasto" : "ingreso"}</button></div>}
    </section>
    {catalog && !catalog.initialized && <section className="category-starter"><div><h2>Un punto de partida, a tu manera.</h2><p>Añade 6 categorías de gasto y 4 de ingreso, como Alimentación, Vivienda y Salario. Conservaremos las que ya tengas con el mismo nombre.</p></div><button className="button button-secondary" disabled={loading || seeding || categories.length >= 200} onClick={initialize}>{seeding ? "Añadiendo…" : "Usar categorías iniciales"}</button></section>}
    <p className="category-policy">Archivar una categoría principal deja sus subcategorías inactivas. Al restaurarla se respetan los archivos individuales.</p>
    <div className={`category-feedback ${failed ? "failed" : ""}`} role="status" aria-live="polite">{message}</div>
    <dialog ref={dialog} className="sample-dialog category-dialog" aria-labelledby="category-form-title" onCancel={(event) => { if (busy.current) event.preventDefault(); }} onClose={() => setDraft(null)}>{draft && <CategoryForm key={draft.requestId} draft={draft} categories={categories} onBusy={(value) => { busy.current = value; }} onClose={() => dialog.current?.close()} onSave={saved} onReload={async () => { dialog.current?.close(); await refresh(); }} />}</dialog>
  </div>;
}

function CategoryForm({ draft, categories, onBusy, onClose, onSave, onReload }: { draft: Draft; categories: Category[]; onBusy: (value: boolean) => void; onClose: () => void; onSave: (data: CategoryCatalog, kind: Category["kind"]) => void; onReload: () => Promise<void> }) {
  const category = draft.category;
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [kind, setKind] = useState<Category["kind"]>(category?.kind ?? draft.kind);
  const [parentId, setParent] = useState(category?.parent_id ?? draft.parentId ?? "");
  const [color, setColor] = useState<Category["color"]>(category?.color ?? "blue");
  const [icon, setIcon] = useState<Category["icon"]>(category?.icon ?? "tag");
  const [archived, setArchived] = useState(category?.status === "archived");
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const PreviewIcon = icons[icon];
  const parent = categories.find((c) => c.id === parentId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || conflict) return;
    const input = category ? { id: category.id, name, description, color, icon, archived, expectedVersion: category.version } : { requestId: draft.requestId, parentId: parentId || null, kind, name, description, color, icon };
    const parsed = (category ? updateCategorySchema : createCategorySchema).safeParse(input);
    if (!parsed.success) { const fields = getFieldErrors(parsed.error); setErrors(fields); const field = form.current?.elements.namedItem(Object.keys(fields)[0]); if (field instanceof HTMLElement) field.focus(); return; }
    setPending(true); onBusy(true); setMessage(""); setErrors({});
    try {
      const response = await fetch("/api/v1/categories", { method: category ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (response.ok && body.ok) { onSave(catalogSchema.parse(body), kind); return; }
      setMessage(body.message ?? "No pudimos confirmar el guardado. Reintenta desde este formulario."); setConflict(body.code === "CONFLICT");
      if (body.fieldErrors) setErrors(body.fieldErrors);
    } catch { setMessage("No pudimos confirmar el resultado. Conserva el formulario y reintenta; no se duplicará la categoría."); }
    finally { setPending(false); onBusy(false); }
  }
  return <><div className="dialog-heading"><h2 id="category-form-title">{category ? "Editar categoría" : "Nueva categoría"}</h2><button className="home-icon-button" onClick={onClose} disabled={pending} aria-label="Cerrar categoría"><X size={20} /></button></div><form className="sample-form" ref={form} action="/api/v1/categories" method="post" onSubmit={submit} noValidate aria-busy={pending}>
    <div className="category-preview"><span className={`category-symbol color-${color}`} aria-hidden="true"><PreviewIcon size={24} /></span><div><strong>{name.trim() || "Tu categoría"}</strong><small>{kind === "expense" ? "Gasto" : "Ingreso"}{parent ? ` en ${parent.name}` : " principal"}</small></div></div>
    <div className="field"><label htmlFor="cat-name">Nombre de la categoría</label><input id="cat-name" name="name" value={name} onChange={(event) => { setName(event.target.value); setErrors({}); }} maxLength={80} disabled={pending} autoComplete="off" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "cat-name-error" : undefined} />{errors.name && <p className="field-error" id="cat-name-error">{errors.name}</p>}</div>
    <div className="sample-form-row"><div className="field"><label htmlFor="cat-kind">Tipo</label><select id="cat-kind" value={kind} disabled={pending || Boolean(category)} onChange={(event) => { setKind(event.target.value as Category["kind"]); setParent(""); }}><option value="expense">Gasto</option><option value="income">Ingreso</option></select></div><div className="field"><label htmlFor="cat-parent">Categoría principal</label><select id="cat-parent" value={parentId} disabled={pending || Boolean(category)} onChange={(event) => setParent(event.target.value)}><option value="">Sin padre</option>{categories.filter((c) => !c.parent_id && c.kind === kind && (!c.effective_archived || c.id === parentId)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div></div>
    <div className="field"><label htmlFor="cat-description">Descripción <span className="optional-label">(opcional)</span></label><textarea id="cat-description" name="description" value={description} onChange={(event) => { setDescription(event.target.value); setErrors({}); }} maxLength={300} rows={2} disabled={pending} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "cat-description-error" : undefined} />{errors.description && <p className="field-error" id="cat-description-error">{errors.description}</p>}</div>
    <div className="sample-form-row"><div className="field"><label htmlFor="cat-color">Color</label><select id="cat-color" value={color} disabled={pending} onChange={(event) => setColor(event.target.value as Category["color"])}>{Object.entries(categoryColors).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="field"><label htmlFor="cat-icon">Icono</label><select id="cat-icon" value={icon} disabled={pending} onChange={(event) => setIcon(event.target.value as Category["icon"])}>{Object.entries(categoryIcons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
    <p className="field-hint">{category ? "El tipo y la categoría principal se conservan." : "El tipo y la categoría principal quedarán fijos al crearla."} Máximo 200 categorías, incluidas las archivadas.</p>
    {category && <label className="archive-option"><input type="checkbox" checked={archived} disabled={pending || (parent?.effective_archived && category.status === "archived")} onChange={(event) => setArchived(event.target.checked)} /><span><Archive size={16} aria-hidden="true" />Categoría archivada<small>{parent?.effective_archived ? "Restaura primero la categoría principal para activar esta subcategoría." : category.parent_id ? "Desmarca para restaurarla." : "Sus subcategorías quedarán inactivas mientras esté archivada."}</small></span></label>}
    <div className="feedback-slot" role="alert">{message && <p className="field-error">{message}</p>}</div>{conflict && <button type="button" className="home-text-button" onClick={onReload}>Descartar el borrador y actualizar categorías</button>}
    <div className="sample-form-actions"><button type="button" className="button button-secondary" disabled={pending} onClick={onClose}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending || conflict}>{pending && <LoaderCircle className="loading-icon" size={18} aria-hidden="true" />}{pending ? "Guardando…" : category ? "Guardar cambios" : "Crear categoría"}</button></div>
  </form></>;
}
