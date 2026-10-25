import { mountOrbit } from './renderer.js';

if (!document.getElementById('choam-universe')) {
  const container = document.createElement('div');
  Object.assign(container.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
  document.body.prepend(container);
  window.orbit = mountOrbit(container, { assetBase: new URL('./assets/', document.currentScript?.src || document.baseURI).href });
  window.orbit.root.id = 'choam-universe';
}
