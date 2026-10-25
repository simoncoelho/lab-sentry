import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { fitAlignment, type Match } from "./alignment";

describe("camera alignment", () => {
  const aspect = 16 / 9, fov = 65;
  const truth = new Matrix4().compose(new Vector3(.04, -.02, .65), new Quaternion().setFromEuler(new Euler(.2, -.3, .05)), new Vector3(1, 1, 1));
  const points = [-.2, 0, .2].flatMap(x => [-.12, .12].map(y => new Vector3(x, y, 0)));
  const matches: Match[] = points.map(point => {
    const v = point.clone().applyMatrix4(truth.clone().invert()), focal = 1 / (2 * Math.tan(fov * Math.PI / 360));
    const image: [number, number] = [.5 + focal * v.x / -v.z, .5 - focal * aspect * v.y / -v.z];
    return { world: point.toArray(), image, model: image };
  });
  it("recovers position, orientation and lens from planar matches near an approximate mount", () => {
    const initial = new Matrix4().compose(new Vector3(.07, -.04, .7), new Quaternion().setFromEuler(new Euler(.23, -.25, .02)), new Vector3(1, 1, 1));
    const result = fitAlignment(matches, initial, 70, aspect);
    expect(result.rms).toBeLessThan(.00001);
    expect(result.fov).toBeCloseTo(fov, 2);
    result.camera.elements.forEach((value, i) => expect(value).toBeCloseTo(truth.elements[i], 3));
  });
  it("rejects too few points and concentrated points", () => {
    expect(() => fitAlignment(matches.slice(0, 4), truth, fov, aspect)).toThrow("six");
    expect(() => fitAlignment(matches.map(m => ({ ...m, image: [.5, .5] })), truth, fov, aspect)).toThrow("Spread");
  });
  it("keeps the lens fixed when fitting only the mount", () => {
    const initial = truth.clone().setPosition(.06, -.04, .7);
    const result = fitAlignment(matches, initial, fov, aspect, false);
    expect(result.fov).toBe(fov);
    expect(result.rms).toBeLessThan(.00001);
    result.camera.elements.forEach((value, i) => expect(value).toBeCloseTo(truth.elements[i], 3));
  });
  it("rejects inconsistent correspondences", () => {
    const wrong = matches.map((m, i) => ({ ...m, image: matches[(i * 3 + 1) % matches.length].image }));
    expect(() => fitAlignment(wrong, truth, fov, aspect)).toThrow();
  });
});
