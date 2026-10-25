export type ImageProcessing = { noise: number; quality: number; scale: number; seed: number };
export const cleanProcessing: ImageProcessing = { noise: 0, quality: 100, scale: 1, seed: 42 };
export function checkedProcessing(value: ImageProcessing): ImageProcessing {
  if (!Number.isFinite(value.noise) || value.noise < 0 || value.noise > 12 || !Number.isFinite(value.quality) || value.quality < 40 || value.quality > 100 || !Number.isFinite(value.scale) || value.scale < .25 || value.scale > 1 || !Number.isInteger(value.seed)) throw new Error('Invalid image processing settings');
  return value;
}
export function addNoise(data: Uint8ClampedArray, amount: number, seed: number) {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state + 1) / 4294967297; };
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i+c] += amount * Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
}
function blob(canvas: OffscreenCanvas, type = 'image/png', quality?: number): Promise<Blob> {
  return canvas.convertToBlob({ type, quality });
}
export async function processImage(source: Blob, settings: ImageProcessing = cleanProcessing, id = ''): Promise<Blob> {
  const p = checkedProcessing(settings);
  if (!p.noise && p.quality === 100 && p.scale === 1) return source;
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    const small = new OffscreenCanvas(Math.round(bitmap.width * p.scale), Math.round(bitmap.height * p.scale));
    small.getContext('2d')!.drawImage(bitmap, 0, 0, small.width, small.height);
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    if (p.noise) {
      let seed = p.seed; for (const character of id) seed = Math.imul(seed, 31) + character.charCodeAt(0) | 0;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height); addNoise(pixels.data, p.noise, seed); ctx.putImageData(pixels, 0, 0);
    }
    if (p.quality < 100) {
      const compressed = await createImageBitmap(await blob(canvas, 'image/jpeg', p.quality / 100));
      try { ctx.drawImage(compressed, 0, 0); } finally { compressed.close(); }
    }
    // Lossless packaging preserves the preview pixels and 1280×720 label coordinates.
    return await blob(canvas);
  } finally { bitmap.close(); }
}
