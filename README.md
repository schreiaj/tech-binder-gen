# FRC Engineering Notebook Generator

A static site generator for FRC engineering notebooks. Feed it a GLB of your robot and a YAML config; get a single-page scrolling notebook where the 3D model updates as you read.

## How it works

The page is a full-viewport scroll experience with three snap sections before any chapter content:

1. **Title page** — robot name + team label over the 3D viewer
2. **Table of contents** — chapter and section links
3. **Sections** — frosted cards with markdown content, images, and callout annotations

The right-side `<notebook-viewer>` web component (Three.js) is always visible. As each section scrolls into view, [Datastar](https://data-star.dev) intersection observers fire `setview` events that transition the camera and filter which robot nodes are highlighted. Annotations float around the model and are shown/hidden per section.

## Setup

**Prerequisites:** Node 20+, `gltfpack` (for decimation)

```bash
npm install
```

Using Nix:
```bash
nix develop   # provides node 20 + gltfpack
npm install
```

## Preparing your model

Export your CAD assembly as GLTF or GLB, then decimate it for web:

```bash
node scripts/decimate_gltf.js path/to/robot.gltf -o assets/models/robot.glb
```

This runs `gltfpack -si 0.4 -km -kn` (40% simplification, keep materials and normals). Adjust with `-s`:

```bash
node scripts/decimate_gltf.js robot.gltf -s 0.6   # less aggressive
node scripts/decimate_gltf.js robot.gltf -s 0.25  # more aggressive
```

Place images in `assets/images/`.

## Configuration

Every YAML file in `pages/` becomes its own standalone HTML page. The filename is the URL:

| File | URL |
|------|-----|
| `pages/index.yaml` | `/index.html` (your root page) |
| `pages/autonomous.yaml` | `/autonomous.html` |
| `pages/mechanical.yaml` | `/mechanical.html` |

Each page is fully independent — its own model, camera position, chapters, and annotations. A common pattern is one page per notebook section or per subsystem, linked together via a shared team site.

To get started, copy `config.example.yaml` into `pages/`:

```bash
cp config.example.yaml pages/index.yaml
```

Then edit `pages/index.yaml` and run `node scripts/build.js` (or `npm run dev`) to generate the HTML files. Add more YAML files to `pages/` at any time — each one generates an additional page on the next build.

### Full config reference

```yaml
# ── Identity ────────────────────────────────────────────────────────────────
name: "Team 1234 — 2025 Engineering Notebook"  # browser tab title
logoWordmark: "Toasty"        # bold word in the header logo lockup
teamLabel: "TEAM 1234 | Brave Little Toasters" # eyebrow text on the title page
year: "2025"
logo: assets/images/logo.png  # team logo shown in the header (optional)
model: assets/models/robot.glb

template: default             # template folder under templates/ (default: "default")

# ── Initial camera position (shown on title and TOC pages) ──────────────────
facing: NW                    # N NE E SE S SW W NW
elevation: UPPER              # TOP UPPER MIDDLE LOWER BOTTOM

# ── Root annotations (visible on title/TOC pages, hidden inside sections) ───
annotations:
  - label: Powerful Drivetrain
    description: Allows rapid repositioning
    position: 3               # clock position 0–11 (see reference below)
    target: 01_Chassis_<1>    # mesh name to anchor to; omit to use model center

# ── Chapters ─────────────────────────────────────────────────────────────────
chapters:
  - Mechanical:               # chapter name (used in nav + TOC)
      sections:
        - Drivetrain:         # section name
            id: drivebase     # URL anchor id (used by TOC links + Datastar signal)

            # Camera + node visibility for this section
            displayedNodes:
              - "01_Chassis_<1>"   # exact node names from your GLB
                                   # omit or use [] to show the whole robot
            facing: NE
            elevation: UPPER

            # Per-section annotations (visible only while this section is active)
            annotations:
              - label: "6WD"
                description: "Four Kraken X44s"
                position: 11        # clock position 0–11
                # target defaults to displayedNodes[0] if omitted

            # Markdown content blocks (GitHub Flavored Markdown)
            features:
              - |
                **Why 6WD?** Extra traction for defense and rough terrain.
                > 3" colson wheels, 6.8:1 reduction
              - |
                **Motors** Four Kraken X44s, current-limited to 60 A each.

            # Photo gallery
            images:
              - src: assets/images/drivetrain_front.jpg
                title: "Gearbox Assembly"
                description: "Exploded view of the gearbox"
```

### How the YAML is processed

1. **Build script** (`scripts/build.js`) loads every `*.yaml` in `pages/` with `js-yaml`, normalizes the data, and renders the template specified by the `template` key (default: `templates/default/`) via Handlebars into a matching HTML file at the project root.
2. **Chapter normalization** — each chapter gets an auto-generated `id` (`chapter-0`, `chapter-1`, …). Section `id` comes from the config field if present, otherwise `section-{ci}-{si}`.
3. **Annotation normalization** — section annotations without an explicit `target` default to `displayedNodes[0]`. Root annotations without a `target` anchor to the model's bounding-box center at runtime.
4. **Features** — each string in `features` is parsed as GitHub Flavored Markdown by [marked](https://marked.js.org) and injected as raw HTML into the section card.
5. **Assets** — everything under `assets/` is copied to `public/assets/` so Vite serves it at `/assets/…`.

### Finding node names

Open your GLB in a GLTF viewer (e.g. [gltf.report](https://gltf.report)) and inspect the scene hierarchy. Node names must match exactly, including any `<1>` instance suffixes added by some CAD exporters.

### `facing` reference

| Value | Camera comes from |
|-------|------------------|
| `N`   | Front            |
| `S`   | Back             |
| `E`   | Right            |
| `W`   | Left             |
| `NE` `SE` `SW` `NW` | Corners |

### `elevation` reference

| Value    | Angle           |
|----------|----------------|
| `TOP`    | Nearly overhead |
| `UPPER`  | High angle      |
| `MIDDLE` | Eye level       |
| `LOWER`  | Below center    |
| `BOTTOM` | Near floor      |

### Annotation `position` reference

Positions follow a clock face (0 = 12 o'clock, increasing clockwise). The viewer places the label card at that clock position around the 3D anchor point with a hairline connector.

| Value | Location |
|-------|----------|
| `0`   | 12 o'clock (top) |
| `1`–`2` | Upper right |
| `3`   | 3 o'clock (right) |
| `4`–`5` | Lower right |
| `6`   | 6 o'clock (bottom) |
| `7`–`8` | Lower left |
| `9`   | 9 o'clock (left) |
| `10`–`11` | Upper left |

## Theming

Brand colors live in `assets/css/overrides.css`. Edit that file — never the template CSS — so your customizations survive template updates.

```css
/* assets/css/overrides.css */
:root {
    --brand-bg:          #f4f6fb;      /* page & card background */
    --brand-primary:     #0d1b2a;      /* main text */
    --brand-secondary:   #4a5568;      /* muted / secondary text */
    --brand-accent:      #f6c90e;      /* decorative accent (annotation lines, borders) */
    --brand-accent-text: #7a6000;      /* text-safe accent (headings, active nav links) */
}
```

Uncomment only the variables you want to change; any left commented out fall back to the layout defaults.

`--brand-accent` also drives the 3D viewer's blueprint grid color and annotation SVG lines, so it affects both the page chrome and the model view.

## Development

```bash
npm run dev   # build HTML → index.html, then start Vite dev server
```

Editing `src/viewer.js` or `src/main.js` triggers instant HMR. After editing `config.yaml` or a template, re-run `node scripts/build.js` and refresh.

## Building

```bash
npm run build         # generate HTML + bundle JS → dist/
npm run build:html    # generate index.html only (no Vite bundle)
npm run preview       # serve dist/ on http://localhost:4173
```

Output lands in `dist/`. Deploy that folder anywhere (GitHub Pages, Netlify, etc.).

## PDF export

Generate a printable PDF book from the built site. Each scroll target (title page, table of contents, and every section) becomes its own page, with the 3D viewer rendered in the correct camera position behind the content card.

```bash
npm run book                  # portrait (Letter)
npm run book -- --landscape   # landscape (Letter)
```

Output goes to `book/<page-title>.pdf`. The script runs a full build first, serves `dist/` locally, then uses Puppeteer to capture each page. Text remains as vectors (selectable/searchable), while the WebGL canvas is rasterized into the background.

## Deploying to GitHub Pages

A workflow is included at `.github/workflows/deploy.yml`. To enable it:

1. In your repo settings, go to **Pages → Source** and select **GitHub Actions**.
2. Commit your YAML files in `pages/`. If none exist, the workflow falls back to `config.example.yaml`.
3. Push to `main` — the site builds and deploys automatically.

## `<notebook-viewer>` web component

The 3D viewer is a self-contained custom element. Control it by dispatching custom events:

```js
const viewer = document.getElementById("viewer");

// Transition camera and filter visible nodes
viewer.dispatchEvent(new CustomEvent("setview", {
  detail: {
    facing: "N",             // N NE E SE S SW W NW  (default: "N")
    elevation: "MIDDLE",     // TOP UPPER MIDDLE LOWER BOTTOM  (default: "MIDDLE")
    displayedNodes: [],      // mesh names to highlight; [] = show all
  }
}));

// Restore all nodes to full visibility (no camera change)
viewer.dispatchEvent(new CustomEvent("showmeshes", {
  detail: { nodes: [] }
}));
```

Nodes not in `displayedNodes` are dimmed (desaturated + semi-transparent) with an animated 400 ms transition. The camera zooms to fit the displayed nodes. After any transition the user can freely orbit.

**HTML attributes:**
```html
<notebook-viewer
  id="viewer"
  src="assets/models/robot.glb"
  facing="NW"
  elevation="UPPER">
</notebook-viewer>
```

`facing` and `elevation` set the initial camera position after the model loads.

## Project structure

```
├── pages/
│   ├── index.yaml                # generates index.html
│   └── *.yaml                    # each generates a matching *.html at root
├── config.example.yaml           # reference / starting point — copy to pages/
├── *.html                        # generated by build.js — do not edit
├── templates/
│   └── default/
│       ├── layout.hbs            # page shell (header, two-pane layout, annotation loop)
│       ├── layout.css            # layout styles (do not edit — use assets/css/overrides.css)
│       └── section.hbs           # per-section card partial
├── src/
│   ├── viewer.js                 # <notebook-viewer> web component (Three.js + anime.js)
│   ├── annotation.js             # <notebook-annotation> web component
│   └── main.js                   # scroll snap prev/next button controller
├── public/
│   └── vendor/
│       └── datastar.js           # Datastar library (served as-is)
├── assets/
│   ├── css/overrides.css         # brand color overrides (edit this — see Theming)
│   ├── images/                   # your photos
│   └── models/                   # your decimated GLB
├── scripts/
│   ├── build.js                  # config.yaml + templates → index.html
│   ├── book.js                   # PDF book generator (Puppeteer)
│   └── decimate_gltf.js          # gltfpack wrapper
└── dist/                         # production build output
```
