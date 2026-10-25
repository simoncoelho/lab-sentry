export type Lighting = { exposure: number; tint: [number, number, number] };
export const defaultLighting: Lighting = { exposure: .9, tint: [1, 1, 1] };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Compare neutral midtones in the lower image (the deck), excluding clipped
// highlights, black enclosure and colored labware. This is a visual estimate,
// not recovery of physical light positions or camera response curves.
export function neutralMidtones(data: Uint8ClampedArray, width: number, height: number): number[] {
  const channels: number[][] = [[], [], []];
  for (let y = Math.floor(height * .35); y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * 4, rgb = [data[i], data[i + 1], data[i + 2]];
    const high = Math.max(...rgb), low = Math.min(...rgb);
    if (low < 35 || high > 235 || (high - low) / high > .26 || data[i + 3] < 250) continue;
    rgb.forEach((v, c) => channels[c].push(v / 255));
  }
  if (channels[0].length < 100) throw new Error("Not enough neutral deck surface is visible. Aim at the deck and try again.");
  return channels.map(values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
}

export function matchLighting(actual: number[], expected: number[], current: Lighting): Lighting {
  const luminance = (rgb: number[]) => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  const ratio = luminance(actual) / luminance(expected);
  const tint = current.tint.map((value, i) => clamp(value * clamp(actual[i] / expected[i] / ratio, .85, 1.15), .7, 1.3)) as Lighting["tint"];
  return { exposure: clamp(current.exposure * clamp(ratio ** 2.2, .5, 2), .3, 2.5), tint };
}

export function sampleFrame(source: CanvasImageSource) {
  const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return neutralMidtones(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}
