# Sharpen Edges for Safelight

A [Safelight](https://github.com/anthonyreimche/SafeLight) extension that firms
up soft edges without halos. It works in CIE Lab, after the tone and colour
edits: each pass looks at a pixel's neighbours along four lines (across, down
and both diagonals), and where the pixel sits part-way up an edge it moves it
toward the value those neighbours point to. Flat areas and noise barely move;
edges that are already crisp are left nearly alone.

## Controls

- **Iterations** (1 to 4): how many times the sharpening runs. Each pass works
  on the result of the one before.
- **Amount** (0 to 100): how far each pass pulls a pixel toward its estimate.
  0 is off, and is where a photo starts, so an untouched photo costs nothing.
- **Luminance only**: sharpens lightness alone. Off, it sharpens a and b (the
  two colour axes) as well, which also firms up colour edges.

The panel also works inside a mask, so the sharpening can be local.

## Notes

- Lightness above L* 92 and the outer two rows and columns of the frame are
  never changed.
- The sharpening works on the pixels it is given. In Develop, at a render
  resolution below the photo's own size, the same amount looks stronger than
  in an export at full size. Judge it at 100%.
- Between iterations the Lab state is carried at near-float precision, and
  rounded to a half float once, on the last draw. A pixel the sharpening
  leaves alone comes out as it went in.
- A pass is one draw and the three channels share it, so the cost is the
  iterations times a 17-texel read per pixel.
- It runs in the display phase in linear Rec. 709, unclipped, ahead of any
  later sharpening or effects stage.

## Development

```
npm run check       # typecheck, build dist/, unit tests
npm run test:gpu    # the shaders on the real renderer (needs a SafeLight checkout)
npm run update-types
```

`test/reference/rtref.ts` is a float32 transcription of the original
algorithm; a fixture beside it holds the original program's output on a small
scene, and `rtref.test.ts` holds the transcription to it.
The GPU spec holds the shaders to the transcription. Source headers carry the
credits and the licence is GPL-3.0-or-later.
