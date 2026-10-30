// Image preparation on the sending side (STREAM_FORMAT.md §4.3): the
// shareable copy and the manifest preview. Re-encoding through a canvas
// also drops EXIF and other metadata, location included.

const SHARE_LONG_EDGE = 2048;
const SHARE_QUALITY = 0.8;
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
/// `shareable` re-encodes images to at most 2048 px on the long edge as
/// WebP, or JPEG where the browser cannot encode WebP. Images the browser
/// cannot decode (e.g. HEIC outside Safari) are sent as they are.
export async function prepareFile(file, shareable) {
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
    if (!shareable) {
      return { ...original, thumb, note: '原寸: 位置情報などのメタデータもそのまま送られます' };
    }
    let blob = await encode(bitmap, SHARE_LONG_EDGE, 'image/webp', SHARE_QUALITY);
    // Browsers that cannot encode WebP silently return PNG.
    if (blob.type !== 'image/webp') blob = await encode(bitmap, SHARE_LONG_EDGE, 'image/jpeg', SHARE_QUALITY);
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const name = file.name.replace(/\.[^.]*$/, '') + `.${ext}`;
    return { name, mime: blob.type, data: await bytes(blob), thumb, note: `共有用に変換（${bitmap.width}×${bitmap.height} → 長辺 ${Math.min(SHARE_LONG_EDGE, Math.max(bitmap.width, bitmap.height))}px）` };
  } finally {
    bitmap.close();
  }
}
