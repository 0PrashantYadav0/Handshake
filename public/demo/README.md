# Demo kit (docs/08-ui-spec.md section 12)

Shown only when `DEMO_LOGIN=true`: the "Try one:" chips on `/new`, "Use sample listing photos", and the "Use sample evidence" buttons on the deal page.

## PLACEHOLDER images: replace these (T-23)

Every `.png` below is a generated gradient with a label (`npm run demo:placeholders`, `scripts/demo/make-placeholders.ts`), not a photograph. Replace each with the real JPEG (1600 px long edge, EXIF stripped, under 2 MB), then change the matching paths in `presets.json` from `.png` to `.jpg` and delete the placeholder.

| Replace | With |
| --- | --- |
| `reference/mug/ref-1.png`, `ref-2.png` | Two listing photos of the blue ceramic mug |
| `reference/mug/code-base.png` | The mug beside a blank paper note card |
| `reference/lamp/ref-1.png`, `ref-2.png` | Two listing photos of the wooden desk lamp |
| `reference/lamp/code-base.png` | The lamp beside a blank paper note card |
| `reference/bottle/ref-1.png`, `ref-2.png` | Two listing photos of the 1 L stainless steel bottle |
| `reference/bottle/code-base.png` | The bottle beside a blank paper note card |
| `evidence/good/photo-1.png`, `photo-2.png` | The mug, new angles, different background, clearly not the listing photos |
| `evidence/wrong-item/photo-1.png`, `photo-2.png` | A different desk lamp (other colour and shape) |
| `evidence/blurry/photo-1.png` | The bottle, motion-blurred and partly out of frame |

After replacing a `code-base` photo, measure the blank note card in pixels and update that preset's `code_photo.box` (`x`, `y`, `w`, `h`, `angle` in radians) in `presets.json`; the browser draws the deal code centred in that box. The placeholder cards sit exactly at the boxes already in the file.

Keep the file names and the three sentences in `presets.json` in step with the photos (section 12 lets the items be swapped as long as both change together).

## Font

`fonts/handwriting.woff2` is Caveat Regular 400, Latin subset, fetched from Google Fonts. Licensed under the SIL Open Font License 1.1, `fonts/OFL.txt`. Both ship as-is.
