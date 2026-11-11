// What ANGLE's D3D11 back end makes slow or inexact, and the read budget of each draw. Unit tests can't run
// GLSL; they hold the generated source to the rules the hardware run found.

import { describe, expect, it } from "vitest";
import { MAX_TAPS_PER_DRAW, PASS_GLSL, PASS_HELPERS } from "../src/glsl";
import { TAPS } from "../src/model";
import { edgesStage } from "../src/stage";

const stage = edgesStage();
const pass = stage.passes?.[0];
const source = `${pass?.helpers ?? ""}\n${pass?.glsl ?? ""}`;
const inline = `${stage.helpers ?? ""}\n${stage.glsl}`;

describe("what ANGLE's D3D11 back end makes slow", () => {
  it("leaves the pass no constant arrays, which become a copy per pixel", () => {
    expect(source.match(/\bconst\s+\w+\s+\w+\s*\[[^\]]*\]/g) ?? []).toEqual([]);
    expect(source.match(/\b(?:float|int|vec[234]|ivec[234])\s*\[\s*\d+\s*\]\s*\(/g) ?? []).toEqual([]);
  });

  it("leaves it no local arrays, which a loop's index makes an indexable copy", () => {
    const arrays = source.match(/\b(?:highp\s+|mediump\s+|out\s+|inout\s+|in\s+)*(?:bool|float|int|uint|vec[234]|ivec[234]|uvec[234])\s+[A-Za-z_]\w*\s*\[[^\]]*\]/g) ?? [];
    expect(arrays).toEqual([]);
  });

  it("reads the previous draw by texel, never through a sampled read whose gradient flattens the dispatch", () => {
    expect(source.match(/\b(?:readPrev4|readPrev|texture|textureLod|readSource)\s*\(/g) ?? []).toEqual([]);
  });
});

describe("what ANGLE's D3D11 back end makes inexact", () => {
  it("rounds the store to the nearest half itself: D3D11 truncates toward 0 where SwiftShader rounds", () => {
    expect(/\bc = seHalf4\(c\);\s*$/.test(source)).toBe(true);
  });

  it("keeps packHalf2x16 out of the passes, whose stores it would truncate on D3D11 as the host's does", () => {
    expect(source).not.toMatch(/packHalf2x16|unpackHalf2x16/);
  });

  it("measures the inline's change from the input as the host stored it, and rounds the state as the passes did", () => {
    expect(inline).toMatch(/seHalf\(seLab\(seStored\(c\)\)/);
    expect(inline).toContain("packHalf2x16");
  });
});

describe("the read budget", () => {
  it("fetches the 17 texels of the stencil, once each, in the pass and nowhere else", () => {
    expect(MAX_TAPS_PER_DRAW).toBe(17);
    expect(PASS_GLSL.match(/\bseTap\(/g)).toHaveLength(TAPS.length);
    expect(PASS_HELPERS.match(/\bfetchPrev4\(/g)).toHaveLength(1);
    expect(TAPS.length).toBeLessThanOrEqual(100);
  });
});
