import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { animate } from "animejs";

const SVG_NS = "http://www.w3.org/2000/svg";

// Translate a card so its nearest edge sits at the clock anchor point.
function cardTransform(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? "translate(0, -50%)" : "translate(-100%, -50%)";
  }
  return dy > 0 ? "translate(-50%, -100%)" : "translate(-50%, 0%)";
}

// Return the desaturated, ghosted colour for a dimmed mesh.
function dimmedColor(orig) {
  const lum = orig.r * 0.299 + orig.g * 0.587 + orig.b * 0.114;
  return {
    r: orig.r + (lum - orig.r) * 0.85,
    g: orig.g + (lum - orig.g) * 0.85,
    b: orig.b + (lum - orig.b) * 0.85,
  };
}

// Clamp a raw location attribute value to 0–11.
function parseLocation(attr) {
  return Math.max(0, Math.min(11, parseInt(attr ?? "0", 10) || 0));
}

// Stamp a material with its resting color/opacity so dim animations can restore them.
// Also enforce DoubleSide — any material can become semi-transparent via dimming,
// and a FrontSide-only material disappears when transparent and viewed from behind.
function tagMaterial(mat) {
  mat.transparent = true;
  mat.side = THREE.DoubleSide;
  if (mat.color) mat.userData.origColor = mat.color.clone();
  mat.userData.origOpacity = mat.opacity ?? 1.0;
}

function cssVarToHex(varName) {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  const nums = raw.match(/\d+/g);
  if (nums && nums.length >= 3) {
    const [r, g, b] = nums.map(Number);
    return (r << 16) | (g << 8) | b;
  }
  return parseInt(raw.replace("#", ""), 16);
}

const FACING_AZIMUTH = {
  N: 0,
  NE: Math.PI * 0.25,
  E: Math.PI * 0.5,
  SE: Math.PI * 0.75,
  S: Math.PI,
  SW: Math.PI * 1.25,
  W: Math.PI * 1.5,
  NW: Math.PI * 1.75,
};

const ELEVATION_POLAR = {
  TOP: 0.15,
  UPPER: Math.PI / 4,
  MIDDLE: Math.PI / 2,
  LOWER: (3 * Math.PI) / 4,
  BOTTOM: Math.PI - 0.15,
};

class NotebookViewer extends HTMLElement {
  static get observedAttributes() {
    return ["src", "style-mode"];
  }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; position: relative; }
      canvas { display: block; width: 100%; height: 100%; }
      #css2d-layer { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
      #annotation-lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
      #annotation-lines line { stroke: var(--accent, orange); stroke-width: 1.5; stroke-dasharray: 4 3; }
      #annotation-lines circle { fill: var(--accent, orange); }
    `;

    this._canvas = document.createElement("canvas");

    this._css2dRenderer = new CSS2DRenderer();
    this._css2dRenderer.domElement.id = "css2d-layer";
    // CSS2DRenderer sets overflow:hidden inline in its constructor; override so cards
    // near the edge of the viewer aren't clipped.
    this._css2dRenderer.domElement.style.overflow = "visible";

    this._annotationSvg = document.createElementNS(SVG_NS, "svg");
    this._annotationSvg.id = "annotation-lines";

    shadow.append(style, this._canvas, this._annotationSvg, this._css2dRenderer.domElement);

    this._annotations = new Set();

    this._modelCenter = new THREE.Vector3();
    this._modelRadius = 1;
    this.currentModel = null;
    this.currentStyle = "realistic";
    this._camAnim = null;
    this._rafId = null;
    this._dimmedMeshes = new Set();
    this._visAnims = new Map();
    this._renderRequested = true;
  }

  connectedCallback() {
    this._init();

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this);

    this.addEventListener("setview", (e) => this.transitionToView(e.detail));
    this.addEventListener("setstyle", (e) => this.setStyle(e.detail?.style));
    this.addEventListener("showmeshes", (e) => this.showMeshes(e.detail?.nodes ?? []));

    if (this.hasAttribute("src")) this._loadModel(this.getAttribute("src"));

    this._animate();
  }

  // Returns the world-space bounding-box center of all meshes under a named node,
  // or null if the node has no meshes.
  _getNodeWorldCenter(nodeName) {
    const box = new THREE.Box3();
    this.currentModel.traverse((c) => {
      if (c.name === nodeName)
        c.traverse((ch) => { if (ch.isMesh) box.expandByObject(ch); });
    });
    return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
  }

  // Projects a named node's world center to canvas-local CSS pixels.
  getScreenPositionOfNode(nodeName) {
    const center = this._getNodeWorldCenter(nodeName) ?? this._modelCenter.clone();
    const projected = center.project(this.camera);
    const w = this._canvas.clientWidth;
    const h = this._canvas.clientHeight;
    return {
      x: (projected.x * 0.5 + 0.5) * w,
      y: (-projected.y * 0.5 + 0.5) * h,
    };
  }

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
    cancelAnimationFrame(this._rafId);
    this.renderer?.dispose();
  }

  attributeChangedCallback(name, _old, val) {
    if (!this.renderer) return;
    if (name === "src") this._loadModel(val);
    if (name === "style-mode") this.setStyle(val);
  }

  // --- Public API ---

  transitionToView(view) {
    if (!this.currentModel) return;
    const { facing = "N", elevation = "MIDDLE", displayedNodes = [] } = view;

    this._setNodeVisibility(displayedNodes);

    const box = new THREE.Box3();
    this.currentModel.traverse((c) => {
      if (c.isMesh && !this._dimmedMeshes.has(c)) box.expandByObject(c);
    });

    const center = box.isEmpty()
      ? this._modelCenter.clone()
      : box.getCenter(new THREE.Vector3());
    const radius = box.isEmpty()
      ? this._modelRadius
      : box.getBoundingSphere(new THREE.Sphere()).radius;

    const azimuth = FACING_AZIMUTH[facing] ?? 0;
    const polar = ELEVATION_POLAR[elevation] ?? Math.PI / 2;
    const r = radius * 2.5;

    const targetPos = new THREE.Vector3(
      center.x + r * Math.sin(polar) * Math.sin(azimuth),
      center.y + r * Math.cos(polar),
      center.z + r * Math.sin(polar) * Math.cos(azimuth),
    );

    this._animateCamera(targetPos, center);
  }

  showMeshes(nodes = []) {
    this._setNodeVisibility(nodes);
  }

  setStyle(style) {
    this.currentStyle = style;
    if (this.currentModel) this._applyStyle();
  }

  // --- Init ---

  _init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      antialias: true,
      alpha: true,
    });

    this._setupRenderer();
    this._setupScene();
    this._setupPostProcessing();
    this._setupControls();
  }

  _setupRenderer() {
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
  }

  _setupScene() {
    const { scene, renderer } = this;

    const accentHex = cssVarToHex("--accent");

    this._colors = {
      rally: new THREE.Color(0xffebbb),
      blueprintBg: new THREE.Color(0x0a192f),
      blueprintMesh: new THREE.Color(0x112240),
      blueprintLine: accentHex,
    };

    scene.background = null;

    const pmrem = new THREE.PMREMGenerator(renderer);
    this._realisticEnv = pmrem.fromScene(new RoomEnvironment(), 0.02).texture;
    scene.environment = this._realisticEnv;

    this._rallyAmbient = new THREE.AmbientLight(0xffffff, 0.2);
    this._rallyDir = new THREE.DirectionalLight(0xfff5e6, 0.2);
    this._rallyDir.position.set(5, 10, 5);
    this._rallyFog = new THREE.FogExp2(this._colors.rally, 0.04);

    const accentDim = new THREE.Color(accentHex).multiplyScalar(0.2).getHex();
    this._grid = new THREE.GridHelper(20, 100, accentHex, accentDim);
    this._grid.position.y = -0.5;
    this._grid.visible = false;
    scene.add(this._grid);

    this._blueprintMat = new THREE.MeshBasicMaterial({
      color: this._colors.blueprintMesh,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    this.camera.position.set(0, 1, 3);
  }

  _setupPostProcessing() {
    const { renderer, scene, camera, _canvas: canvas } = this;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    const ssao = new SSAOPass(scene, camera, w, h);
    ssao.kernelRadius = 16;
    ssao.minDistance = 0.002;
    ssao.maxDistance = 0.1;
    this.composer.addPass(ssao);

    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(w, h), 0.25, 0.8, 0.7),
    );
  }

  _setupControls() {
    this.controls = new OrbitControls(this.camera, this._canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener("change", () => this._requestRender());
  }

  _loadModel(src) {
    if (!src) return;

    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    loader.load(src, (gltf) => {
      this.currentModel = gltf.scene;

      const box = new THREE.Box3().setFromObject(this.currentModel);
      box.getCenter(this._modelCenter);
      this._modelRadius = box.getBoundingSphere(new THREE.Sphere()).radius;

      this._grid.position.y = box.min.y;

      const rawMaterials = gltf.parser.json.materials || [];
      const toonCache = new Map();

      this.currentModel.traverse((child) => {
        if (!child.isMesh || !child.material) return;

        const origMat = child.material.clone();
        tagMaterial(origMat);
        child.userData.originalMaterial = origMat;
        const uuid = child.material.uuid;

        if (!toonCache.has(uuid)) {
          const raw = rawMaterials.find((m) => m.name === child.material.name);
          const rawAlpha =
            raw?.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1.0;
          const isGlass = rawAlpha < 1.0 || child.material.transparent;

          toonCache.set(
            uuid,
            new THREE.MeshToonMaterial({
              color: child.material.color,
              transparent: isGlass,
              opacity: isGlass ? rawAlpha : child.material.opacity,
              side: THREE.DoubleSide,
              depthWrite: !isGlass,
            }),
          );
        }

        // Clone per-mesh so each can be individually faded/desaturated
        const rallyMat = toonCache.get(uuid).clone();
        tagMaterial(rallyMat);
        child.userData.rallyMaterial = rallyMat;

        const bpMat = this._blueprintMat.clone();
        tagMaterial(bpMat);
        child.userData.blueprintMaterial = bpMat;

        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(child.geometry, 15),
          new THREE.LineBasicMaterial({ color: this._colors.blueprintLine }),
        );
        edges.visible = false;
        child.add(edges);
        child.userData.blueprintEdges = edges;
      });

      this.scene.add(this.currentModel);
      this.controls.target.copy(this._modelCenter);
      this._applyStyle();
      this._annotations.forEach((a) => this._attachAnnotationToScene(a));
      this.transitionToView({
        facing: "N",
        elevation: "MIDDLE",
        displayedNodes: [],
      });
      this._requestRender();
    });
  }

  // --- Style ---

  _applyStyle() {
    const { scene, currentModel, currentStyle: style } = this;
    if (!currentModel) return;

    scene.environment = null;
    scene.fog = null;
    this._grid.visible = false;
    scene.remove(this._rallyAmbient, this._rallyDir);

    if (style === "realistic") {
      scene.background = null;
      scene.environment = this._realisticEnv;
      currentModel.traverse((c) => {
        if (!c.isMesh) return;
        c.material = c.userData.originalMaterial;
        if (c.userData.blueprintEdges)
          c.userData.blueprintEdges.visible = false;
      });
    } else if (style === "rally") {
      scene.background = this._colors.rally;
      scene.fog = this._rallyFog;
      scene.add(this._rallyAmbient, this._rallyDir);
      currentModel.traverse((c) => {
        if (!c.isMesh || !c.userData.rallyMaterial) return;
        c.material = c.userData.rallyMaterial;
        if (c.userData.blueprintEdges)
          c.userData.blueprintEdges.visible = false;
      });
    } else if (style === "blueprint") {
      scene.background = this._colors.blueprintBg;
      this._grid.visible = true;
      currentModel.traverse((c) => {
        if (!c.isMesh || !c.userData.blueprintMaterial) return;
        c.material = c.userData.blueprintMaterial;
        if (c.userData.blueprintEdges) c.userData.blueprintEdges.visible = true;
      });
    }

    // Re-stamp dim state onto the newly-swapped materials
    this._applyDimState();
    this._requestRender();
  }

  // --- Node visibility ---

  _undimAll() {
    this.currentModel.traverse((c) => {
      if (c.isMesh) {
        this._dimmedMeshes.delete(c);
        this._animateMeshDim(c, false);
      }
    });
  }

  _setNodeVisibility(displayedNodes) {
    if (!this.currentModel) return;
    if (displayedNodes.length === 0) { this._undimAll(); return; }

    const activeMeshes = new Set();
    this.currentModel.traverse((c) => {
      if (displayedNodes.includes(c.name))
        c.traverse((ch) => { if (ch.isMesh) activeMeshes.add(ch); });
    });

    // Nothing matched — show everything rather than a blank canvas
    if (activeMeshes.size === 0) { this._undimAll(); return; }

    this.currentModel.traverse((c) => {
      if (!c.isMesh) return;
      const dim = !activeMeshes.has(c);
      if (dim) this._dimmedMeshes.add(c); else this._dimmedMeshes.delete(c);
      this._animateMeshDim(c, dim);
    });
  }

  _animateMeshDim(mesh, dim) {
    this._visAnims.get(mesh)?.pause();

    if (this.currentStyle !== "realistic") {
      // rally / blueprint don't support per-mesh transparency — just hide
      mesh.visible = !dim;
      return;
    }

    const mat = mesh.material;
    if (!mat?.userData?.origColor) return;

    const origOpacity = mat.userData.origOpacity ?? 1.0;

    // Already-transparent materials (glass, polycarbonate) look bad as double-ghosts;
    // just hide/show them cleanly.
    if (origOpacity < 1.0) {
      mesh.visible = !dim;
      return;
    }

    mesh.visible = true;

    const orig = mat.userData.origColor;

    const dc = dim ? dimmedColor(orig) : orig;
    const targetOpacity = dim ? 0.12 : origOpacity;
    const { r: targetR, g: targetG, b: targetB } = dc;

    const proxy = {
      r: mat.color.r,
      g: mat.color.g,
      b: mat.color.b,
      opacity: mat.opacity,
    };

    const anim = animate(proxy, {
      r: targetR,
      g: targetG,
      b: targetB,
      opacity: targetOpacity,
      duration: 400,
      easing: "easeInOutQuad",
      onRender: () => {
        mesh.material.color.setRGB(proxy.r, proxy.g, proxy.b);
        mesh.material.opacity = proxy.opacity;
        this._requestRender();
      },
    });

    this._visAnims.set(mesh, anim);
  }

  // Instantly re-apply dim state to whatever material is now on each dimmed mesh
  _applyDimState() {
    this._dimmedMeshes.forEach((mesh) => {
      if (this.currentStyle !== "realistic") {
        mesh.visible = false;
        return;
      }

      const mat = mesh.material;
      if (!mat?.userData?.origColor) return;

      // Already-transparent materials are just hidden when dimmed
      if ((mat.userData.origOpacity ?? 1.0) < 1.0) {
        mesh.visible = false;
        return;
      }

      mesh.visible = true;
      const { r, g, b } = dimmedColor(mat.userData.origColor);
      mat.color.setRGB(r, g, b);
      mat.opacity = 0.12;
      mat.transparent = true;
    });
  }

  // --- Camera animation ---

  _animateCamera(targetPos, targetCenter) {
    if (this._camAnim) this._camAnim.pause();

    const curCenter = this.controls.target.clone();

    // Decompose current camera position into spherical coords relative to current center
    const curOffset = this.camera.position.clone().sub(curCenter);
    const curR = curOffset.length();
    const curPolar = Math.acos(Math.max(-1, Math.min(1, curOffset.y / curR)));
    const curAz = Math.atan2(curOffset.x, curOffset.z);

    // Decompose target camera position into spherical coords relative to target center
    const tgtOffset = targetPos.clone().sub(targetCenter);
    const tgtR = tgtOffset.length();
    const tgtPolar = Math.acos(Math.max(-1, Math.min(1, tgtOffset.y / tgtR)));

    // Wrap azimuth delta to [-π, π] so the camera takes the short arc
    let dAz = Math.atan2(tgtOffset.x, tgtOffset.z) - curAz;
    if (dAz > Math.PI) dAz -= Math.PI * 2;
    if (dAz < -Math.PI) dAz += Math.PI * 2;
    const tgtAz = curAz + dAz;

    // Animate in spherical space; lerp the center separately
    const proxy = {
      az: curAz,
      polar: curPolar,
      r: curR,
      cx: curCenter.x,
      cy: curCenter.y,
      cz: curCenter.z,
    };

    this._camAnim = animate(proxy, {
      az: tgtAz,
      polar: tgtPolar,
      r: tgtR,
      cx: targetCenter.x,
      cy: targetCenter.y,
      cz: targetCenter.z,
      duration: 700,
      easing: "easeInOutCubic",
      onRender: () => {
        // Reconstruct Cartesian position from spherical coords relative to lerped center
        const sinP = Math.sin(proxy.polar);
        this.camera.position.set(
          proxy.cx + proxy.r * sinP * Math.sin(proxy.az),
          proxy.cy + proxy.r * Math.cos(proxy.polar),
          proxy.cz + proxy.r * sinP * Math.cos(proxy.az),
        );
        this.controls.target.set(proxy.cx, proxy.cy, proxy.cz);
        this._requestRender();
      },
    });
  }

  // --- Render loop ---

  _requestRender() {
    this._renderRequested = true;
  }

  _animate() {
    this._rafId = requestAnimationFrame(() => this._animate());
    this.controls.update(); // needed every frame for damping (fires "change" while coasting)

    if (!this._renderRequested) return;
    this._renderRequested = false;

    if (this.currentStyle === "rally") {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this._css2dRenderer.render(this.scene, this.camera);
    this._updateAnnotationLines();
  }

  // --- Annotation registry ---

  _registerAnnotation(annotation) {
    const line = document.createElementNS(SVG_NS, "line");
    line.style.display = "none";

    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("r", "4");
    dot.style.display = "none";

    this._annotationSvg.append(line, dot);
    annotation._svgLine = line;
    annotation._svgDot = dot;

    this._annotations.add(annotation);
    this._attachAnnotationToScene(annotation);
  }

  _unregisterAnnotation(annotation) {
    this._annotations.delete(annotation);
    annotation._css2dObj?.removeFromParent();
    annotation._svgLine?.remove();
    annotation._svgDot?.remove();
  }

  _attachAnnotationToScene(annotation) {
    const target = annotation.getAttribute("target");
    if (!target || !this.currentModel) return;
    const center = this._getNodeWorldCenter(target);
    if (!center) return;
    annotation._css2dObj.removeFromParent();
    annotation._css2dObj.position.copy(center);
    this.scene.add(annotation._css2dObj);
    this._requestRender();
  }

  // Project the 8 corners of the visible-nodes world AABB to screen space.
  _getVisibleScreenBounds() {
    if (!this.currentModel) return null;

    const box3 = new THREE.Box3();
    this.currentModel.traverse((c) => {
      if (c.isMesh && !this._dimmedMeshes.has(c)) box3.expandByObject(c);
    });
    if (box3.isEmpty()) return null;

    const w = this._canvas.clientWidth;
    const h = this._canvas.clientHeight;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const v = new THREE.Vector3();
    for (let xi = 0; xi < 2; xi++) {
      for (let yi = 0; yi < 2; yi++) {
        for (let zi = 0; zi < 2; zi++) {
          v.set(
            xi ? box3.max.x : box3.min.x,
            yi ? box3.max.y : box3.min.y,
            zi ? box3.max.z : box3.min.z,
          ).project(this.camera);
          const sx = (v.x * 0.5 + 0.5) * w;
          const sy = (-v.y * 0.5 + 0.5) * h;
          if (sx < minX) minX = sx;
          if (sy < minY) minY = sy;
          if (sx > maxX) maxX = sx;
          if (sy > maxY) maxY = sy;
        }
      }
    }
    return { minX, minY, maxX, maxY };
  }

  // Cast a ray from the AABB center in the clock direction and return the point
  // where it exits the AABB, offset outward by `padding` pixels.
  _clockAnchorFromBounds(location, bounds, padding = 24) {
    const { minX, minY, maxX, maxY } = bounds;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const a = (location * 30 * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a); // screen coords: y down

    let t = Infinity;
    if (Math.abs(dx) > 1e-9)
      t = Math.min(t, dx > 0 ? (maxX - cx) / dx : (minX - cx) / dx);
    if (Math.abs(dy) > 1e-9)
      t = Math.min(t, dy > 0 ? (maxY - cy) / dy : (minY - cy) / dy);
    if (!isFinite(t) || t < 0) t = 80;

    return { x: cx + (t + padding) * dx, y: cy + (t + padding) * dy, dx, dy };
  }

  _updateAnnotationLines() {
    if (!this._annotations.size) return;
    const bounds = this._getVisibleScreenBounds();

    for (const annotation of this._annotations) {
      const { _svgLine: line, _svgDot: dot } = annotation;
      if (!line || !dot) continue;

      const hide = () => { line.style.display = dot.style.display = "none"; };

      if (annotation.hasAttribute("hidden") || !bounds || !this.currentModel) {
        hide(); continue;
      }

      let targetPos;
      try {
        targetPos = this.getScreenPositionOfNode(annotation.getAttribute("target"));
      } catch { hide(); continue; }

      const anchor = this._clockAnchorFromBounds(
        parseLocation(annotation.getAttribute("location")),
        bounds,
      );

      // Card lives in the CSS2DObject (positioned at targetPos); offset by the delta
      // to reach the clock anchor outside the visible-node bounding box.
      if (annotation._card) {
        annotation._card.style.left = `${anchor.x - targetPos.x}px`;
        annotation._card.style.top = `${anchor.y - targetPos.y}px`;
        annotation._card.style.transform = cardTransform(anchor.dx, anchor.dy);
      }

      dot.setAttribute("cx", String(targetPos.x));
      dot.setAttribute("cy", String(targetPos.y));
      line.setAttribute("x1", String(targetPos.x));
      line.setAttribute("y1", String(targetPos.y));
      line.setAttribute("x2", String(anchor.x));
      line.setAttribute("y2", String(anchor.y));
      line.style.display = dot.style.display = "";
    }
  }

  _resize() {
    const w = this.clientWidth || 800;
    const h = this.clientHeight || 600;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this._css2dRenderer.setSize(w, h);
  }
}

customElements.define("notebook-viewer", NotebookViewer);
