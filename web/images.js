// Image preparation on the sending side (STREAM_FORMAT.md §4.3): the
// compressed copy and the manifest preview. Re-encoding through a canvas
// also drops EXIF and other metadata, location included.

// Compression levels the sender picks from; smaller ones shorten the
// transfer at the cost of detail. Every level re-encodes, so all of them
// drop metadata.
export const IMAGE_LEVELS = {
  high: { longEdge: 2048, quality: 0.8 },
  standard: { longEdge: 1280, quality: 0.7 },
  light: { longEdge: 800, quality: 0.6 },
};
const THUMB_LONG_EDGE = 160;
const THUMB_QUALITY = 0.6;

async function encode(bitmap, longEdge, type, quality) {
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type, quality });
}

const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

/// What to send for `file`: { name, mime, data, thumb, note }.
/// `level` (one of IMAGE_LEVELS, or null for the original bytes) re-encodes
/// images to at most its long edge as WebP, or JPEG where the browser
/// cannot encode WebP. Images the browser cannot decode (e.g. HEIC outside
/// Safari) are sent as they are.
export async function prepareFile(file, level) {
  const mime = file.type || 'application/octet-stream';
  const original = { name: file.name, mime, data: await bytes(file), thumb: new Uint8Array(0), note: '' };
  if (!mime.startsWith('image/')) return original;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ...original, note: 'このブラウザでは画像を読めないため、そのまま送ります' };
  }
  try {
    const thumb = await bytes(await encode(bitmap, THUMB_LONG_EDGE, 'image/jpeg', THUMB_QUALITY));
    if (!level) {
      return { ...original, thumb, note: '原寸: 位置情報などのメタデータもそのまま送られます' };
    }
    const { longEdge, quality } = level;
    let blob = await encode(bitmap, longEdge, 'image/webp', quality);
    // Browsers that cannot encode WebP silently return PNG.
    if (blob.type !== 'image/webp') blob = await encode(bitmap, longEdge, 'image/jpeg', quality);
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const name = file.name.replace(/\.[^.]*$/, '') + `.${ext}`;
    return { name, mime: blob.type, data: await bytes(blob), thumb, note: `圧縮（${bitmap.width}×${bitmap.height} → 長辺 ${Math.min(longEdge, Math.max(bitmap.width, bitmap.height))}px、位置情報などは削除）` };
  } finally {
    bitmap.close();
  }
}
