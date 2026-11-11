import { describe, expect, it } from "vitest";
import { CHANNEL_GAIN, DEFAULT_PARAMS, L_LIMIT, MAX_DRAWS, RANGES, drawCount } from "../src/model";

describe("the edit", () => {
  it("is off by default, at two iterations", () => {
    expect(DEFAULT_PARAMS).toEqual({ passes: 2, amount: 0, luminanceOnly: false });
  });

  it("keeps the tool's limits: 1 to 4 passes, a amount of 0 to 100", () => {
    expect(RANGES.passes).toEqual({ min: 1, max: 4 });
    expect(RANGES.amount).toEqual({ min: 0, max: 100 });
    expect(MAX_DRAWS).toBe(RANGES.passes.max);
  });

  it("draws once per iteration, and not at all at a amount of 0", () => {
    expect(drawCount({ passes: 3, amount: 40, luminanceOnly: false })).toBe(3);
    expect(drawCount({ passes: 4, amount: 0.5, luminanceOnly: true })).toBe(4);
    expect(drawCount({ passes: 3, amount: 0, luminanceOnly: false })).toBe(0);
  });

  it("gives the three channels the tool's contrast gains and sharpens L only below L* 92", () => {
    expect(CHANNEL_GAIN).toEqual([1 / 8, 1 / 3, 1 / 3]);
    expect(L_LIMIT).toBe(92);
  });
});
