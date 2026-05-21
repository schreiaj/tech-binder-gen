import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

class NotebookAnnotation extends HTMLElement {
  static get observedAttributes() {
    return ["target", "location", "hidden"];
  }

  constructor() {
    super();
    this._css2dObj = null;
    this._observer = null;
    this._syncQueued = false;
    this.style.display = "none"; // visuals live in the viewer's overlays
  }

  connectedCallback() {
    this._buildUI();
    // Dispatch event so the viewer registers us regardless of upgrade order
    this.dispatchEvent(new CustomEvent("annotation-connected", { bubbles: true, detail: this }));

    this._observer = new MutationObserver(() => this._queueSync());
    this._observer.observe(this, { childList: true, subtree: true, characterData: true });
    this._syncContent();
  }

  disconnectedCallback() {
    this._observer?.disconnect();
    this.dispatchEvent(new CustomEvent("annotation-disconnected", { bubbles: true, detail: this }));
  }

  attributeChangedCallback(name) {
    if (name === "hidden") {
      if (this._css2dObj) this._css2dObj.visible = !this.hasAttribute("hidden");
      this.dispatchEvent(new CustomEvent("annotation-visibility-changed", { bubbles: true, detail: this }));
    } else if (name === "target") {
      this.dispatchEvent(new CustomEvent("annotation-target-changed", { bubbles: true, detail: this }));
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

  // Coalesce rapid MutationObserver callbacks into one sync per microtask checkpoint.
  _queueSync() {
    if (this._syncQueued) return;
    this._syncQueued = true;
    queueMicrotask(() => { this._syncQueued = false; this._syncContent(); });
  }

  _syncContent() {
    if (!this._titleEl) return;
    const clone = (slot) =>
      Array.from(this.querySelector(slot)?.childNodes ?? []).map((n) => n.cloneNode(true));
    this._titleEl.replaceChildren(...clone('[slot="title"]'));
    this._bodyEl.replaceChildren(...clone('[slot="body"]'));
  }
}

customElements.define("notebook-annotation", NotebookAnnotation);
