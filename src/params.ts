// The param-bag contract. The edit is the tool's own params under the stage's
// qualified keys; the shaders do the arithmetic. One derived key, `draws`, is
// the pass's draw count: 0 while the edit changes nothing, so an untouched
// photo never runs the pass.

import { DEFAULT_PARAMS, RANGES, drawCount, type Params } from "./model";

export const EXT_ID = "sharpen-edges";
export const STAGE_ID = `${EXT_ID}.edges`;

export type EditKey = keyof Params;
export const EDIT_KEYS: readonly EditKey[] = ["passes", "amount", "luminanceOnly"];
export const DRAWS_KEY = "draws" as const;

export const qualified = (key: EditKey | typeof DRAWS_KEY): string => `${STAGE_ID}.${key}`;

type Bag = Readonly<Record<string, unknown>>;
type Patch = Record<string, number | boolean>;

const clamp = (v: number, key: "passes" | "amount") => Math.min(Math.max(v, RANGES[key].min), RANGES[key].max);

/** `bag` is the host's untyped per-photo bag; a missing or mistyped value reads as the default. */
export function readParams(bag: Bag): Params {
  const out = { ...DEFAULT_PARAMS };
  const passes = bag[qualified("passes")];
  if (typeof passes === "number" && Number.isFinite(passes)) out.passes = Math.round(clamp(passes, "passes"));
  const amount = bag[qualified("amount")];
  if (typeof amount === "number" && Number.isFinite(amount)) out.amount = clamp(amount, "amount");
  const luminanceOnly = bag[qualified("luminanceOnly")];
  if (typeof luminanceOnly === "boolean") out.luminanceOnly = luminanceOnly;
  return out;
}

/** The edit and its draw count. */
export function bagPatch(p: Params): Patch {
  return {
    [qualified("passes")]: p.passes,
    [qualified("amount")]: p.amount,
    [qualified("luminanceOnly")]: p.luminanceOnly,
    [qualified(DRAWS_KEY)]: drawCount(p),
  };
}

/** The draw count the bag's edit needs, when the bag holds a different one. */
export function rederivePatch(bag: Bag): Patch | null {
  if (!EDIT_KEYS.some((key) => qualified(key) in bag) && !(qualified(DRAWS_KEY) in bag)) return null;
  const draws = drawCount(readParams(bag));
  return bag[qualified(DRAWS_KEY)] === draws ? null : { [qualified(DRAWS_KEY)]: draws };
}

export const resetPatch = (): Patch => bagPatch(DEFAULT_PARAMS);
