import { CONFIG } from "./config";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function resizeImage(file: File): Promise<Blob> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Images must be 8 MB or smaller.");
  }

  const source = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The image could not be processed.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The image could not be prepared for upload.")),
      "image/webp",
      0.85,
    );
  });
}

export async function uploadGameImage(file: File): Promise<string> {
  try {
    const image = await resizeImage(file);
    const form = new FormData();
    form.append("file", image, `${Date.now()}.webp`);
    form.append("upload_preset", CONFIG.cloudinary.uploadPreset);
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CONFIG.cloudinary.cloudName}/image/upload`,
      { method: "POST", body: form },
    );
    if (!response.ok) throw new Error("Cloudinary rejected the upload.");
    const result = (await response.json()) as { secure_url?: string };
    if (!result.secure_url) throw new Error("Cloudinary returned no image URL.");
    return result.secure_url;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("The image could not be uploaded.");
  }
}

export function cloudinaryUrl(url: string, width: 600 | 1200 = 600) {
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) {
    return url;
  }
  return url.replace("/upload/", `/upload/f_auto,q_auto,w_${width}/`);
}
