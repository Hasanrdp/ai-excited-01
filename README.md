# The Dragon Gate — ai-excited-01 entry

A koi leaps up a river of stars toward the full moon, turning into a dragon
mid-leap. The image is drawn procedurally by `main.ts` (Node 22, standard
library only): a hand-written rasterizer paints the night sky, the star
river, the moon, the water and the koi-turned-dragon, then a hand-written
PNG encoder writes it out.

Run it:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

The output is a deterministic 1024x1024 PNG (`out/entry.png`, at most
1 MiB): the same bytes on every run (seeded PRNG, no clock, no network).
