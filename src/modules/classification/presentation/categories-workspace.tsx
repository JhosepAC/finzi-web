"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronRight, Pencil, Plus, RefreshCw, Search, Tag, Trash2 } from "lucide-react";
import { catalogSchema, type Category, type CategoryCatalog } from "../domain/category";
import { CategoryForm, type Draft } from "./category-form";
import { CategoryDeleteDialog } from "./category-delete-dialog";
import { categoryImageUrl } from "./category-image";
import { categoryIconComponents } from "./category-icon";
import "./categories.css";

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
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState("");
  const [seeding, setSeeding] = useState(false);
  const busy = useRef(false);
  const formDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/categories", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(readResponse).then((data) => { if (!controller.signal.aborted) setCatalog(data); })
      .catch(() => { if (!controller.signal.aborted) { setFailed(true); setMessage("No pudimos cargar tus categorías. Inténtalo de nuevo."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => { if (draft && !formDialog.current?.open) formDialog.current?.showModal(); }, [draft]);
  useEffect(() => { if (deleting && !deleteDialog.current?.open) deleteDialog.current?.showModal(); }, [deleting]);
  function focusTitle() { requestAnimationFrame(() => title.current?.focus({ preventScroll: true })); }
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
  async function archive(category: Category) {
    if (deletePending) return;
    setDeletePending(true); setDeleteMessage("");
    try {
      const response = await fetch("/api/v1/categories", { method: "PATCH", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ id: category.id, name: category.name, description: category.description, color: category.color, icon: category.icon, imagePath: category.image_path, archived: true, expectedVersion: category.version }) });
      const body = await response.json();
      if (!response.ok || !body.ok) { setDeleteMessage(body.message ?? "No pudimos archivar la categoría. Actualiza e inténtalo de nuevo."); return; }
      setCatalog(catalogSchema.parse(body)); closeDelete(); setMessage("Categoría archivada."); focusTitle();
    } catch { setDeleteMessage("No pudimos confirmar el archivado. Actualiza las categorías y reintenta."); }
    finally { setDeletePending(false); }
  }
  async function remove(category: Category) {
    if (deletePending) return;
    setDeletePending(true); setDeleteMessage("");
    try {
      const response = await fetch("/api/v1/categories", { method: "DELETE", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ id: category.id, expectedVersion: category.version }) });
      const body = await response.json();
      if (!response.ok || !body.ok) { setDeleteMessage(body.message ?? "No pudimos eliminar la categoría. Actualiza e inténtalo de nuevo."); return; }
      setCatalog(catalogSchema.parse(body)); closeDelete(); setMessage("Categoría eliminada."); focusTitle();
    } catch { setDeleteMessage("No pudimos confirmar la eliminación. Actualiza las categorías y reintenta."); }
    finally { setDeletePending(false); }
  }
  function closeDelete() { deleteDialog.current?.close(); setDeleting(null); setDeleteMessage(""); }
  const categories = catalog?.categories ?? [];
  const normalized = query.trim().toLocaleLowerCase("es");
  const eligible = (category: Category) => category.kind === kind && (archived || !category.effective_archived);
  const matches = (category: Category) => `${category.name} ${category.description}`.toLocaleLowerCase("es").includes(normalized);
  const sorted = (list: Category[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, "es"));
  const roots = sorted(categories.filter((category) => !category.parent_id && eligible(category) && (matches(category) || categories.some((child) => child.parent_id === category.id && eligible(child) && matches(child)))));
  function open(category: Category | null = null, parentId: string | null = null) { setDraft({ requestId: crypto.randomUUID(), category, parentId, kind }); }
  function saved(data: CategoryCatalog, selectedKind: Category["kind"]) {
    setCatalog(data); setKind(selectedKind); setQuery(""); setArchived(true);
    formDialog.current?.close(); setFailed(false); setMessage("Categoría guardada."); focusTitle();
  }
  function row(category: Category) {
    const Icon = categoryIconComponents[category.icon];
    return <div className="category-row"><span className={`category-symbol ${category.image_path ? "has-image" : `color-${category.color}`}`} aria-hidden="true">{category.image_path ? <Image src={categoryImageUrl(category.image_path)} alt="" width={42} height={42} unoptimized /> : <Icon size={20} />}</span><div className="category-row-name"><h3>{category.name}</h3>{category.description && <p>{category.description}</p>}</div><span className={`category-state ${category.effective_archived ? "archived" : ""}`}>{category.status === "archived" ? "Archivada" : category.effective_archived ? "Padre archivado" : "Activa"}</span><div className="category-row-actions">{!category.parent_id && !category.effective_archived && <button className="home-icon-button" disabled={categories.length >= 200} onClick={() => open(null, category.id)} aria-label={`Añadir subcategoría a ${category.name}`}><Plus size={18} /></button>}<button className="home-icon-button" onClick={() => open(category)} aria-label={`Editar categoría ${category.name}`}><Pencil size={17} /></button><button className="home-icon-button" onClick={() => setDeleting(category)} aria-label={`Eliminar categoría ${category.name}`}><Trash2 size={17} /></button></div></div>;
  }
  return <div className="categories-workspace" aria-busy={loading}>
    <div className="category-toolbar"><div className="category-kind" role="group" aria-label="Tipo de categorías">{([['expense', 'Gastos'], ['income', 'Ingresos']] as const).map(([value, label]) => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}<span>{catalog ? categories.filter((category) => category.kind === value && !category.effective_archived).length : "—"}</span></button>)}</div><button className="home-text-button" onClick={refresh} disabled={loading || seeding || Boolean(draft) || Boolean(deleting)}><RefreshCw size={16} aria-hidden="true" />Actualizar categorías</button><button className="home-primary-button" disabled={!catalog || seeding || categories.length >= 200} onClick={() => open()}><Plus size={18} aria-hidden="true" />Nueva categoría</button></div>
    <section className="home-panel category-library" aria-labelledby="category-library-title"><div className="category-library-heading"><h2 ref={title} tabIndex={-1} id="category-library-title">{kind === "expense" ? "Cómo organizas tus gastos" : "De dónde vienen tus ingresos"}</h2><span>{catalog ? `${categories.length} de 200` : "Cargando…"}</span></div>
      <div className="category-filters"><label className="category-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Buscar categorías</span><input type="search" placeholder="Buscar por nombre o descripción" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="archive-filter"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Mostrar archivadas</label></div>
      {!catalog ? <div className="category-empty"><Tag size={32} aria-hidden="true" /><h3>{loading ? "Cargando tus categorías…" : "Tus categorías no están disponibles."}</h3>{!loading && <p>Actualiza para reintentar.</p>}</div> : roots.length ? <ul className="category-tree">{roots.map((root) => <li key={root.id}>{row(root)}<ul>{sorted(categories.filter((child) => child.parent_id === root.id && eligible(child) && (matches(root) || matches(child)))).map((child) => <li className="category-child" key={child.id}><ChevronRight size={15} aria-hidden="true" />{row(child)}</li>)}</ul></li>)}</ul> : <div className="category-empty"><Tag size={32} aria-hidden="true" /><h3>{query || archived || categories.some((category) => category.kind === kind) ? "No hay categorías para estos filtros." : kind === "expense" ? "Dale un lugar a cada gasto." : "Organiza tus fuentes de ingreso."}</h3><p>{query ? "Prueba con otro nombre o descripción." : categories.some((category) => category.kind === kind) ? "Activa Mostrar archivadas para verlas o restaurarlas." : catalog.initialized ? "Crea una categoría propia para este tipo." : "Crea una categoría propia o comienza con las categorías iniciales."}</p><button className="home-text-button" disabled={seeding || categories.length >= 200} onClick={() => open()}><Plus size={17} aria-hidden="true" />Crear categoría de {kind === "expense" ? "gasto" : "ingreso"}</button></div>}
    </section>
    {catalog && !catalog.initialized && <section className="category-starter"><div><h2>Categorías iniciales</h2><p>Añade 10 categorías habituales sin reemplazar las que ya tengas.</p></div><button className="button button-secondary" disabled={loading || seeding || categories.length >= 200} onClick={initialize}>{seeding ? "Añadiendo…" : "Usar categorías iniciales"}</button></section>}
    <div className={`category-feedback ${failed ? "failed" : ""}`} role="status" aria-live="polite">{message}</div>
    <dialog ref={formDialog} className="finzi-dialog category-dialog" aria-labelledby="category-form-title" onCancel={(event) => { if (busy.current) event.preventDefault(); }} onClose={() => setDraft(null)}>{draft && <CategoryForm key={draft.requestId} draft={draft} categories={categories} onBusy={(value) => { busy.current = value; }} onClose={() => formDialog.current?.close()} onSave={saved} onReload={async () => { formDialog.current?.close(); await refresh(); }} />}</dialog>
    <dialog ref={deleteDialog} className="finzi-dialog category-delete-dialog" aria-labelledby="category-delete-title" aria-describedby="category-delete-copy" onCancel={(event) => { if (deletePending) event.preventDefault(); }} onClose={closeDelete}>{deleting && <CategoryDeleteDialog category={deleting} childCount={categories.filter((category) => category.parent_id === deleting.id).length} pending={deletePending} message={deleteMessage} onClose={closeDelete} onDelete={() => remove(deleting)} onArchive={() => archive(deleting)} />}</dialog>
  </div>;
}
