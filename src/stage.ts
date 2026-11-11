// The processing stage: the sharpening in one four-channel pass (glsl.ts), and
// the inline that turns its Lab state back into the pixel. The tool runs after
// the tone curve on display-referred Lab; the stage sits in the display phase
// in linear Rec.709, which is the "sRGB" working matrix its Lab is defined on,
// unclipped.

import { INLINE_GLSL, INLINE_HELPERS, PASS_GLSL, PASS_HELPERS, SHARED_HELPERS } from "./glsl";
import { DEFAULT_PARAMS, MAX_DRAWS, RANGES, type Params } from "./model";
import { DRAWS_KEY, STAGE_ID } from "./params";
import type { ProcessingStageContribution, UniformDeclaration } from "./safelight";

/** What the pass reads: changing one reruns it. */
export const PASS_KEYS = ["amount", "luminanceOnly"] as const;
/** What no shader reads: the draw count derives from it. */
export const INLINE_KEYS = ["passes"] as const;

const uniforms: Record<keyof Params, UniformDeclaration> = {
  passes: { key: "passes", glslType: "int", default: DEFAULT_PARAMS.passes, range: { ...RANGES.passes, step: 1 }, label: "Iterations" },
  amount: { key: "amount", glslType: "float", default: DEFAULT_PARAMS.amount, range: { ...RANGES.amount, step: 1 }, label: "Amount" },
  luminanceOnly: { key: "luminanceOnly", glslType: "bool", default: DEFAULT_PARAMS.luminanceOnly, label: "Luminance only" },
};

const DRAWS: UniformDeclaration = { key: DRAWS_KEY, glslType: "int", default: 0 };

export function edgesStage(): ProcessingStageContribution {
  return {
    id: STAGE_ID,
    name: "Sharpen Edges",
    phase: "display-adjust",
    priority: 120,
    reads: "current",
    space: { encoding: "linear", primaries: "rec709" },
    glsl: INLINE_GLSL,
    helpers: SHARED_HELPERS + INLINE_HELPERS,
    // Presets and paste only see the stage's inline uniforms, so every edit key is declared here as well as on the pass.
    uniforms: [...INLINE_KEYS.map((key) => uniforms[key]), ...PASS_KEYS.map((key) => uniforms[key]), DRAWS],
    passes: [
      {
        channels: 4 as const,
        glsl: PASS_GLSL,
        helpers: PASS_HELPERS,
        iterations: { key: DRAWS_KEY, max: MAX_DRAWS },
        uniforms: PASS_KEYS.map((key) => uniforms[key]),
      },
    ],
    dormantWhen: { amount: 0 },
    mask: { maskable: true },
  };
}
