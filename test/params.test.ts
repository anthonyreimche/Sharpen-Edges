import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, drawCount } from "../src/model";
import { bagPatch, qualified, readParams, rederivePatch, resetPatch } from "../src/params";

describe("the bag", () => {
  it("reads the defaults from an empty bag", () => {
    expect(readParams({})).toEqual(DEFAULT_PARAMS);
  });

  it("reads each key, clamped to the limits, whole iterations, and skips what has the wrong type", () => {
    expect(readParams({ [qualified("passes")]: 9, [qualified("amount")]: -4, [qualified("luminanceOnly")]: true })).toEqual({
      passes: 4,
      amount: 0,
      luminanceOnly: true,
    });
    expect(readParams({ [qualified("passes")]: 2.6 }).passes).toBe(3);
    expect(readParams({ [qualified("amount")]: "50", [qualified("passes")]: Number.NaN, [qualified("luminanceOnly")]: 1 })).toEqual(
      DEFAULT_PARAMS,
    );
  });

  it("writes the edit with its draw count", () => {
    const p = { passes: 3, amount: 60, luminanceOnly: true };
    expect(bagPatch(p)).toEqual({
      [qualified("passes")]: 3,
      [qualified("amount")]: 60,
      [qualified("luminanceOnly")]: true,
      [qualified("draws")]: drawCount(p),
    });
  });

  it("resets to an idle edit", () => {
    expect(resetPatch()[qualified("draws")]).toBe(0);
    expect(resetPatch()[qualified("amount")]).toBe(0);
  });
});

describe("re-deriving", () => {
  it("leaves a bag without the edit alone", () => {
    expect(rederivePatch({ "other.stage.key": 1 })).toBeNull();
  });

  it("leaves a consistent bag alone", () => {
    expect(rederivePatch(bagPatch({ ...DEFAULT_PARAMS, amount: 30 }))).toBeNull();
  });

  it("fixes the draw count of a bag that carried only the edit", () => {
    const bag = { [qualified("amount")]: 30, [qualified("passes")]: 4 };
    expect(rederivePatch(bag)).toEqual({ [qualified("draws")]: 4 });
  });

  it("fixes a bag that holds the derived draw count but no edit key", () => {
    expect(rederivePatch({ [qualified("draws")]: 3 })).toEqual({ [qualified("draws")]: 0 });
    expect(rederivePatch({ [qualified("draws")]: 0 })).toBeNull();
  });
});
