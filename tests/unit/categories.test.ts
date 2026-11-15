import { describe, expect, it } from "vitest";
import { catalogSchema, categoryIconGroups, categoryIcons, createCategorySchema, deleteCategorySchema, initializeCategoriesSchema, updateCategorySchema } from "../../src/modules/classification/domain/category";
const owner = crypto.randomUUID(), file = crypto.randomUUID(), imagePath = `${owner}/${file}.webp`;
const creation = { requestId: crypto.randomUUID(), parentId: null, kind: "expense", name: "  Alimentación  ", description: "  Diario  ", color: "amber", icon: "utensils", imagePath: null };
describe("contrato de categorías", () => {
  it("normaliza solo espacios exteriores y conserva texto propio", () => { expect(createCategorySchema.parse(creation)).toMatchObject({ name: "Alimentación", description: "Diario" }); });
  it.each([{ name: " " }, { name: "x".repeat(81) }, { description: "x".repeat(301) }, { color: "url(evil)" }, { icon: "<script>" }, { kind: "transfer" }, { parentId: "otro" }, { user_id: crypto.randomUUID() }, { archived: false }, { requestId: "no" }])("rechaza campos o valores no admitidos: %j", (input) => { expect(createCategorySchema.safeParse({ ...creation, ...input }).success).toBe(false); });
  const update = { id: crypto.randomUUID(), name: "Casa", description: "", color: "blue", icon: "home", imagePath: null, archived: false, expectedVersion: 1 };
  it.each([{ kind: "income" }, { parentId: crypto.randomUUID() }, { expectedVersion: 0 }, { expectedVersion: 1.1 }, { archived: "false" }])("edición no cambia estructura: %j", (input) => { expect(updateCategorySchema.safeParse({ ...update, ...input }).success).toBe(false); });
  it("plantillas no aceptan parámetros o dueño", () => { expect(initializeCategoriesSchema.parse({ action: "initialize" })).toEqual({ action: "initialize" }); expect(initializeCategoriesSchema.safeParse({ action: "initialize", userId: "otro" }).success).toBe(false); });
  it("lectura fallida no se interpreta como catálogo vacío", () => { expect(catalogSchema.safeParse(null).success).toBe(false); expect(catalogSchema.safeParse({ initialized: false }).success).toBe(false); expect(catalogSchema.parse({ categories: [], initialized: false }).categories).toEqual([]); });
  it("la imagen siempre viaja explícita para no borrarla por omisión", () => {
    expect(createCategorySchema.safeParse({ ...creation, imagePath: undefined }).success).toBe(false);
    expect(updateCategorySchema.safeParse({ ...update, imagePath: undefined }).success).toBe(false);
    expect(createCategorySchema.parse({ ...creation, imagePath })).toMatchObject({ imagePath });
  });
  it("acepta una ruta emitida por el servidor", () => { expect(createCategorySchema.safeParse({ ...creation, imagePath }).success).toBe(true); });
  it.each([
    { label: "otra extensión", path: `${owner}/${file}.png` },
    { label: "sin dueño", path: `${file}.webp` },
    { label: "recorrido", path: `../${owner}/${file}.webp` },
    { label: "dueño inválido", path: `otro/${file}.webp` },
    { label: "anidada", path: `${owner}/x/${file}.webp` },
    { label: "url remota", path: `https://example.test/${file}.webp` },
  ])("rechaza una ruta de imagen $label", ({ path }) => { expect(createCategorySchema.safeParse({ ...creation, imagePath: path }).success).toBe(false); expect(updateCategorySchema.safeParse({ ...update, imagePath: path }).success).toBe(false); });
  it("eliminar exige identificador y versión esperada", () => {
    expect(deleteCategorySchema.parse({ id: update.id, expectedVersion: 2 })).toEqual({ id: update.id, expectedVersion: 2 });
    expect(deleteCategorySchema.safeParse({ id: update.id }).success).toBe(false);
    expect(deleteCategorySchema.safeParse({ id: update.id, expectedVersion: 0 }).success).toBe(false);
    expect(deleteCategorySchema.safeParse({ id: update.id, expectedVersion: 1, userId: crypto.randomUUID() }).success).toBe(false);
  });
  it("conserva el catálogo anterior de iconos y agrupa el nuevo sin duplicados", () => {
    for (const icon of ["tag", "home", "cart", "car", "heart", "briefcase", "book", "gift", "utensils", "wallet"]) expect(categoryIcons).toHaveProperty(icon);
    const grouped = categoryIconGroups.flatMap((group) => group.icons);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(Object.keys(categoryIcons).sort());
  });
  it("el catálogo leído incluye imagen y movimientos sin aceptar campos extra", () => {
    const category = { id: crypto.randomUUID(), parent_id: null, kind: "expense", name: "Casa", description: "", color: "blue", icon: "home", image_path: imagePath, movement_count: 3, status: "active", effective_archived: false, version: 1 };
    expect(catalogSchema.parse({ initialized: true, categories: [category] }).categories[0]).toMatchObject({ image_path: imagePath, movement_count: 3 });
    expect(catalogSchema.safeParse({ initialized: true, categories: [{ ...category, image_path: `${owner}/${file}.png` }] }).success).toBe(false);
    expect(catalogSchema.safeParse({ initialized: true, categories: [{ ...category, movement_count: -1 }] }).success).toBe(false);
    expect(catalogSchema.parse({ initialized: true, categories: [{ ...category, owner: crypto.randomUUID() }] }).categories[0]).not.toHaveProperty("owner");
  });
});
