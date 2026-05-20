import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

class NotebookAnnotation extends HTMLElement {
  static get observedAttributes() {
    return ["target", "location", "hidden"];
  }

  constructor() {
    super();
    this._viewer = null;
    this._css2dObj = null;
    this._observer = null;
    this.style.display = "none"; // visuals live in the viewer's overlays
  }

  connectedCallback() {
    this._buildUI();
    this._viewer = this.closest("notebook-viewer");
    this._viewer?._registerAnnotation(this);

    this._observer = new MutationObserver(() => this._syncContent());
    this._observer.observe(this, { childList: true, subtree: true, characterData: true });
    this._syncContent();
  }

  disconnectedCallback() {
    this._observer?.disconnect();
    this._viewer?._unregisterAnnotation(this);
    this._viewer = null;
  }

  attributeChangedCallback(name) {
    if (name === "hidden") {
      if (this._css2dObj) this._css2dObj.visible = !this.hasAttribute("hidden");
    } else if (name === "target") {
      this._viewer?._attachAnnotationToScene(this);
    }
    // "location" is read each frame by viewer._updateAnnotationLines — no action needed here
  }

  _buildUI() {
    this._el = document.createElement("div");
    this._el.style.cssText =
      "position:absolute;width:0;height:0;overflow:visible;pointer-events:none;";

    this._card = document.createElement("div");
    this._card.style.cssText = [
      "position:absolute",
      "background:var(--bg,#f0ebe4)",
      "border:1px solid var(--border,rgba(0,0,0,0.15))",
      "border-left:3px solid var(--accent,orange)",
      "border-radius:3px",
      "padding:8px 12px",
      "max-width:180px",
      "min-width:100px",
      "pointer-events:auto",
      "box-shadow:0 2px 8px rgba(0,0,0,0.12)",
      "font-family:Inter,'Helvetica Neue','Segoe UI',system-ui,sans-serif",
      "white-space:normal",
    ].join(";");

    this._titleEl = document.createElement("div");
    this._titleEl.style.cssText =
      "font-weight:700;font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent-text,#8b5e00);margin-bottom:4px;";

    this._bodyEl = document.createElement("div");
    this._bodyEl.style.cssText =
      "font-size:0.75rem;color:var(--text,#1a1a1a);line-height:1.4;";

    this._card.append(this._titleEl, this._bodyEl);
    this._el.append(this._card);

    this._css2dObj = new CSS2DObject(this._el);
    this._css2dObj.visible = !this.hasAttribute("hidden");
  }

  _syncContent() {
    if (!this._titleEl) return;
    this._titleEl.innerHTML = this.querySelector('[slot="title"]')?.innerHTML ?? "";
    this._bodyEl.innerHTML = this.querySelector('[slot="body"]')?.innerHTML ?? "";
  }
}

customElements.define("notebook-annotation", NotebookAnnotation);
