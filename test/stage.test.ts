// The stage contract the host relies on, and what a draw may cost. Unit tests
// can't run GLSL; the GPU spec (test/gpu) renders it.

import { describe, expect, it } from "vitest";
import { INLINE_GLSL, MAX_TAPS_PER_DRAW, PASS_GLSL, PASS_HELPERS, SHARED_HELPERS, glslLiteral } from "../src/glsl";
import { MAX_DRAWS, TAPS } from "../src/model";
import { EDIT_KEYS } from "../src/params";
import { INLINE_KEYS, PASS_KEYS, edgesStage } from "../src/stage";

const stage = edgesStage();

describe("the stage", () => {
  it("reads the edited image in linear Rec.709, the working matrix the Lab maths is defined on", () => {
    expect(stage).toMatchObject({ phase: "display-adjust", reads: "current", space: { encoding: "linear", primaries: "rec709" } });
  });

  it("sits after the impulse denoise and before the microcontrast and the sharpening", () => {
    expect(stage.priority).toBe(120);
  });

  it("runs one four-channel pass (L* hi, L* lo, a*, b*) for as many draws as the bag says", () => {
    expect(stage.passes).toHaveLength(1);
    expect(stage.passes?.[0].channels).toBe(4);
    expect(stage.passes?.[0].iterations).toEqual({ key: "draws", max: MAX_DRAWS });
  });

  it("declares every edit key in the stage's inline uniforms, where presets and paste look for them", () => {
    const pass = stage.passes?.[0].uniforms?.map((u) => u.key) ?? [];
    const inline = stage.uniforms.map((u) => u.key);
    expect(pass).toEqual([...PASS_KEYS]);
    expect([...inline].sort()).toEqual([...EDIT_KEYS, "draws"].sort());
    for (const key of pass) expect(inline).toContain(key);
    expect([...pass, ...INLINE_KEYS].sort()).toEqual([...EDIT_KEYS].sort());
  });

  it("labels the uniforms as the panel does", () => {
    const labels = Object.fromEntries(stage.uniforms.map((u) => [u.key, u.label]));
    expect(labels).toMatchObject({ passes: "Iterations", amount: "Amount", luminanceOnly: "Luminance only" });
  });

  it("is dormant while the amount is 0", () => {
    expect(stage.dormantWhen).toEqual({ amount: 0 });
  });

  it("splits the carried state into a half and its remainder, rounds the last draw to a half, and holds the input rounded the same way", () => {
    expect(PASS_GLSL).toContain("uPassIndex == uPassCount - 1");
    expect(PASS_GLSL).toContain("float hi = seHalfRound(state.x);");
    expect(INLINE_GLSL).toMatch(/seHalf\(seLab\(seStored\(c\)\)/);
  });

  it("changes nothing until the pass has drawn", () => {
    expect(INLINE_GLSL.trim().startsWith("if (draws > 0) {")).toBe(true);
  });

  it("can run inside masks", () => {
    expect(stage.mask).toEqual({ maskable: true });
  });

  it("has uniforms of the right type", () => {
    const type = (key: string) => [...stage.uniforms, ...(stage.passes?.[0].uniforms ?? [])].find((u) => u.key === key)?.glslType;
    expect(type("passes")).toBe("int");
    expect(type("amount")).toBe("float");
    expect(type("luminanceOnly")).toBe("bool");
    expect(type("draws")).toBe("int");
  });
});

describe("a draw's cost", () => {
  it("reads the 17 texels of the algorithm's stencil: the axes and diagonals out to 2 pixels", () => {
    expect(MAX_TAPS_PER_DRAW).toBe(17);
    expect(TAPS).toHaveLength(17);
    const stencil = new Set<string>();
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) stencil.add(`${dx},${dy}`);
    expect(new Set(TAPS.map(([dx, dy]) => `${dx},${dy}`))).toEqual(stencil);
  });

  it("fetches each of those texels once, by name, and nowhere else", () => {
    const fetches = PASS_GLSL.match(/seTap\(/g) ?? [];
    expect(fetches).toHaveLength(TAPS.length);
    expect(PASS_GLSL).not.toMatch(/readPrev\(|fetchPrev4\(|texelFetch\(|texture\(/);
    expect(PASS_HELPERS).not.toMatch(/readPrev\(/);
    expect(PASS_HELPERS.match(/fetchPrev4\(/g)).toHaveLength(1);
  });

  it("lists the stencil in the shader in the order the model does", () => {
    TAPS.forEach(([dx, dy], k) => expect(PASS_GLSL).toContain(`vec3 t${k} = seTap(px + ivec2(${dx}, ${dy}));`));
  });

  it("converts a texel to Lab only on the first draw, where the input is still RGB", () => {
    expect(PASS_HELPERS).toMatch(/uPassIndex == 0 \? seLab\(s\.rgb\)/);
  });

  it("draws the whole frame: no region, no discard", () => {
    expect(stage.passes?.[0].region).toBeUndefined();
    expect(PASS_GLSL).not.toContain("discard");
  });

  it("names no GLSL built-in as a variable", () => {
    for (const name of ["step", "smooth", "filter", "active", "input", "output", "sample"]) {
      expect(PASS_HELPERS + PASS_GLSL + SHARED_HELPERS).not.toMatch(new RegExp(`\\b(int|float|vec2|vec3|ivec2)\\s+${name}\\b`));
    }
  });

  it("writes float literals GLSL ES accepts", () => {
    expect(glslLiteral(1)).toBe("1.0");
    expect(glslLiteral(0.9642)).toBe("0.9642");
    expect(glslLiteral(1 / 3)).toBe("0.3333333333");
    expect(glslLiteral(2 ** -16)).toContain(".");
    expect(PASS_HELPERS + SHARED_HELPERS).not.toMatch(/[^\w.]\d+e-?\d/);
  });
});
