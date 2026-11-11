// Sharpen Edges, the parts the CPU needs: the edit, its limits and the
// constants the shader shares with the tool it ports (rtengine/ipsharpenedges.cc
// MLsharpen, RawTherapee 5.13, GPL-3.0-or-later; © 2004-2020 Gabor Horvath,
// the algorithm Manuel Llorens', who has waived his rights to it). glsl.ts does
// the same arithmetic per draw; test/reference/rtref.ts is the float32
// transcription both are held to.
//
// The tool works on CIE Lab, one channel at a time: each pass reads a copy of
// the channel and moves every pixel two or more pixels in from the edge toward
// what its neighbours along the horizontal, vertical and two diagonal lines
// say it should be. A channel never reads another, so all three go through one
// draw per pass here. L is only written below L* 92; a and b have no limit.

export interface Params {
  /** How many times the sharpening runs, 1 to 4. */
  passes: number;
  /** How far each pass pulls a pixel toward its edge-aware estimate, 0 to 100 (%). 0 is off. */
  amount: number;
  /** Sharpen L only; otherwise L, a and b. */
  luminanceOnly: boolean;
}

export const DEFAULT_PARAMS: Readonly<Params> = { passes: 2, amount: 0, luminanceOnly: false };

export interface Range {
  min: number;
  max: number;
}

export const RANGES: Readonly<Record<"passes" | "amount", Range>> = {
  passes: { min: 1, max: 4 },
  amount: { min: 0, max: 100 },
};

export const MAX_DRAWS = RANGES.passes.max;

/** Draws the pass needs: one per iteration, none while the amount is 0 (the tool returns early). */
export const drawCount = (p: Params): number => (p.amount > 0 ? p.passes : 0);

/** Scales the local contrast that fades the estimate back toward the pixel, for L, a and b. */
export const CHANNEL_GAIN: readonly [number, number, number] = [1 / 8, 1 / 3, 1 / 3];
/** L is left alone from this L* up. */
export const L_LIMIT = 92;
/** Keeps a weight off zero. */
export const EPS2 = 0.001;
/** The Lab scale RawTherapee works in is 327.68 per L* unit; a draw stores L*, a*, b* over this. */
export const STATE_SCALE = 100;

/**
 * The texels a pixel reads: its 5 x 5 neighbourhood along the axes and the
 * two diagonals. The order is the shader's: the pixel, then the horizontal
 * pair at 1 and 2, the vertical pair, and the diagonals at 1 and 2.
 */
export const TAPS: readonly (readonly [number, number])[] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [-2, 0],
  [2, 0],
  [0, -1],
  [0, 1],
  [0, -2],
  [0, 2],
  [-1, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-2, -2],
  [2, 2],
  [2, -2],
  [-2, 2],
];
