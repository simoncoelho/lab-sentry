import { Euler, Matrix4, Quaternion, Vector3 } from "three";

export type Match = { world: [number, number, number]; image: [number, number]; model: [number, number] };
export type Alignment = { camera: Matrix4; fov: number; rms: number };

// Fit a pinhole camera near the current mount. Coordinates are normalized to
// image width/height; camera matrices use Three's right/up/backward frame.
export function fitAlignment(matches: Match[], initial: Matrix4, fov: number, aspect: number, fitLens = true): Alignment {
  if (matches.length < 6) throw new Error("Match at least six points.");
  for (const axis of [0, 1]) {
    const values = matches.map(m => m.image[axis]);
    if (Math.max(...values) - Math.min(...values) < .15) throw new Error("Spread points across the image, in both directions.");
  }
  const position = new Vector3(), rotation = new Quaternion();
  initial.decompose(position, rotation, new Vector3());
  const camera = (p: number[]) => new Matrix4().compose(
    position.clone().add(new Vector3(p[0], p[1], p[2]).multiplyScalar(.1)),
    rotation.clone().multiply(new Quaternion().setFromEuler(new Euler(p[3], p[4], p[5]))), new Vector3(1, 1, 1));
  const residual = (p: number[]) => {
    const inverse = camera(p).invert(), focal = 1 / (2 * Math.tan(p[6] * Math.PI / 360));
    return matches.flatMap(m => {
      const v = new Vector3(...m.world).applyMatrix4(inverse);
      if (v.z >= -.001) return [100, 100];
      return [.5 + focal * v.x / -v.z - m.image[0], .5 - focal * aspect * v.y / -v.z - m.image[1]];
    });
  };
  let p = [0, 0, 0, 0, 0, 0, fov], lambda = .001;
  const cost = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  for (let iteration = 0; iteration < 180; iteration++) {
    const r = residual(p), score = cost(r);
    const parameters = fitLens ? p : p.slice(0, 6);
    const jacobian = parameters.map((_, column) => {
      const next = [...p], step = column === 6 ? .001 : .00001;
      next[column] += step;
      return residual(next).map((value, row) => (value - r[row]) / step);
    });
    const a = parameters.map((_, i) => parameters.map((__, j) => jacobian[i].reduce((sum, v, k) => sum + v * jacobian[j][k], 0)));
    const b = parameters.map((_, i) => -jacobian[i].reduce((sum, v, k) => sum + v * r[k], 0));
    a.forEach((row, i) => { row[i] += lambda * Math.max(row[i], .000001); });
    const delta = solve(a, b);
    if (!delta) { lambda *= 10; continue; }
    const candidate = p.map((v, i) => v + (delta[i] ?? 0));
    candidate[6] = Math.max(30, Math.min(120, candidate[6]));
    if (cost(residual(candidate)) < score) {
      p = candidate; lambda = Math.max(1e-9, lambda / 3);
      if (Math.max(...delta.map(Math.abs)) < 1e-7) break;
    } else lambda *= 5;
  }
  const rms = Math.sqrt(cost(residual(p)) / (matches.length * 2));
  if (!Number.isFinite(rms) || rms > .025) throw new Error("The points don't agree. Undo mismatches or adjust the mount closer and retry.");
  if (fitLens && (p[6] <= 30.01 || p[6] >= 119.99)) throw new Error("Lens fit reached its limit. Use more widely spaced points and retry.");
  return { camera: camera(p), fov: p[6], rms };
}

function solve(matrix: number[][], values: number[]): number[] | null {
  const a = matrix.map((row, i) => [...row, values[i]]), n = values.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-15) return null;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const divisor = a[c][c];
    for (let j = c; j <= n; j++) a[c][j] /= divisor;
    for (let r = 0; r < n; r++) if (r !== c) {
      const factor = a[r][c];
      for (let j = c; j <= n; j++) a[r][j] -= factor * a[c][j];
    }
  }
  return a.map(row => row[n]);
}
