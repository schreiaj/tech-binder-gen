# FRC Engineering Notebook Generator

A static site generator for FRC engineering notebooks. Feed it a GLTF of your robot and a YAML config; get a single-page scrolling notebook where the 3D model updates as you read.

## How it works

- **Left pane**: scrollable sections — title, description, images
- **Right pane**: sticky `<notebook-viewer>` web component (Three.js) that transitions camera and node visibility as each section scrolls into view
- **Three render styles**: Realistic (PBR + glass), Rally (toon + bloom), Blueprint (edge lines on deep blue)
- **Datastar** handles reactive UI — style buttons, intersection-driven view transitions

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

Or via the npm script:
```bash
npm run decimate -- robot.gltf -o assets/models/robot.glb
```

Place images in `assets/images/`.

## Configuration

Edit `config.yaml`:

```yaml
name: "Team 1234 — 2025 Engineering Notebook"
logoWordmark: "HIGHTIDE"           # bold word in header logo lockup
teamLabel: "TEAM 1234 | HIGHTECH"  # eyebrow text above chapter titles
year: "2025"
logo: assets/images/logo.png
model: assets/models/robot.glb
template: default

headers:
  - title: "RIPCURRENT"           # chapter title (robot name for overview chapter)
    description: "Brief chapter description."
    sections:
      - title: "Overview"
        tagline: "Built for speed. Designed to score."
        description: >
          Longer explanation of the mechanism, design decisions, etc.
        views:
          - name: "Front"
            displayedNodes:
              - "Swerve_Module_FL"   # exact node names from your GLTF
                                     # empty list [] shows the whole robot
            facing: N                # N NE E SE S SW W NW
            elevation: MIDDLE        # TOP UPPER MIDDLE LOWER BOTTOM
            annotations:             # callout labels that float around the model
              - label: "DRIVETRAIN"
                description: "25×32\" swerve, geared 7.67:1."
                position: right-bottom   # see annotation positions below
              - label: "SHOOTER"
                description: "Four Kraken X44s on a 3\" flywheel."
                position: left-top
        images:
          - src: assets/images/module.jpg
            title: "Module Assembly"
            description: "Exploded view"
```

### Finding node names

Open `example.html` in a browser, load your GLTF with the file picker, and use the Node Inspector panel to browse the scene hierarchy and find exact node names.

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

Annotations float around the sticky 3D viewer with a hairline connecting line, mirroring the callout style on technical engineering drawings.

| Value          | Location                    |
|----------------|-----------------------------|
| `left-top`     | Left side, upper zone       |
| `left`         | Left side, vertically centered |
| `left-bottom`  | Left side, lower zone       |
| `right-top`    | Right side, upper zone      |
| `right`        | Right side, vertically centered |
| `right-bottom` | Right side, lower zone      |

## Development

```bash
npm run dev           # build HTML → index.html, then start Vite dev server with HMR
```

Editing `src/viewer.js` or `src/main.js` triggers instant HMR. Editing `config.yaml` or any template triggers a full page reload automatically.

## Building

```bash
# Generate HTML + bundle JS → dist/
npm run build

# Or run steps separately
npm run build:html    # → index.html (project root)

# Preview the production build locally
npm run preview       # serves dist/ on http://localhost:4173
```

Output lands in `dist/`. Deploy that folder anywhere (GitHub Pages, Netlify, etc.).

## `<notebook-viewer>` web component

The 3D viewer is a self-contained custom element. Control it by dispatching custom events on the element:

```js
const viewer = document.getElementById("viewer");

// Transition to a named camera position and filter visible nodes
viewer.dispatchEvent(new CustomEvent("setview", {
  detail: {
    facing: "N",             // N NE E SE S SW W NW  (default: "N")
    elevation: "MIDDLE",     // TOP UPPER MIDDLE LOWER BOTTOM  (default: "MIDDLE")
    displayedNodes: [],      // node names to highlight; [] = show all
  }
}));

// Switch render style
viewer.dispatchEvent(new CustomEvent("setstyle", {
  detail: { style: "realistic" }   // "realistic" | "rally" | "blueprint"
}));

// Restore all nodes to full visibility (no camera change)
viewer.dispatchEvent(new CustomEvent("showallnodes"));
```

**Node visibility** — nodes not in `displayedNodes` are dimmed (desaturated + semi-transparent) in Realistic mode, and hidden outright in Rally/Blueprint mode. The camera zooms to fit only the displayed nodes. After any transition the user can freely orbit.

**HTML usage:**
```html
<notebook-viewer id="viewer" src="assets/models/robot.glb"></notebook-viewer>
```

## Project structure

```
├── config.yaml               # your notebook config (gitignore if desired)
├── config.example.yaml       # reference / starting point
├── index.html                # generated by build.js — do not edit (gitignore this)
├── example.html              # standalone GLTF explorer for finding node names
├── templates/
│   ├── layout.hbs            # page shell (header, two-pane layout)
│   └── section.hbs           # per-section card partial
├── src/
│   ├── viewer.js             # <notebook-viewer> web component (Three.js + anime.js)
│   ├── main.js               # page entry point — imports viewer, sets up scroll observer
│   └── datastar.js           # (if present) custom Datastar signal setup
├── public/
│   └── vendor/
│       └── datastar.js       # Datastar library (served as-is, not bundled by Vite)
├── assets/
│   ├── css/notebook.css
│   ├── images/               # put your photos here
│   └── models/               # put decimated GLB here
├── scripts/
│   ├── build.js              # config.yaml + templates → index.html, assets → public/
│   └── decimate_gltf.js      # gltfpack wrapper
└── dist/                     # production build output (deploy this)
```

## Codespace / devcontainer

Open in GitHub Codespaces or VS Code Dev Containers — `.devcontainer/devcontainer.json` uses the official Node 20 image and runs `npm install` automatically on container start.
