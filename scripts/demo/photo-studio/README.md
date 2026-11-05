# Photo studio

Path-traced product photos for the demo kit and the eval set, made from code, so they are ours and free of third-party marks. `studio.js` builds a table-top scene (mug, lamps, bottle, book, keyboard, headphones, clock, planter, note card, phone) and traces it with `three-gpu-pathtracer` in headless Chromium.

```sh
mkdir -p /tmp/hs-studio && npm i --prefix /tmp/hs-studio three@0.187.0 three-gpu-pathtracer@0.0.28 three-mesh-bvh@0.9.18
node scripts/demo/photo-studio/render.mjs scripts/demo/photo-studio/kit.json --force     # the demo kit, about 20 minutes on an M1
node scripts/demo/photo-studio/glyphs.mjs                                                # the deal-code alphabet for lib/agents/samples.ts
node scripts/demo/photo-studio/eval-cases.mjs manifest /tmp/hs-studio/eval.json          # the eval shot list
node scripts/demo/photo-studio/render.mjs /tmp/hs-studio/eval.json                       # renders to /tmp/hs-eval-shots
node scripts/demo/photo-studio/eval-cases.mjs cases                                      # assembles eval/cases/
```

The renderer prints each note card's box on the image; `public/demo/presets.json` stores it. Avoid multi-material meshes: the tracer mixes up their material indexes.
