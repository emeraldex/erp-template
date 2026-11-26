"use client";

/**
 * Shrink a photo before it is sent: at most `maxEdge` pixels on the long edge,
 * re-encoded as JPEG. Re-encoding through a canvas also drops the photo's
 * metadata (including GPS location). Falls back to the original file if the
 * browser cannot decode it.
 */
export async function resizePhoto(file: Blob, maxEdge = 1600, quality = 0.8): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    return file;
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return out ?? file;
}

/** A file name for a resized photo, keeping the original's stem. */
export function photoName(original: string | undefined): string {
  const stem = (original ?? "photo").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 60) || "photo";
  return `${stem}.jpg`;
}
