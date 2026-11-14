import { describe, expect, it } from "vitest";
import { createCategorySchema, updateCategorySchema, initializeCategoriesSchema, catalogSchema } from "../../src/modules/classification/domain/category";
const creation = { requestId: crypto.randomUUID(), parentId: null, kind: "expense", name: "  Alimentación  ", description: "  Diario  ", color: "amber", icon: "utensils" };
describe("contrato de categorías", () => {
  it("normaliza solo espacios exteriores y conserva texto propio", () => { expect(createCategorySchema.parse(creation)).toMatchObject({ name: "Alimentación", description: "Diario" }); });
  it.each([{ name: " " }, { name: "x".repeat(81) }, { description: "x".repeat(301) }, { color: "url(evil)" }, { icon: "<script>" }, { kind: "transfer" }, { parentId: "otro" }, { user_id: crypto.randomUUID() }, { archived: false }, { requestId: "no" }])("rechaza campos o valores no admitidos: %j", (input) => { expect(createCategorySchema.safeParse({ ...creation, ...input }).success).toBe(false); });
  const update = { id: crypto.randomUUID(), name: "Casa", description: "", color: "blue", icon: "home", archived: false, expectedVersion: 1 };
  it.each([{ kind: "income" }, { parentId: crypto.randomUUID() }, { expectedVersion: 0 }, { expectedVersion: 1.1 }, { archived: "false" }])("edición no cambia estructura: %j", (input) => { expect(updateCategorySchema.safeParse({ ...update, ...input }).success).toBe(false); });
  it("plantillas no aceptan parámetros o dueño", () => { expect(initializeCategoriesSchema.parse({ action: "initialize" })).toEqual({ action: "initialize" }); expect(initializeCategoriesSchema.safeParse({ action: "initialize", userId: "otro" }).success).toBe(false); });
  it("lectura fallida no se interpreta como catálogo vacío", () => { expect(catalogSchema.safeParse(null).success).toBe(false); expect(catalogSchema.safeParse({ initialized: false }).success).toBe(false); expect(catalogSchema.parse({ categories: [], initialized: false }).categories).toEqual([]); });
});
