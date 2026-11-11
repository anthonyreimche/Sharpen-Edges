// A float32 transcription of RawTherapee 5.13's Sharpen Edges, for the GPU spec
// to compare against and held to rawtherapee-cli by rtref.test.ts.
//
// MLsharpen is rtengine/ipsharpenedges.cc (© 2004-2020 Gabor Horvath; the
// algorithm is Manuel Llorens', who has waived his rights to it). The Lab
// conversions are ImProcFunctions::rgb2lab (improcfun.cc), Color::XYZ2Lab and
// Color::Lab2XYZ (color.cc, color.h) with the "sRGB" working matrices of
// iccmatrices.h, all © 2004-2010 Gabor Horvath. GPL-3.0-or-later.
//
// RawTherapee's loops, borders and quirks are kept, and every operation rounds
// to float32 as the C++ does. Two things are exact rather than tabulated:
// cachef and cachefy are looked up in a 65536-entry table with linear
// interpolation, and here they are the formulas the table is filled from (the
// two differ by under 1e-9 relative).

export interface RgbImage {
  width: number;
  height: number;
  /** Linear Rec.709, RGB interleaved. */
  data: Float32Array;
}

export interface EdgeParams {
  passes: number;
  amount: number;
  luminanceOnly: boolean;
}

const f = Math.fround;

const MAXVALF = f(65535);
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;
const D50X = f(0.9642);
const D50Z = f(0.8249);
const C32768 = f(327.68);

/** xyz_sRGB and sRGB_xyz of iccmatrices.h, as the float copies the conversions use. */
const RGB_TO_XYZ = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
].map((row) => row.map(f));
const XYZ_TO_RGB = [
  [3.1338561, -1.6168667, -0.4906146],
  [-0.9787684, 1.9161415, 0.0334540],
  [0.0719453, -0.2289914, 1.4052427],
].map((row) => row.map(f));

const dot3 = (m: number[], a: number, b: number, c: number) => f(f(f(m[0] * a) + f(m[1] * b)) + f(m[2] * c));

function computeXYZ2Lab(v: number): number {
  if (v < 0) return f(327.68 * ((KAPPA * v) / 65535 + 16) / 116);
  return f(327.68 * (v > EPS * 65535 ? Math.cbrt(v / 65535) : (KAPPA * v) / 65535 / 116 + 16 / 116));
}

function computeXYZ2LabY(v: number): number {
  if (v < 0) return f(327.68 * ((KAPPA * v) / 65535));
  return f(327.68 * (v > EPS * 65535 ? 116 * Math.cbrt(v / 65535) - 16 : (KAPPA * v) / 65535));
}

export interface LabImage {
  width: number;
  height: number;
  /** RawTherapee's units: L from 0 to 32768, a and b the same scale. */
  L: Float32Array;
  a: Float32Array;
  b: Float32Array;
}

/** ImProcFunctions::rgb2lab with the sRGB working matrix; RGB 0..1 becomes 0..65535 first. */
export function rgbToLab(img: RgbImage): LabImage {
  const n = img.width * img.height;
  const lab: LabImage = { width: img.width, height: img.height, L: new Float32Array(n), a: new Float32Array(n), b: new Float32Array(n) };
  for (let k = 0; k < n; k++) {
    const r = f(img.data[3 * k] * 65535);
    const g = f(img.data[3 * k + 1] * 65535);
    const b = f(img.data[3 * k + 2] * 65535);
    const X = dot3(RGB_TO_XYZ[0], r, g, b);
    const Y = dot3(RGB_TO_XYZ[1], r, g, b);
    const Z = dot3(RGB_TO_XYZ[2], r, g, b);
    const x = f(X / D50X);
    const z = f(Z / D50Z);
    const fx = computeXYZ2Lab(x);
    const fy = computeXYZ2Lab(Y);
    const fz = computeXYZ2Lab(z);
    lab.L[k] = computeXYZ2LabY(Y);
    lab.a[k] = f(500 * f(fx - fy));
    lab.b[k] = f(200 * f(fy - fz));
  }
  return lab;
}

const f2xyz = (v: number) => (v > f(6 / 29) ? f(f(v * v) * v) : f(f(f(116 * v) - 16) * f(27 / 24389)));

/** ImProcFunctions::lab2rgb: Color::Lab2XYZ, then the inverse working matrix. */
export function labToRgb(lab: LabImage): RgbImage {
  const n = lab.width * lab.height;
  const out = new Float32Array(3 * n);
  const epskap = 8;
  for (let k = 0; k < n; k++) {
    const LL = f(lab.L[k] / C32768);
    const aa = f(lab.a[k] / C32768);
    const bb = f(lab.b[k] / C32768);
    const fy = f(f(f(1 / 116) * LL) + f(16 / 116));
    const fx = f(f(f(0.002) * aa) + fy);
    const fz = f(fy - f(f(0.005) * bb));
    const x = f(f(MAXVALF * f2xyz(fx)) * D50X);
    const z = f(f(MAXVALF * f2xyz(fz)) * D50Z);
    const y = LL > epskap ? f(f(f(MAXVALF * fy) * fy) * fy) : f(f(MAXVALF * LL) / f(KAPPA));
    out[3 * k] = f(dot3(XYZ_TO_RGB[0], x, y, z) / 65535);
    out[3 * k + 1] = f(dot3(XYZ_TO_RGB[1], x, y, z) / 65535);
    out[3 * k + 2] = f(dot3(XYZ_TO_RGB[2], x, y, z) / 65535);
  }
  return { width: lab.width, height: lab.height, data: out };
}

const CHMAX = [f(1 / 8), f(1 / 3), f(1 / 3)];
const EPS2 = f(0.001);

const sqr = (v: number) => f(v * v);
const abs = Math.abs;
const sqrt = (v: number) => f(Math.sqrt(v));
const intp = (a: number, b: number, c: number) => f(f(a * f(b - c)) + c);
const sub = (a: number, b: number) => f(a - b);
const mul = (a: number, b: number) => f(a * b);

function inintervalLoRo(a: number, b: number, c: number): boolean {
  return a < Math.max(b, c) && a > Math.min(b, c);
}

/** The SSE2 build's selectweight, which RawTherapee's x86-64 builds use. */
function selectweight(a: number, b: number, low: number, high: number): number {
  const minVal = Math.min(a, b);
  const maxVal = Math.max(a, b);
  const res = minVal < f(f(0.45) * maxVal) ? low : high;
  return minVal > f(f(0.05) * maxVal) ? res : high;
}

/**
 * ImProcFunctions::MLsharpen, on the Lab image in place. `store`, which
 * RawTherapee has no use for, rounds every value a pass leaves behind, so the
 * GPU spec can model targets that keep half floats.
 */
export function mlSharpen(lab: LabImage, p: EdgeParams, store?: (v: number) => number): void {
  if (p.amount === 0) return;
  const width = lab.width;
  const height = lab.height;
  const width2 = 2 * width;
  const amount = f(p.amount / 100);
  const amountby3 = f(p.amount / 300);
  const L = new Float32Array(width * height);
  const channels = p.luminanceOnly ? 1 : 3;

  for (let c = 0; c < channels; c++) {
    const channel = c === 0 ? lab.L : c === 1 ? lab.a : lab.b;
    for (let pass = 0; pass < p.passes; pass++) {
      for (let k = 0; k < width * height; k++) L[k] = f(channel[k] / C32768);

      for (let j = 2; j < height - 2; j++) {
        for (let i = 2, offset = j * width + i; i < width - 2; i++, offset++) {
          const wH = f(EPS2 + abs(sub(L[offset + 1], L[offset - 1])));
          const wV = f(EPS2 + abs(sub(L[offset + width], L[offset - width])));

          let s = f(2 / f(2 + abs(sub(wH, wV))));
          let wD1 = f(EPS2 + mul(abs(sub(L[offset + width + 1], L[offset - width - 1])), s));
          let wD2 = f(EPS2 + mul(abs(sub(L[offset + width - 1], L[offset - width + 1])), s));
          s = wD1;
          wD1 = f(wD1 / wD2);
          wD2 = f(wD2 / s);

          const v = L[offset];
          let lumH = v;
          let lumV = v;
          let lumD1 = v;
          let lumD2 = v;

          const contrast = Math.min(mul(sqrt(f(sqr(sub(L[offset + 1], L[offset - 1])) + sqr(sub(L[offset + width], L[offset - width])))), CHMAX[c]), 1);

          if (inintervalLoRo(v, L[offset - 1], L[offset + 1])) {
            let f1 = abs(sub(L[offset - 2], L[offset - 1]));
            let f2 = sub(L[offset - 1], v);
            let f3 = mul(sub(L[offset - 1], L[offset - width]), sub(L[offset - 1], L[offset + width]));
            let f4 = sqrt(abs(mul(sub(L[offset - 1], L[offset - width2]), sub(L[offset - 1], L[offset + width2]))));
            const difL = mul(mul(f1, sqr(mul(f2, f3))), f4);
            if (difL > 0) {
              f1 = abs(sub(L[offset + 2], L[offset + 1]));
              f2 = sub(L[offset + 1], v);
              f3 = mul(sub(L[offset + 1], L[offset - width]), sub(L[offset + 1], L[offset + width]));
              f4 = sqrt(abs(mul(sub(L[offset + 1], L[offset - width2]), sub(L[offset + 1], L[offset + width2]))));
              const difR = mul(mul(f1, sqr(mul(f2, f3))), f4);
              if (difR > 0) {
                lumH = f(f(f(L[offset - 1] * difR) + f(L[offset + 1] * difL)) / f(difL + difR));
                lumH = intp(contrast, lumH, v);
              }
            }
          }

          if (inintervalLoRo(v, L[offset - width], L[offset + width])) {
            let f1 = abs(sub(L[offset - width2], L[offset - width]));
            let f2 = sub(L[offset - width], v);
            let f3 = mul(sub(L[offset - width], L[offset - 1]), sub(L[offset - width], L[offset + 1]));
            let f4 = sqrt(abs(mul(sub(L[offset - width], L[offset - 2]), sub(L[offset - width], L[offset + 2]))));
            const difT = mul(mul(f1, sqr(mul(f2, f3))), f4);
            if (difT > 0) {
              f1 = abs(sub(L[offset + width2], L[offset + width]));
              f2 = sub(L[offset + width], v);
              f3 = mul(sub(L[offset + width], L[offset - 1]), sub(L[offset + width], L[offset + 1]));
              f4 = sqrt(abs(mul(sub(L[offset + width], L[offset - 2]), sub(L[offset + width], L[offset + 2]))));
              const difB = mul(mul(f1, sqr(mul(f2, f3))), f4);
              if (difB > 0) {
                lumV = f(f(f(L[offset - width] * difB) + f(L[offset + width] * difT)) / f(difT + difB));
                lumV = intp(contrast, lumV, v);
              }
            }
          }

          if (inintervalLoRo(v, L[offset - 1 - width], L[offset + 1 + width])) {
            let f1 = abs(sub(L[offset - 2 - width2], L[offset - 1 - width]));
            let f2 = sub(L[offset - 1 - width], v);
            let f3 = mul(sub(L[offset - 1 - width], L[offset - width + 1]), sub(L[offset - 1 - width], L[offset + width - 1]));
            let f4 = sqrt(abs(mul(sub(L[offset - 1 - width], L[offset - width2 + 2]), sub(L[offset - 1 - width], L[offset + width2 - 2]))));
            const difLT = mul(mul(f1, sqr(mul(f2, f3))), f4);
            if (difLT > 0) {
              f1 = abs(sub(L[offset + 2 + width2], L[offset + 1 + width]));
              f2 = sub(L[offset + 1 + width], v);
              f3 = mul(sub(L[offset + 1 + width], L[offset - width + 1]), sub(L[offset + 1 + width], L[offset + width - 1]));
              f4 = sqrt(abs(mul(sub(L[offset + 1 + width], L[offset - width2 + 2]), sub(L[offset + 1 + width], L[offset + width2 - 2]))));
              const difRB = mul(mul(f1, sqr(mul(f2, f3))), f4);
              if (difRB > 0) {
                lumD1 = f(f(f(L[offset - 1 - width] * difRB) + f(L[offset + 1 + width] * difLT)) / f(difLT + difRB));
                lumD1 = intp(contrast, lumD1, v);
              }
            }
          }

          if (inintervalLoRo(v, L[offset + 1 - width], L[offset - 1 + width])) {
            let f1 = abs(sub(L[offset - 2 + width2], L[offset - 1 + width]));
            let f2 = sub(L[offset - 1 + width], v);
            let f3 = mul(sub(L[offset - 1 + width], L[offset - width - 1]), sub(L[offset - 1 + width], L[offset + width + 1]));
            let f4 = sqrt(abs(mul(sub(L[offset - 1 + width], L[offset - width2 - 2]), sub(L[offset - 1 + width], L[offset + width2 + 2]))));
            const difLB = mul(mul(f1, sqr(mul(f2, f3))), f4);
            if (difLB > 0) {
              f1 = abs(sub(L[offset + 2 - width2], L[offset + 1 - width]));
              f2 = sub(L[offset + 1 - width], v);
              f3 = mul(sub(L[offset + 1 - width], L[offset + width + 1]), sub(L[offset + 1 - width], L[offset - width - 1]));
              f4 = sqrt(abs(mul(sub(L[offset + 1 - width], L[offset + width2 + 2]), sub(L[offset + 1 - width], L[offset - width2 - 2]))));
              const difRT = mul(mul(f1, sqr(mul(f2, f3))), f4);
              if (difRT > 0) {
                lumD2 = f(f(f(L[offset + 1 - width] * difLB) + f(L[offset - 1 + width] * difRT)) / f(difLB + difRT));
                lumD2 = intp(contrast, lumD2, v);
              }
            }
          }

          const weight = selectweight(wH, wV, amountby3, amount);
          const mixed = f(f(f(f(mul(lumH, wH) + mul(lumV, wV)) + mul(lumD1, wD1)) + mul(lumD2, wD2)) / f(f(f(wH + wV) + wD1) + wD2));
          const out = intp(weight, mixed, v);
          if (c === 0) {
            if (v < 92) channel[j * width + i] = abs(mul(C32768, out));
          } else {
            channel[j * width + i] = mul(C32768, out);
          }
        }
      }
      if (store) for (let k = 0; k < channel.length; k++) channel[k] = store(channel[k]);
    }
  }
  if (store && p.luminanceOnly) {
    for (const channel of [lab.a, lab.b]) for (let k = 0; k < channel.length; k++) channel[k] = store(channel[k]);
  }
}

/** Sharpen Edges on a linear Rec.709 image: to Lab, MLsharpen, back. */
export function sharpenEdges(img: RgbImage, p: EdgeParams): RgbImage {
  const lab = rgbToLab(img);
  mlSharpen(lab, p);
  return labToRgb(lab);
}
