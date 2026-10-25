import { mountOrbit } from './renderer.js';

window.orbit = mountOrbit(document.querySelector('#scene'), {
  assetBase: new URL('./assets/', import.meta.url).href,
});
