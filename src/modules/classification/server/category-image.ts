import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

export const categoryImageBucket = "category-images";
export const maxCategoryImageBytes = 1024 * 1024;
const pathPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export function isOwnedCategoryImage(path: string, userId: string) {
  const match = pathPattern.exec(path);
  return Boolean(match && match[1] === userId);
}

/** Decodes with sharp, crops to a square and re-encodes as WebP so metadata never reaches storage. */
export async function normalizeCategoryImage(input: Buffer) {
  const image = sharp(input, { limitInputPixels: 16_000_000, failOn: "error", animated: false });
  const metadata = await image.metadata();
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) throw new Error("FORMAT");
  const output = await image.rotate().resize(512, 512, { fit: "cover", position: "centre" }).webp({ quality: 82, effort: 4 }).toBuffer();
  if (output.byteLength > 512 * 1024) throw new Error("SIZE");
  return output;
}

export async function uploadCategoryImage(client: SupabaseClient, userId: string, input: Buffer) {
  const output = await normalizeCategoryImage(input);
  const path = `${userId}/${crypto.randomUUID()}.webp`;
  const { error } = await client.storage.from(categoryImageBucket).upload(path, output, { contentType: "image/webp", cacheControl: "3600", upsert: false });
  if (error) throw new Error("UPLOAD");
  return path;
}

export async function downloadCategoryImage(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage.from(categoryImageBucket).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteCategoryImage(client: SupabaseClient, path: string) {
  try { await client.storage.from(categoryImageBucket).remove([path]); } catch { /* The database row is already authoritative; an orphan is not exposed. */ }
}
