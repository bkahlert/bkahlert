import { mountOrbit } from './renderer.js';

/** A decorative orbital scene with independent sizing, motion, and resources. */
export class ArrakisOrbit1984 extends HTMLElement {
  static observedAttributes = ['paused'];
  #controller;
  #resolveReady;
  #ready;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host { display:block; position:relative; overflow:hidden; }';
    this.shadowRoot.append(style);
    this.#resetReady();
  }

  #resetReady() { this.#ready = new Promise(resolve => { this.#resolveReady = resolve; }); }

  connectedCallback() {
    if (this.#controller) return;
    this.#controller = mountOrbit(this.shadowRoot, {
      assetBase: new URL('./assets/', import.meta.url).href,
      paused: this.paused,
    });
    const resolve = this.#resolveReady;
    this.#controller.ready.then(resolve);
  }

  disconnectedCallback() {
    this.#controller?.dispose();
    this.#controller = undefined;
    this.#resolveReady();
    this.#resetReady();
  }

  attributeChangedCallback() { this.#controller?.setPaused(this.paused); }

  /** Returns a promise settled after this connection initializes, falls back, or disconnects. */
  get ready() { return this.#ready; }

  /** Returns the instance's explicit pause state. */
  get paused() { return this.hasAttribute('paused'); }

  /** Sets explicit pause without affecting other instances. */
  set paused(value) { this.toggleAttribute('paused', Boolean(value)); }

  /** Pauses this instance. */
  pause() { this.paused = true; }

  /** Resumes this instance unless reduced motion or page state prevents animation. */
  resume() { this.paused = false; }
}

if (!customElements.get('arrakis-orbit-1984')) customElements.define('arrakis-orbit-1984', ArrakisOrbit1984);
