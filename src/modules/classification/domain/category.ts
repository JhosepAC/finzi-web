import { z } from "zod";

export const categoryColors = { blue: "Azul", green: "Verde", amber: "Ámbar", purple: "Morado", rose: "Rosa", slate: "Gris" } as const;

// Closed catalog. Names are stored in finance.categories.icon; labels stay in Spanish.
export const categoryIcons = {
  tag: "Etiqueta", home: "Casa", sofa: "Sofá", bed: "Cama", lamp: "Lámpara", utensils: "Alimentación", coffee: "Café",
  "shopping-basket": "Canasta", cart: "Compras", shirt: "Ropa", "washing-machine": "Lavandería", wrench: "Arreglos", plug: "Servicios",
  car: "Transporte", bus: "Autobús", "train-front": "Tren", bike: "Bicicleta", plane: "Vuelos", fuel: "Combustible", "parking-circle": "Estacionamiento", ship: "Barco",
  heart: "Salud", "heart-pulse": "Bienestar", stethoscope: "Consultas", pill: "Medicamentos", dumbbell: "Deporte", baby: "Bebés", "paw-print": "Mascotas",
  book: "Educación", "book-open": "Cursos", "graduation-cap": "Estudios", pencil: "Materiales", laptop: "Tecnología", globe: "Idiomas",
  briefcase: "Trabajo", wallet: "Dinero", "credit-card": "Tarjetas", banknote: "Efectivo", "piggy-bank": "Ahorro", receipt: "Recibos",
  calculator: "Impuestos", "chart-line": "Inversiones", "hand-coins": "Ingresos", "building-2": "Empresa",
  gift: "Regalos", "gamepad-2": "Juegos", music: "Música", film: "Cine", ticket: "Eventos", palette: "Arte", camera: "Fotografía",
  "party-popper": "Fiestas", tent: "Viajes", "map-pin": "Lugares",
  star: "Favoritos", sparkles: "Personal", users: "Familia", smartphone: "Móvil", wifi: "Internet", "shield-check": "Seguros",
  leaf: "Naturaleza", sun: "Clima", repeat: "Suscripciones", folder: "Archivo",
} as const;
export type CategoryIcon = keyof typeof categoryIcons;
const iconNames = Object.keys(categoryIcons) as [CategoryIcon, ...CategoryIcon[]];

export const categoryIconGroups: { label: string; icons: CategoryIcon[] }[] = [
  { label: "Hogar y día a día", icons: ["home", "sofa", "bed", "lamp", "utensils", "coffee", "shopping-basket", "cart", "shirt", "washing-machine", "wrench", "plug"] },
  { label: "Transporte", icons: ["car", "bus", "train-front", "bike", "plane", "fuel", "parking-circle", "ship"] },
  { label: "Salud y bienestar", icons: ["heart", "heart-pulse", "stethoscope", "pill", "dumbbell", "baby", "paw-print"] },
  { label: "Educación", icons: ["book", "book-open", "graduation-cap", "pencil", "laptop", "globe"] },
  { label: "Dinero y trabajo", icons: ["briefcase", "wallet", "credit-card", "banknote", "piggy-bank", "receipt", "calculator", "chart-line", "hand-coins", "building-2"] },
  { label: "Ocio", icons: ["gift", "gamepad-2", "music", "film", "ticket", "palette", "camera", "party-popper", "tent", "map-pin"] },
  { label: "Otros", icons: ["tag", "star", "sparkles", "users", "smartphone", "wifi", "shield-check", "leaf", "sun", "repeat", "folder"] },
];

// Server-issued path: <owner uuid>/<file uuid>.webp. Ownership is enforced by SQL and Storage RLS.
const imagePath = z.string().max(200).regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/).nullable();
const fields = {
  name: z.string().trim().min(1, "Escribe un nombre para la categoría.").max(80, "Usa como máximo 80 caracteres."),
  description: z.string().trim().max(300, "Usa como máximo 300 caracteres."),
  color: z.enum(["blue", "green", "amber", "purple", "rose", "slate"]),
  icon: z.enum(iconNames),
  imagePath,
};
export const createCategorySchema = z.object({ ...fields, requestId: z.uuid(), parentId: z.uuid().nullable(), kind: z.enum(["income", "expense"]) }).strict();
export const updateCategorySchema = z.object({ ...fields, id: z.uuid(), archived: z.boolean(), expectedVersion: z.number().int().min(1).max(2147483646) }).strict();
export const deleteCategorySchema = z.object({ id: z.uuid(), expectedVersion: z.number().int().min(1).max(2147483646) }).strict();
export const initializeCategoriesSchema = z.object({ action: z.literal("initialize") }).strict();
export type Category = { id: string; parent_id: string | null; kind: "income" | "expense"; name: string; description: string; color: keyof typeof categoryColors; icon: CategoryIcon; image_path: string | null; movement_count: number; status: "active" | "archived"; effective_archived: boolean; version: number };
export type CategoryCatalog = { categories: Category[]; initialized: boolean };
export const catalogSchema = z.object({ initialized: z.boolean(), categories: z.array(z.object({
  id: z.uuid(), parent_id: z.uuid().nullable(), kind: z.enum(["income", "expense"]),
  name: fields.name, description: fields.description, color: fields.color, icon: fields.icon,
  image_path: imagePath, movement_count: z.number().int().min(0),
  status: z.enum(["active", "archived"]), effective_archived: z.boolean(), version: z.number().int().positive(),
})).max(200) });
