# Demo kit (docs/08-ui-spec.md section 12)

Shown only when `DEMO_LOGIN=true`: the "Try one:" chips on `/new`, "Use sample listing photos", and the "Use sample evidence" buttons on the deal page.

## The images

Every photo here is a path-traced 3D render from `scripts/demo/photo-studio/`, so the kit is original and carries no third-party marks. To change them, edit `kit.json` there and re-render. To use real photographs instead, replace the JPEGs (1600 px long edge, EXIF stripped, under 2 MB), and keep the items and the three sentences in `presets.json` in step.

After changing a `code-base` image, update that preset's `code_photo.box` in `presets.json` (`x`, `y`, `w`, `h`, `angle` in radians): the deal code is drawn centred in that box. The renderer prints the box of each card.

`evidence/wrong-item/code-base.jpg` and `evidence/blurry/code-base.jpg` are per-set code photos, so a set's item is the one beside the card: a wrong lamp stays wrong in every photo, and a blurry bottle stays unreadable.

`glyphs/` holds the deal-code alphabet in the handwriting font for agents, which have no browser canvas (`lib/agents/samples.ts`).

## Font

`fonts/handwriting.woff2` is Caveat Regular 400, Latin subset, fetched from Google Fonts. Licensed under the SIL Open Font License 1.1, `fonts/OFL.txt`. Both ship as-is.
