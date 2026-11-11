// The stage on the real renderer. Run via `npm run test:gpu` (run.cjs copies
// this file into a SafeLight checkout and runs it under its headless
// Chromium + SwiftShader rig). What the CPU suite cannot check:
//  • the pass compiles with the host's namespacing and runs the bag's draw
//    count, and an idle edit leaves the frame exactly as it was;
//  • on half-float targets, the shaders land on RawTherapee's result, here the
//    float32 transcription test/reference/rtref.ts, which rtref.test.ts holds
//    to rawtherapee-cli: the Lab conversion, the 17-texel stencil, the four
//    directions and the weights, for one, two and four draws;
//  • a pixel the passes leave alone (the two outer rows and columns, L* 92 and
//    up) comes out as it went in;
//  • luminance only leaves the colour alone;
//  • what a draw costs on a 4096-pixel frame.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, type Params } from "@se/model";
import { bagPatch, resetPatch } from "@se/params";
import { edgesStage } from "@se/stage";
import { labToRgb, mlSharpen, rgbToLab, sharpenEdges, type EdgeParams, type RgbImage } from "@se-test/reference/rtref";
import { CURRENT_PROCESS_VERSION } from "@/catalog/process-version";
import type { ProcessingStageContribution } from "@/extensions/types";
import { OPEN_PROBE, builtinStages, floatImage, identityParams, withRenderer } from "@/rendering/webgl/webgl.test-support";

const W = 320;
const H = 200;
const AS_DRAWN = { encoding: "perceptual", primaries: "rec709" } as const;
/** Frames the stage never touches, compared as float32 frames: SwiftShader lands within 1e-6, ANGLE's D3D11 at 1.1e-6 (about 10 ulp) with or without this stage's half-float rounding, so the rounding is not its cause. */
const UNTOUCHED = 2e-6;

/** A deterministic hash in [0, 1). */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Soft edges, texture, colour and a bright patch, in linear light from 0.01 to 0.9, display-encoded; `noise` is the per-pixel noise amplitude. */
function scene(width: number, height: number, noise: number): ReturnType<typeof floatImage> {
  return floatImage(width, height, (x, y) => {
    const u = x / width;
    const v = y / height;
    const grey = 0.1 + 0.3 * u + 0.1 * v;
    let rgb: [number, number, number] = [grey, grey * 0.95, grey * 0.9];
    const over = (cover: number, to: [number, number, number]) => {
      rgb = rgb.map((c, i) => c + cover * (to[i] - c)) as [number, number, number];
    };
    over(smooth(3, -3, Math.hypot(x - 0.25 * width, y - 0.3 * height) - 0.14 * height), [0.7, 0.55, 0.3]);
    over(smooth(3, -3, Math.hypot(x - 0.7 * width, y - 0.62 * height) - 0.2 * height), [0.12, 0.3, 0.55]);
    const ring = Math.abs(Math.hypot(x - 0.5 * width, y - 0.5 * height) - 0.125 * height);
    over(smooth(0.025 * height + 2, 0.025 * height - 2, ring), [0.05, 0.05, 0.06]);
    over(smooth(2.5, -2.5, Math.abs(u - 0.1) * width - 0.02 * width), [0.78, 0.78, 0.74]);
    over(smooth(2.5, -2.5, Math.abs(u - 0.88) * width - 0.02 * width) * (v > 0.1 && v < 0.9 ? 1 : 0), [0.03, 0.03, 0.03]);
    over(smooth(2.5, -2.5, Math.max(Math.abs(u - 0.8) * width - 0.06 * width, Math.abs(v - 0.2) * height - 0.07 * height)), [0.87, 0.86, 0.83]);
    over(smooth(2.5, -2.5, Math.max(Math.abs(u - 0.25) * width - 0.1 * width, Math.abs(v - 0.82) * height - 0.1 * height)) * (0.5 + 0.5 * Math.sin(x * 1.6) * Math.sin(y * 1.6)), [0.9, 0.9, 0.9]);
    const texture = 1 + noise * (hash(x, y) - 0.5) + 0.03 * Math.sin(x * 1.3) * Math.sin(y * 0.9);
    return rgb.map((c) => encode(Math.min(Math.max(c * texture, 0.01), 0.9))) as [number, number, number];
  });
}

const CASES: [string, Partial<Params>][] = [
  ["default", { amount: 50 }],
  ["1 pass", { amount: 50, passes: 1 }],
  ["4 passes", { amount: 50, passes: 4 }],
  ["strength 100", { amount: 100 }],
  ["luminance only", { amount: 50, luminanceOnly: true }],
  ["3 passes, strength 17", { amount: 17, passes: 3 }],
];

type Frames = Record<string, Float32Array>;

function render(image: ReturnType<typeof floatImage>, bags: Record<string, Record<string, unknown>>, stages: ProcessingStageContribution[] = [edgesStage()]): Frames {
  const frames: Frames = {};
  withRenderer({ stages: [...builtinStages(), ...stages], pipeline: OPEN_PROBE }, (renderer) => {
    renderer.setImage(image);
    renderer.setParams(identityParams({ processVersion: CURRENT_PROCESS_VERSION }));
    for (const [name, bag] of Object.entries(bags)) {
      renderer.setContributedParams(bag);
      const frame = renderer.readFloatFrame("pre-output", Infinity, AS_DRAWN);
      if (!frame) throw new Error(`no frame for ${name}`);
      frames[name] = frame.data;
    }
  });
  return frames;
}

const full = (p: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...p });

/** An RGBA frame of display-encoded values as the linear RGB image the stage works on. */
function linear(frame: Float32Array, width: number, height: number): RgbImage {
  const data = new Float32Array(width * height * 3);
  for (let k = 0; k < width * height; k++) for (let c = 0; c < 3; c++) data[3 * k + c] = decode(frame[4 * k + c]);
  return { width, height, data };
}

/** How a half-float target rounds a float: SwiftShader to nearest, ANGLE's D3D11 toward zero. */
type Rounding = "nearest" | "zero";

/** What a half-float target does to 1 + 0.75 ulp: the host's store of the stage's input rounds that way, the passes' own stores round to nearest in the shader. */
function targetRounding(): Rounding {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl || !gl.getExtension("EXT_color_buffer_float")) throw new Error("no float render targets");
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error("no shader");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, "#version 300 es\nvoid main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0, 0.0, 1.0); }"));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main() { o = vec4(1.0 + 0.75 * exp2(-10.0)); }"));
  gl.linkProgram(program);
  gl.useProgram(program);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, 1, 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = new Float32Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
  if (out[0] === 1 + 2 ** -10) return "nearest";
  if (out[0] === 1) return "zero";
  throw new Error(`a half-float target stored ${out[0]}`);
}
const ROUNDING = targetRounding();

/** A float32 rounded to a half float: to nearest (ties to even) or toward zero. */
function half(v: number, rounding: Rounding = "nearest"): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const step = 2 ** (Math.max(Math.floor(Math.log2(Math.abs(v))), -14) - 10);
  const r = v / step;
  if (rounding === "zero") return Math.trunc(r) * step;
  let n = Math.floor(r);
  const diff = r - n;
  if (diff > 0.5 || (diff === 0.5 && n % 2 !== 0)) n++;
  return n * step;
}

const LAB_SCALE = 327.68 * 100;

const roundLab = (lab: ReturnType<typeof rgbToLab>) => {
  for (const channel of [lab.L, lab.a, lab.b]) for (let k = 0; k < channel.length; k++) channel[k] = Math.fround(half(channel[k] / LAB_SCALE) * LAB_SCALE);
};

/**
 * What the stage computes, with the transcription's arithmetic: the passes read
 * the input as the half-float texture the host stored (rounded as this GPU
 * rounds a store), carry their state at float precision, round it to the
 * nearest half float on the last draw, and the inline adds the change to the
 * exact pixel, measured from the input as stored (see glsl.ts).
 */
function halfModel(exact: RgbImage, p: EdgeParams): RgbImage {
  const stored = { ...exact, data: Float32Array.from(exact.data, (v) => half(v, ROUNDING)) };
  const lab = rgbToLab(stored);
  mlSharpen(lab, p);
  roundLab(lab);
  const finalRgb = labToRgb(lab).data;
  const held = rgbToLab(stored);
  roundLab(held);
  const heldRgb = labToRgb(held).data;
  return { ...exact, data: Float32Array.from(exact.data, (v, i) => v + finalRgb[i] - heldRgb[i]) };
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

// Against RawTherapee's arithmetic: it runs in float32 on the exact input; the
// stage's input is a half-float texture and its state is half float, so a
// strict comparison between neighbours that are nearly equal can fall the other
// way, and the algorithm turns any such tie into a jump (a candidate whose
// weight is exactly 0 is skipped, one of 1e-12 is not). Those pixels are a few
// in 10,000. The state is carried as a half and its remainder, and the last draw
// rounds it to the nearest half itself, so the passes add little rounding of their own.
const VS_RT = { p50: 2e-4, p99: 5e-3, p999: 5e-2 };

describe.each<[string, number]>([
  ["clean", 0],
  ["noisy", 0.05],
])("Sharpen Edges on the GPU, %s scene", (_label, noise) => {
  const image = scene(W, H, noise);
  const bags: Record<string, Record<string, unknown>> = { identity: resetPatch() };
  for (const [name, p] of CASES) bags[name] = bagPatch(full(p));
  const frames = render(image, bags);
  const input = linear(frames.identity, W, H);

  it("leaves the frame as it was while idle, to float rounding", () => {
    const without = render(image, { identity: {} }, []).identity;
    let worst = 0;
    for (let i = 0; i < without.length; i++) worst = Math.max(worst, Math.abs(frames.identity[i] - without[i]) / Math.max(Math.abs(without[i]), 1e-6));
    expect(worst).toBeLessThan(UNTOUCHED);
  });

  it.each(CASES)("matches RawTherapee's result: %s", (name, p) => {
    const ref = sharpenEdges(input, full(p)).data;
    const got = linear(frames[name], W, H).data;
    const moved: number[] = [];
    const errors: number[] = [];
    for (let i = 0; i < ref.length; i++) {
      moved.push(Math.abs(ref[i] - input.data[i]));
      errors.push(Math.abs(got[i] - ref[i]));
    }
    moved.sort((x, y) => x - y);
    errors.sort((x, y) => x - y);
    console.log(
      `${_label} ${name}: moved p99 ${quantile(moved, 0.99).toExponential(2)} max ${moved[moved.length - 1].toExponential(2)}; ` +
        `error p50 ${quantile(errors, 0.5).toExponential(2)} p99 ${quantile(errors, 0.99).toExponential(2)} p999 ${quantile(errors, 0.999).toExponential(2)} max ${errors[errors.length - 1].toExponential(2)}`,
    );
    expect(quantile(moved, 0.99), "the case changes the image").toBeGreaterThan(0.002);
    expect(quantile(errors, 0.5)).toBeLessThan(VS_RT.p50);
    expect(quantile(errors, 0.99)).toBeLessThan(VS_RT.p99);
    expect(quantile(errors, 0.999)).toBeLessThan(VS_RT.p999);
  });

  // The shaders against the same arithmetic on the same half-float inputs and
  // state: what is left is the GPU's own float rounding (pow against cbrt, fused
  // multiplies), which puts the same few ties on the other side.
  it.each(CASES)("matches the transcription run on half floats: %s", (name, p) => {
    const model = halfModel(input, full(p)).data;
    const got = linear(frames[name], W, H).data;
    const errors = Array.from(got, (v, i) => Math.abs(v - model[i])).sort((x, y) => x - y);
    console.log(
      `${_label} ${name} vs half model: error p50 ${quantile(errors, 0.5).toExponential(2)} p99 ${quantile(errors, 0.99).toExponential(2)} p999 ${quantile(errors, 0.999).toExponential(2)} max ${errors[errors.length - 1].toExponential(2)}`,
    );
    expect(quantile(errors, 0.5)).toBeLessThan(1e-6);
    expect(quantile(errors, 0.99)).toBeLessThan(1e-3);
    expect(quantile(errors, 0.999)).toBeLessThan(1e-2);
  });

  // The passes never touch the two outer rows and columns, and L stays above
  // L* 92; the inline adds only what the passes changed, so those pixels come
  // out as they went in, to the half-float input the passes read.
  it("leaves the outer rows and columns, and the pixels of L* 92 and up, as they were", () => {
    for (const [name] of CASES) {
      const got = linear(frames[name], W, H).data;
      let worst = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (x >= 2 && x < W - 2 && y >= 2 && y < H - 2) continue;
          for (let c = 0; c < 3; c++) {
            const was = input.data[3 * (y * W + x) + c];
            worst = Math.max(worst, Math.abs(got[3 * (y * W + x) + c] - was) / Math.max(was, 0.01));
          }
        }
      }
      console.log(`${_label} ${name}: outer rows and columns moved by ${worst.toExponential(2)} at most, relative`);
      expect(worst, name).toBeLessThan(3e-3);
    }
  });

  it("leaves the colour alone when it is luminance only", () => {
    const only = linear(frames["luminance only"], W, H).data;
    const all = linear(frames.default, W, H).data;
    const chroma = (rgb: Float32Array, k: number) => {
      const r = rgb[3 * k];
      const g = rgb[3 * k + 1];
      const b = rgb[3 * k + 2];
      return [r / (r + g + b), b / (r + g + b)];
    };
    const moved = (rgb: Float32Array) => {
      const out: number[] = [];
      for (let k = 0; k < W * H; k++) {
        const a = chroma(input.data, k);
        const o = chroma(rgb, k);
        out.push(Math.max(Math.abs(o[0] - a[0]), Math.abs(o[1] - a[1])));
      }
      return out.sort((x, y) => x - y);
    };
    const movedOnly = moved(only);
    const movedAll = moved(all);
    console.log(`${_label}: chromaticity moved, luminance only p99 ${quantile(movedOnly, 0.99).toExponential(2)}, all channels p99 ${quantile(movedAll, 0.99).toExponential(2)}`);
    expect(quantile(movedOnly, 0.99)).toBeLessThan(2e-3);
    expect(quantile(movedAll, 0.99)).toBeGreaterThan(3 * quantile(movedOnly, 0.99));
  });

  it("is a no-op at an amount of 0, whatever the iterations", () => {
    const frame = render(image, { zero: bagPatch(full({ amount: 0, passes: 4 })) }).zero;
    let worst = 0;
    for (let i = 0; i < frame.length; i++) worst = Math.max(worst, Math.abs(frame[i] - frames.identity[i]));
    expect(worst).toBeLessThan(1e-6);
  });

  it("draws as many times as the bag says: 4 draws differ from 2", () => {
    const two = linear(frames.default, W, H).data;
    const four = linear(frames["4 passes"], W, H).data;
    let apart = 0;
    for (let i = 0; i < two.length; i++) apart = Math.max(apart, Math.abs(two[i] - four[i]));
    expect(apart).toBeGreaterThan(0.005);
  });
});

describe("a 4096-pixel frame", () => {
  it("renders four draws at full amount in a bounded time", () => {
    const width = 4096;
    const height = 2048;
    const big = floatImage(width, height, (x, y) => {
      const v = encode(0.1 + 0.3 * (x / width) + 0.1 * (y / height) + 0.2 * smooth(3, -3, Math.hypot(x - 2048, y - 1024) - 600) + 0.02 * (hash(x, y) - 0.5));
      return [v, v * 0.97, v * 0.93];
    });
    const started = performance.now();
    const frame = render(big, { big: bagPatch(full({ amount: 100, passes: 4 })) }).big;
    const seconds = (performance.now() - started) / 1000;
    console.log(`4096 x 2048, 4 draws: ${seconds.toFixed(1)} s (first frame, compile included)`);
    expect(frame.every(Number.isFinite)).toBe(true);
    expect(seconds).toBeLessThan(300);
  });
});
