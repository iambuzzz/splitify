import type { ReceiptFile } from '../data/StoreProvider';

const MAX_SIDE = 1600;
const MAX_PDF = 10 * 1024 * 1024;

/**
 * Gets a picked file ready to attach (web). Photos are redrawn at most 1600 px on the long side as
 * JPEG: small enough for a phone connection, still readable, and redrawing drops the hidden data
 * cameras add (GPS location, device). PDFs go as they are, up to 10 MB.
 */
export async function prepareReceipt(file: File): Promise<ReceiptFile> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF) throw new Error('That PDF is over 10 MB. Try a smaller file or a photo of the bill.');
    return { blob: file, type: 'application/pdf' };
  }
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    throw new Error('Only photos and PDFs can be attached.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This photo couldn’t be read here. Try a JPEG or PNG (or a screenshot of it).');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser couldn’t prepare the photo.');
  // White behind transparent images (screenshots with alpha), since JPEG has no transparency.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('This browser couldn’t prepare the photo.');
  return { blob, type: 'image/jpeg', width, height };
}
