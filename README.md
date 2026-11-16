# ZUFA Living — website

Static site with no build step. Lenis (smooth scroll) loads from a CDN; fonts, images and the 3D frames are local.

## Run locally
```
node tools/serve.mjs 4317
```
Then open http://localhost:4317. Any static host (GitHub Pages, Netlify, S3, cPanel) works: upload the folder as is.

## Design
The site follows the brochure (`brochure/ZUFA_Living_Brochure_v4.html`, "Measured Stillness"): stone `#eee8df` and ink `#1c1a17` pages, bronze `#8a6a42` / `#c9a979` for structure, brand green `#1f3b2d` only in the wordmark, **Cormorant Garamond** for voice and **Plus Jakarta Sans** for labels and facts (files in `assets/fonts/`, same as the brochure). The wordmark is "ZUFA" in Cormorant Garamond Bold with "Living" set beneath at half size.

The brochure is the source for copy, figures and look, not for page order: the site is one seamless scroll. There are no page or chapter numbers anywhere.
- The page tone blends between stone and ink as you move between sections (`js/main.js` → `toneAt`), and photographs dissolve into it through a CSS mask using the brochure's fade recipe (`--d` angle, `--s` start).
- Reveals are short and time based (they never scrub with the scroll); the only scroll-linked motion is cheap image depth.

## The layout (Layout L1, drawing AR-001)
`js/plan.js` draws the plan north-up from `js/site-data.js`: the approach road runs straight south from the grand entrance by plot 1. Hover or tap a plot for its size and price; the legend filters by category.

**See the land in 3D** lifts that drawing into the real site, rendered in Blender Cycles: 30 tilt frames that start exactly over the drawing (north up) and end in an aerial, then a 72-frame, 360° orbit you can drag. Plots stay hoverable in 3D (their outlines are projected into every orbit frame). Frames are shown one at a time on a clock, never blended, so the move stays sharp.

To re-render after a change to the site model:
```
D:\Blender\blender.exe -b blender/zufa_assets.blend --python blender/render_layout3d.py
```
(about 20 minutes on a GTX 1650; writes `assets/layout3d/tilt/`, `orbit/` and `layout3d.json`). `L3_ONLY="t0,t29,o18"` with `L3_W=800` renders quick test frames.

## Prices and enquiries
- Prices are the brochure's: quarter-acre Rs 60 lakh, half-acre Rs 1.20 crore, Signature (plot 47) Rs 2.10 crore, bespoke at Rs 5,000 per sq.yd rounded down to the lakh (Rs 43–72 lakh). See `price()` in `js/plan.js` and the table in `index.html`.
- The site-visit form opens a pre-filled email to `zufaliving@gmail.com` (`CONFIG` in `js/main.js`).
- Every plot is shown as available. To mark plots sold or held, add a status to `js/site-data.js`.

## Blender
Scripts in `blender/` build everything into `blender/zufa_assets.blend` (`*.blend` is not committed):
| Script | Builds |
|---|---|
| `build_sanctuary.py`, `build_estate.py` | the two villa concepts |
| `build_clubhouse.py` | clubhouse campus |
| `build_entrance.py` | grand entrance: ring canopy, stone walls, water blade |
| `build_trees.py`, `build_car.py` | trees, palms, a car |
| `build_site.py` | scene **ZUFA_Site**: roads, plots, homes, avenue palms, lamps, the approach road (straight south, Layout L1) |
| `build_landscape.py` | forest belt, groves, granite outcrops |
| `build_film.py` | sun and sky through the day, night lighting (used by the renders for their lighting) |
| `fix_approach_club.py`, `fix_layout_l1.py` | client corrections applied to an existing file (clubhouse orientation; approach road and entrance) |
| `render_layout3d.py` | the 3D layout frames for the website |
| `render_stills.py` | stills for the brochure |
`zufa_lib.py` holds the shared materials, building parts and export helpers.

## Structure
- `index.html`: page content and copy
- `css/main.css`: design system and layout
- `js/main.js`: smooth scroll, page tone, reveals, hero, sound, form
- `js/plan.js`: the drawn plan and the 3D view
- `js/site-data.js`: **generated** plot polygons in metres (x east, z south), plus the plot schedule
- `assets/img/`: photographs (from the brochure); `assets/fonts/`: brochure fonts; `assets/layout3d/`: Blender frames
- `tools/serve.mjs`: local server with the preview host's security policy; `tools/shoot.mjs`: headless Chrome screenshots of sections

## Regenerating the plot data from a new layout PDF
`tools/layout/` reads the vector linework in the architect's PDF:
1. `node tools/layout/dump.js "<layout.pdf>" <outdir>`: decompresses the PDF streams
2. `node tools/layout/parse.js <outdir>`: extracts line segments and text
3. `node --stack-size=65500 tools/layout/extract.js <outdir>`: flood-fills each plot from its number label and traces the site outline
4. `node tools/layout/build-data.js <outdir>/plots_raw.json js/site-data.js`: converts the result to metres and merges the plot schedule

The scripts assume the plot boundaries are drawn in magenta and plot numbers are text, as in Layout L1. The plot schedule is hard-coded in `build-data.js`. After regenerating, run `node tools/export-site-blender.mjs > blender/site.json` and rebuild the Blender site.
