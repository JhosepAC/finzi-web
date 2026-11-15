export const maxCategoryImageFileBytes = 1024 * 1024;
export const categoryImageTypes = ["image/png", "image/jpeg", "image/webp"];
export type PreparedCategoryImage = { blob: Blob; preview: string };
export const categoryImageUrl = (path: string) => `/api/v1/categories/image?path=${encodeURIComponent(path)}`;

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("READ")); reader.readAsDataURL(file);
    });
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("DECODE")); element.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  }
}

/** Crops to a square and re-encodes in the browser so the preview and upload never carry metadata. */
export async function prepareCategoryImage(file: File): Promise<PreparedCategoryImage> {
  if (!categoryImageTypes.includes(file.type)) throw new Error("FORMAT");
  if (file.size > maxCategoryImageFileBytes) throw new Error("SIZE");
  const { source, width, height } = await decode(file);
  const side = Math.min(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context || !side) throw new Error("DECODE");
  context.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 512, 512);
  if ("close" in source && typeof source.close === "function") source.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (!blob) throw new Error("ENCODE");
  return { blob, preview: canvas.toDataURL("image/webp", 0.85) };
}
