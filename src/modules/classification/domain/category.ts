import { z } from "zod";

export const categoryColors = { blue: "Azul", green: "Verde", amber: "Ámbar", purple: "Morado", rose: "Rosa", slate: "Gris" } as const;
export const categoryIcons = { tag: "Etiqueta", home: "Casa", cart: "Compras", car: "Transporte", heart: "Salud", briefcase: "Trabajo", book: "Educación", gift: "Regalo", utensils: "Alimentación", wallet: "Dinero" } as const;
const fields = {
  name: z.string().trim().min(1, "Escribe un nombre para la categoría.").max(80, "Usa como máximo 80 caracteres."),
  description: z.string().trim().max(300, "Usa como máximo 300 caracteres."),
  color: z.enum(["blue", "green", "amber", "purple", "rose", "slate"]),
  icon: z.enum(["tag", "home", "cart", "car", "heart", "briefcase", "book", "gift", "utensils", "wallet"]),
};
export const createCategorySchema = z.object({ ...fields, requestId: z.uuid(), parentId: z.uuid().nullable(), kind: z.enum(["income", "expense"]) }).strict();
export const updateCategorySchema = z.object({ ...fields, id: z.uuid(), archived: z.boolean(), expectedVersion: z.number().int().min(1).max(2147483646) }).strict();
export const initializeCategoriesSchema = z.object({ action: z.literal("initialize") }).strict();
export type Category = { id: string; parent_id: string | null; kind: "income" | "expense"; name: string; description: string; color: keyof typeof categoryColors; icon: keyof typeof categoryIcons; status: "active" | "archived"; effective_archived: boolean; version: number };
export type CategoryCatalog = { categories: Category[]; initialized: boolean };
export const catalogSchema = z.object({ initialized: z.boolean(), categories: z.array(z.object({
  id: z.uuid(), parent_id: z.uuid().nullable(), kind: z.enum(["income", "expense"]), ...fields,
  status: z.enum(["active", "archived"]), effective_archived: z.boolean(), version: z.number().int().positive(),
})).max(200) });
