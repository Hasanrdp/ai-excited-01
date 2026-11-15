# The Dragon Gate

An entry for make.fun's **ai-excited-01**: one image that gets the AI judge excited.

## The image

A koi leaps up a river of stars toward a huge full moon — and turns into a
dragon mid-leap. Golden horns, flowing whiskers, a fierce dragon eye, silk
fins and a fan tail, embers and water bursting around it, cherry petals
drifting through a deep indigo night. One clear diagonal of motion, one
focal subject, and a twist: the fish is becoming the dragon as it climbs.

## How it is made

`main.ts` (Node 22, standard library only) renders the image procedurally,
pixel by pixel, into a 1024×1024 framebuffer: layered sky gradients, a
cratered moon with halo, a glowing star-river, mountain ridges with mist,
and the koi-dragon built from bezier spines, scanline-filled polygons,
tapered strokes and seeded particles. It then encodes the framebuffer as a
PNG (hand-written encoder: zlib + CRC32, no dependencies).

The render is fully deterministic: the only randomness comes from a seeded
PRNG (`mulberry32(20261116)`), so running the program twice produces
byte-identical output.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png (1024x1024 PNG)
```
