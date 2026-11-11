// The GPU side of model.ts: MLsharpen from RawTherapee 5.13
// (rtengine/ipsharpenedges.cc, © 2004-2020 Gabor Horvath, the algorithm
// Manuel Llorens', who has waived his rights to it), with the Lab conversions
// of Color::XYZ2Lab and Color::Lab2XYZ (color.cc, color.h, © 2004-2010 Gabor
// Horvath) and the "sRGB" working matrices of iccmatrices.h. GPL-3.0-or-later.
//
// One four-channel pass, one draw per iteration, all three Lab channels in
// the same draw: the tool reads a fresh copy of a channel for each pass and a
// channel never reads another, so doing L, a and b side by side gives what
// doing them one after the other does. The draws carry (L* hi, L* lo, a*, b*)
// / 100, L* split into a half float and its remainder so that the state stays
// near float precision through the iterations. The first draw reads RGB, so it
// converts each of the 17 texels it needs to Lab; the later ones fetch the
// carried state exactly. The last draw writes (L*, a*, b*) / 100 into the rgb
// the inline gets, which is the one place the state is rounded to a half
// float, rounded to the nearest by the shader itself (D3D11 truncates a store
// toward 0, SwiftShader rounds it, and the bias would add up over the draws).
// The input the passes read was stored by the host, in whichever rounding the
// back end has, and the inline measures its change from that same rounding.
// The inline converts that back and adds what the passes changed to the
// pixel it started with, measured from the same rounding of the input, so a
// pixel the passes left alone (the two outer rows and columns, L* 92 and up)
// comes out as it went in.
//
// The constants and helpers are function-local on purpose: a helper block is
// emitted again for every mask that copies the stage, and a global would be
// declared twice.

import { CHANNEL_GAIN, EPS2, L_LIMIT, STATE_SCALE, TAPS } from "./model";

/** A GLSL float literal that always carries a decimal point. */
export function glslLiteral(v: number): string {
  const s = v.toPrecision(10);
  if (/e/i.test(s)) {
    const [mantissa, exponent] = s.split(/e/i);
    const m = mantissa.includes(".") ? mantissa : `${mantissa}.0`;
    return `${m}e${Number(exponent)}`;
  }
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, ".0") : `${s}.0`;
}

const lit = glslLiteral;

/** Texels a draw reads. */
export const MAX_TAPS_PER_DRAW = TAPS.length;

/** The stencil's texels by compass point, in the order of TAPS. */
const NAMES = ["v", "W1", "E1", "W2", "E2", "N1", "S1", "N2", "S2", "NW", "SE", "NE", "SW", "NW2", "SE2", "NE2", "SW2"];

/** The pass's taps as seEdge's arguments, one channel of each. */
const args = (channel: "x" | "y" | "z"): string => TAPS.map((_, k) => `t${k}.${channel}`).join(", ");

/** Lab and back, and the state's half-float rounding; used by the pass and the inline. */
export const SHARED_HELPERS = `
// Color::XYZ2Lab on the sRGB working matrix: RGB to (L*, a*, b*).
vec3 seLab(vec3 rgb) {
  const mat3 toXyz = mat3(0.4360747, 0.2225045, 0.0139322, 0.3850649, 0.7168786, 0.0971045, 0.1430804, 0.0606169, 0.7141733);
  const float eps = ${lit(216 / 24389)};
  const float kappa = ${lit(24389 / 27)};
  vec3 xyz = toXyz * rgb;
  vec3 t = vec3(xyz.x / 0.9642, xyz.y, xyz.z / 0.8249);
  vec3 f = vec3(
    t.x > eps ? pow(t.x, 1.0 / 3.0) : (kappa * t.x + 16.0) / 116.0,
    t.y > eps ? pow(t.y, 1.0 / 3.0) : (kappa * t.y + 16.0) / 116.0,
    t.z > eps ? pow(t.z, 1.0 / 3.0) : (kappa * t.z + 16.0) / 116.0);
  float L = t.y > eps ? 116.0 * f.y - 16.0 : kappa * t.y;
  return vec3(L, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}
// Color::Lab2XYZ, then the inverse working matrix: (L*, a*, b*) to RGB.
vec3 seRgb(vec3 lab) {
  const mat3 fromXyz = mat3(3.1338561, -0.9787684, 0.0719453, -1.6168667, 1.9161415, -0.2289914, -0.4906146, 0.0334540, 1.4052427);
  const float kappa = ${lit(24389 / 27)};
  float fy = (lab.x + 16.0) / 116.0;
  float fx = 0.002 * lab.y + fy;
  float fz = fy - 0.005 * lab.z;
  float x = (fx > ${lit(6 / 29)} ? fx * fx * fx : (116.0 * fx - 16.0) / kappa) * 0.9642;
  float z = (fz > ${lit(6 / 29)} ? fz * fz * fz : (116.0 * fz - 16.0) / kappa) * 0.8249;
  float y = lab.x > 8.0 ? fy * fy * fy : lab.x / kappa;
  return fromXyz * vec3(x, y, z);
}
// What a half-float store should do to a value, whichever back end stores it:
// round to the nearest half (a value that already is one stores exactly).
float seUlp(float v) {
  highp int e = ((floatBitsToInt(v) >> 23) & 255) - 127;
  return intBitsToFloat((max(e - 10, -24) + 127) << 23);
}
float seHalfRound(float v) {
  float x = clamp(v, -65504.0, 65504.0);
  float q = seUlp(x);
  return roundEven(x / q) * q;
}
vec3 seHalf(vec3 v) { return vec3(seHalfRound(v.x), seHalfRound(v.y), seHalfRound(v.z)); }
vec4 seHalf4(vec4 v) { return vec4(seHalf(v.xyz), seHalfRound(v.w)); }
`;

export const PASS_HELPERS = `${SHARED_HELPERS}
// The carried state (L* hi, L* lo, a*, b*) / 100 as (L*, a*, b*).
vec3 seState(vec4 s) {
  return vec3(s.x + s.y, s.z, s.w) * ${lit(STATE_SCALE)};
}
// A texel in L*, a*, b*: converted from RGB on the first draw, else the carried state.
vec3 seTap(ivec2 t) {
  vec4 s = fetchPrev4(t);
  return uPassIndex == 0 ? seLab(s.rgb) : seState(s);
}
float seSqr(float v) { return v * v; }
float seIntp(float a, float b, float c) { return a * (b - c) + c; }
// One direction's estimate: the two sides' neighbours a and b (a2, b2 one
// further out), the pair p across the line and the pair q across it two out.
float seCandidate(float v, float contrast, float a, float a2, float b, float b2, float p1, float p2, float q1, float q2) {
  if (!(v < max(a, b) && v > min(a, b))) return v;
  float f1 = abs(a2 - a);
  float f2 = a - v;
  float f3 = (a - p1) * (a - p2);
  float f4 = sqrt(abs((a - q1) * (a - q2)));
  float difA = f1 * seSqr(f2 * f3) * f4;
  if (!(difA > 0.0)) return v;
  f1 = abs(b2 - b);
  f2 = b - v;
  f3 = (b - p1) * (b - p2);
  f4 = sqrt(abs((b - q1) * (b - q2)));
  float difB = f1 * seSqr(f2 * f3) * f4;
  if (!(difB > 0.0)) return v;
  return seIntp(contrast, (a * difB + b * difA) / (difA + difB), v);
}
// MLsharpen's inner loop for one channel: its 17 values (the order of TAPS),
// the channel's contrast gain, and the amount as a fraction and a third of it.
float seEdge(${NAMES.map((n) => `float ${n}`).join(", ")}, float gain, float amount, float amountBy3) {
  float wH = ${lit(EPS2)} + abs(E1 - W1);
  float wV = ${lit(EPS2)} + abs(S1 - N1);
  float s = 2.0 / (2.0 + abs(wH - wV));
  float wD1 = ${lit(EPS2)} + abs(SE - NW) * s;
  float wD2 = ${lit(EPS2)} + abs(SW - NE) * s;
  s = wD1;
  wD1 /= wD2;
  wD2 /= s;
  float contrast = min(sqrt(seSqr(E1 - W1) + seSqr(S1 - N1)) * gain, 1.0);
  float lumH = seCandidate(v, contrast, W1, W2, E1, E2, N1, S1, N2, S2);
  float lumV = seCandidate(v, contrast, N1, N2, S1, S2, W1, E1, W2, E2);
  float lumD1 = seCandidate(v, contrast, NW, NW2, SE, SE2, NE, SW, NE2, SW2);
  float lumD2 = seCandidate(v, contrast, SW, SW2, NE, NE2, NW, SE, NW2, SE2);
  // Not to sharpen diagonals too much: a third of the amount where one axis is much flatter.
  float lo = min(wH, wV);
  float hi = max(wH, wV);
  float weight = lo > 0.05 * hi ? (lo < 0.45 * hi ? amountBy3 : amount) : amount;
  return seIntp(weight, (lumH * wH + lumV * wV + lumD1 * wD1 + lumD2 * wD2) / (wH + wV + wD1 + wD2), v);
}
`;

export const PASS_GLSL = `
ivec2 size = ivec2(floor(1.0 / uTexel + 0.5));
ivec2 px = ivec2(gl_FragCoord.xy);
vec3 own = uPassIndex == 0 ? seLab(c.rgb) : seState(c);
vec3 result = own;
if (px.x >= 2 && px.y >= 2 && px.x < size.x - 2 && px.y < size.y - 2) {
  ${TAPS.map(([dx, dy], k) => `vec3 t${k} = seTap(px + ivec2(${dx}, ${dy}));`).join("\n  ")}
  float am = amount / 100.0;
  float am3 = amount / 300.0;
  float l = seEdge(${args("x")}, ${lit(CHANNEL_GAIN[0])}, am, am3);
  if (own.x < ${lit(L_LIMIT)}) result.x = abs(l);
  if (!luminanceOnly) {
    result.y = seEdge(${args("y")}, ${lit(CHANNEL_GAIN[1])}, am, am3);
    result.z = seEdge(${args("z")}, ${lit(CHANNEL_GAIN[2])}, am, am3);
  }
}
vec3 state = result / ${lit(STATE_SCALE)};
if (uPassIndex == uPassCount - 1) {
  c = vec4(state, 0.0);
} else {
  float hi = seHalfRound(state.x);
  c = vec4(hi, state.x - hi, state.y, state.z);
}
c = seHalf4(c);
`;

/** What only the inline needs: the input rounded as the host's store rounded it, which the passes' own stores must not be. */
export const INLINE_HELPERS = `
// What the host's store did to the stage's input, in the host's own rounding: the passes read that texture.
vec3 seStored(vec3 v) {
  vec2 xy = unpackHalf2x16(packHalf2x16(v.xy));
  return vec3(xy, unpackHalf2x16(packHalf2x16(vec2(v.z, 0.0))).x);
}
`;

export const INLINE_GLSL = `
if (draws > 0) {
  vec3 held = seHalf(seLab(seStored(c)) / ${lit(STATE_SCALE)}) * ${lit(STATE_SCALE)};
  c += seRgb(stageResult * ${lit(STATE_SCALE)}) - seRgb(held);
}
`;
