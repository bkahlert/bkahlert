import { mountOrbit } from './renderer.js';

/** A decorative orbital background that fills its explicitly sized host and releases resources on removal. */
export class ArrakisOrbit extends HTMLElement {
  static observedAttributes = ['paused'];
  #controller;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host { display: block; position: relative; overflow: hidden; }';
    this.shadowRoot.append(style);
  }

  connectedCallback() {
    this.#controller = mountOrbit(this.shadowRoot, {
      assetBase: new URL('./assets/', import.meta.url).href,
      scene: this.getAttribute('scene') || 'eclipse',
      paused: this.paused,
    });
  }

  disconnectedCallback() {
    this.#controller?.dispose();
    this.#controller = undefined;
  }

  attributeChangedCallback() {
    this.#controller?.setPaused(this.paused);
  }

  /** Returns whether animation was explicitly paused, independently of reduced motion. */
  get paused() { return this.hasAttribute('paused'); }

  /** Sets the instance's pause state without affecting other backgrounds. */
  set paused(value) { this.toggleAttribute('paused', Boolean(value)); }
}

if (!customElements.get('arrakis-orbit')) customElements.define('arrakis-orbit', ArrakisOrbit);
