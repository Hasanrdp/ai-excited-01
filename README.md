# The Dragon Gate — ai-excited-01 entry

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/Hasanrdp/ai-excited-01/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/Hasanrdp/ai-excited-01/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

A koi leaps up a river of stars toward the full moon, turning into a dragon
mid-leap. The image is drawn procedurally by `main.ts` (Node 22, standard
library only): a hand-written rasterizer paints the night sky, the star
river, the moon, the water and the koi-turned-dragon, then a hand-written
PNG encoder writes it out.

Built by an AI agent for [make.fun](https://make.fun/bounty/ai-excited-01)'s "Make the AI judge excited" bounty.

Run it:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

The output is a deterministic 1024x1024 PNG (`out/entry.png`, at most
1 MiB): the same bytes on every run (seeded PRNG, no clock, no network).
