import { mountDesert } from './scene.js';
import styles from './scene.css';

/** A container-sized decorative desert with automatic connection and cleanup. */
export class ArrakisDesert1984 extends HTMLElement {
  /** Attributes that update the current renderer without remounting. */
  static observedAttributes = ['paused'];
  #controller;
  #root;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{display:block;position:relative;overflow:hidden;contain:layout paint}' + styles;
    this.#root = document.createElement('div');
    shadow.append(style, this.#root);
  }

  /** Mounts the artwork when the element enters a document. */
  connectedCallback() {
    this.#controller = mountDesert(this.#root);
    const fallback = this.#root.querySelector('.choam-universe__still');
    const fallbackUrl = new URL('./arrakis-desert-1984-still.svg', import.meta.url).href;
    fallback.style.setProperty('--still-image', `url("${fallbackUrl}")`);
    if (this.hasAttribute('paused')) this.#controller.pause();
  }

  /** Releases rendering resources when the element leaves its document. */
  disconnectedCallback() {
    this.#controller?.dispose();
    this.#controller = undefined;
  }

  /** Synchronizes the paused attribute with the current connection. */
  attributeChangedCallback() {
    if (this.hasAttribute('paused')) this.#controller?.pause();
    else this.#controller?.resume();
  }

  /** Resolves after this connection initializes, including fallback failures. */
  get ready() { return this.#controller?.ready ?? Promise.resolve(); }

  /** Returns whether explicit pause is enabled. */
  get paused() { return this.hasAttribute('paused'); }

  /** Sets explicit pause and reflects it to the Boolean attribute. */
  set paused(value) { this.toggleAttribute('paused', Boolean(value)); }

  /** Pauses motion until resume is called; the still frame remains visible. */
  pause() { this.setAttribute('paused', ''); }

  /** Resumes motion when focus, visibility, and reduced-motion preferences allow it. */
  resume() { this.removeAttribute('paused'); }
}

if (!customElements.get('arrakis-desert-1984')) customElements.define('arrakis-desert-1984', ArrakisDesert1984);
