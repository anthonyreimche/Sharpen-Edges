// The CPU transcription the GPU spec compares against, held to rawtherapee-cli:
// rawtherapee.json is RawTherapee 5.13's Sharpen Edges on a 64 x 48 scene (see
// its `about`), and the rest pin the behaviours the transcription must keep.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { labToRgb, mlSharpen, rgbToLab, sharpenEdges, type EdgeParams, type RgbImage } from "./rtref";

interface Fixture {
  width: number;
  height: number;
  input: string;
  cases: { name: string; params: EdgeParams; output: string }[];
}

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "rawtherapee.json"), "utf8")) as Fixture;

const floats = (b64: string) => {
  const bytes = Buffer.from(b64, "base64");
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
};

const input: RgbImage = { width: fixture.width, height: fixture.height, data: floats(fixture.input) };

// RawTherapee reads the TIFF through its input profile, which moves the input
// by up to 1.75e-5 (the fixture's `about`). MLsharpen decides by strict
// comparisons between neighbours, so on a and b, where near-neutral pixels
// differ by a hair, that noise flips a branch here and there and the result
// differs there by up to a few 1e-3. Perturbing this transcription's own input
// by 1e-5 relative does the same (28 to 84 values off by more than 1e-4 of
// 9,216), so the bound is on how many values are off, not on the worst. The
// luminance channel has far fewer such pixels (4 to 7 of 9,216 under the same
// perturbation) but not none, so it gets a tighter count bound, not an exact one.
const AB_CASES = new Set(["default", "1 pass", "4 passes", "strength 100"]);

describe("the transcription", () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))("renders RawTherapee's output: %s", (name, c) => {
    const want = floats(c.output);
    const got = sharpenEdges(input, c.params).data;
    let worst = 0;
    let moved = 0;
    let off = 0;
    let sum = 0;
    for (let i = 0; i < want.length; i++) {
      const d = Math.abs(got[i] - want[i]);
      worst = Math.max(worst, d);
      moved = Math.max(moved, Math.abs(want[i] - input.data[i]));
      sum += d;
      if (d > 1e-4) off++;
    }
    expect(moved, "RawTherapee changed the scene").toBeGreaterThan(0.01);
    expect(sum / want.length).toBeLessThan(2e-5);
    if (AB_CASES.has(name)) {
      expect(off / want.length).toBeLessThan(0.01);
      expect(worst).toBeLessThan(2e-2);
    } else {
      expect(off / want.length).toBeLessThan(0.002);
      expect(worst).toBeLessThan(2e-2);
    }
  });

  // The scene has a patch brighter than L* 92, where the tool leaves L alone
  // (a and b still move), so that rule is pinned to rawtherapee-cli and not
  // only to this transcription.
  it.each(fixture.cases.map((c) => [c.name, c] as const))("leaves the lightness of the bright patch alone: %s", (_name, c) => {
    const before = rgbToLab(input);
    const after = rgbToLab({ ...input, data: floats(c.output) });
    const w = fixture.width;
    let bright = 0;
    let worst = 0;
    for (let y = 2; y < fixture.height - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const k = y * w + x;
        if (before.L[k] / 327.68 < 92) continue;
        bright++;
        worst = Math.max(worst, Math.abs(after.L[k] - before.L[k]) / 327.68);
      }
    }
    expect(bright, "interior pixels at L* 92 and up").toBeGreaterThan(40);
    expect(worst).toBeLessThan(0.05);
  });
});

describe("the Lab round trip", () => {
  it("returns the input to float rounding", () => {
    const back = labToRgb(rgbToLab(input)).data;
    let worst = 0;
    for (let i = 0; i < back.length; i++) worst = Math.max(worst, Math.abs(back[i] - input.data[i]));
    expect(worst).toBeLessThan(5e-6);
  });

  it("puts a mid grey at L* 50 and neutral", () => {
    const grey: RgbImage = { width: 1, height: 1, data: new Float32Array([0.18418651, 0.18418651, 0.18418651]) };
    const lab = rgbToLab(grey);
    expect(lab.L[0] / 327.68).toBeCloseTo(50, 2);
    expect(Math.abs(lab.a[0] / 327.68)).toBeLessThan(0.05);
    expect(Math.abs(lab.b[0] / 327.68)).toBeLessThan(0.05);
  });
});

describe("MLsharpen", () => {
  const ramp = (w: number, h: number, fn: (x: number, y: number) => number) => {
    const lab = rgbToLab({ width: w, height: h, data: new Float32Array(3 * w * h) });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lab.L[y * w + x] = fn(x, y) * 327.68;
    return lab;
  };
  // A soft vertical edge from L* 20 to L* 70 over six pixels.
  const edge = () => ramp(24, 12, (x) => 20 + (50 * Math.min(Math.max(x - 9, 0), 6)) / 6);
  const params: EdgeParams = { passes: 2, amount: 100, luminanceOnly: true };

  it("does nothing at a amount of 0", () => {
    const lab = edge();
    const before = Float32Array.from(lab.L);
    mlSharpen(lab, { ...params, amount: 0 });
    expect(lab.L).toEqual(before);
  });

  it("firms up a soft edge: the foot gets darker and the shoulder brighter, within the edge's range", () => {
    const lab = edge();
    const before = Float32Array.from(lab.L);
    mlSharpen(lab, params);
    const row = 6 * 24;
    const steps = [...Array(24).keys()].map((x) => (lab.L[row + x] - before[row + x]) / 327.68);
    expect(Math.min(...steps)).toBeLessThan(-0.5);
    expect(Math.max(...steps)).toBeGreaterThan(0.5);
    for (let x = 0; x < 24; x++) {
      expect(lab.L[row + x] / 327.68).toBeGreaterThanOrEqual(19.99);
      expect(lab.L[row + x] / 327.68).toBeLessThanOrEqual(70.01);
    }
  });

  it("leaves the two outer rows and columns alone", () => {
    const lab = edge();
    const before = Float32Array.from(lab.L);
    mlSharpen(lab, params);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 24; x++) {
        if (x >= 2 && x < 22 && y >= 2 && y < 10) continue;
        expect(lab.L[y * 24 + x]).toBe(before[y * 24 + x]);
      }
    }
  });

  it("leaves a pixel of L* 92 or more alone", () => {
    const lab = ramp(24, 12, (x) => 85 + Math.min(Math.max(x - 9, 0), 6) * 3);
    const before = Float32Array.from(lab.L);
    mlSharpen(lab, params);
    for (let i = 0; i < before.length; i++) if (before[i] / 327.68 >= 92) expect(lab.L[i]).toBe(before[i]);
    expect(lab.L).not.toEqual(before);
  });

  it("leaves a and b alone when it is luminance only, and works on them otherwise", () => {
    const make = () => {
      const lab = edge();
      for (let y = 0; y < 12; y++) for (let x = 0; x < 24; x++) lab.a[y * 24 + x] = (x < 12 ? -30 : 30) * 327.68 * (1 + 0.1 * Math.sin(x));
      return lab;
    };
    const only = make();
    mlSharpen(only, params);
    expect(only.a).toEqual(make().a);
    const all = make();
    mlSharpen(all, { ...params, luminanceOnly: false });
    expect(all.a).not.toEqual(make().a);
  });

  it("works each channel from its own values, so L is the same with or without a and b", () => {
    const withAb = edge();
    for (let i = 0; i < withAb.a.length; i++) withAb.a[i] = ((i * 7919) % 61) * 327.68;
    const only = edge();
    mlSharpen(withAb, { ...params, luminanceOnly: false });
    mlSharpen(only, params);
    expect(withAb.L).toEqual(only.L);
  });

  it("reads a fresh copy of the channel each pass: one pass of two equals two runs of one", () => {
    const twice = edge();
    mlSharpen(twice, { ...params, passes: 2 });
    const stepwise = edge();
    mlSharpen(stepwise, { ...params, passes: 1 });
    mlSharpen(stepwise, { ...params, passes: 1 });
    expect(twice.L).toEqual(stepwise.L);
  });
});
