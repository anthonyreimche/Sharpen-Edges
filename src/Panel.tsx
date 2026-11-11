// The panel: Iterations, Amount and Luminance only.
//
// It edits whatever useParamScope hands it: the photo's bag in the dock, a
// mask's in the Masking panel. A drag writes the value and the draw count
// live and commits on release, so one gesture is one undo step; each change
// reads the bag the scope holds now, as drags outrun renders.

import { DEFAULT_PARAMS, RANGES, drawCount, type Params } from "./model";
import { DRAWS_KEY, qualified, readParams } from "./params";
import { React, api } from "./rt";

export function SharpenEdgesPanel() {
  const { Slider } = api.components;
  const { Stack, Toggle } = api.ui;
  const scope = api.develop.useParamScope();
  const params = readParams(scope.getParams());

  const change = (patch: Partial<Params>) => {
    const next = { ...readParams(scope.getParams()), ...patch };
    const [key] = Object.keys(patch) as (keyof Params)[];
    scope.setParams({ [qualified(key)]: next[key], [qualified(DRAWS_KEY)]: drawCount(next) });
  };

  return (
    <Stack gap={6} style={{ padding: 8 }}>
      <Slider
        label="Iterations"
        value={params.passes}
        min={RANGES.passes.min}
        max={RANGES.passes.max}
        step={1}
        defaultValue={DEFAULT_PARAMS.passes}
        onChange={(passes) => change({ passes })}
        onCommit={() => scope.commit("Sharpen Edges: iterations")}
      />
      <Slider
        label="Amount"
        value={params.amount}
        min={RANGES.amount.min}
        max={RANGES.amount.max}
        step={1}
        defaultValue={DEFAULT_PARAMS.amount}
        onChange={(amount) => change({ amount })}
        onCommit={() => scope.commit("Sharpen Edges: amount")}
      />
      <Toggle
        label="Luminance only"
        checked={params.luminanceOnly}
        onChange={(luminanceOnly) => {
          change({ luminanceOnly });
          scope.commit("Sharpen Edges: luminance only");
        }}
      />
    </Stack>
  );
}
