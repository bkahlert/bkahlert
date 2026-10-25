# Arrakis Desert

Two textured crescents above procedural dunes and a moving sandstorm.
This directory is a standalone project. Copy it anywhere without its parent repository.

[![Arrakis Desert](svg/arrakis-desert.svg)](svg/arrakis-desert.svg)

Open [index.html](index.html) to compare all three variants side by side.
The labeled iframe panels remain in one row and scroll horizontally on narrow screens.
Live iframe previews follow frame focus; click a live preview to animate it.

| Page                                               | Format                                           |
|----------------------------------------------------|--------------------------------------------------|
| [webgl/index.html](webgl/index.html)               | Original live WebGL renderer                     |
| [webcomponent/index.html](webcomponent/index.html) | Native `<arrakis-desert>` custom element         |
| [svg/index.html](svg/index.html)                   | Self-contained SVG used only as a CSS background |

Each variant page contains only its background, without controls, text, or overlays.
Both moons intentionally crop at some viewport edges.

## Run

Install Node.js 22 or newer, then run these commands inside this directory:

```shell
npm ci
npx playwright install chromium webkit
npm run build
npm test
npm run serve
```

Open [the local server](http://127.0.0.1:4173).
Set `PORT` to change its loopback port.
On Linux, install browser system libraries with `npx playwright install --with-deps chromium webkit`.
Normal viewing needs only a static HTTP server; Node and Playwright are build/test tools.

## Embed

Copy [webcomponent](webcomponent) as a whole; its bundle, texture, and fallback image are local.
The [webgl](webgl) and [svg](svg) directories are independently copyable in the same way.
Serve any copied variant directory with an ordinary static HTTP server.

```html

<script type="module" src="/backgrounds/arrakis-desert/webcomponent/arrakis-desert.js"></script>
<div style="position:relative;width:100%;height:32rem">
  <arrakis-desert style="width:100%;height:100%"></arrakis-desert>
</div>
```

Each element owns its Shadow DOM, animation, resize observation, and GPU resources.
Multiple elements can share a page. Disconnecting disposes the renderer;
reconnecting initializes a fresh one. Asset URLs resolve relative to the module.
An explicit container height is required.

The `paused` attribute, `pause()`, and `resume()` control motion.
`ready` resolves after initialization, including graceful rendering failures.
Reduced motion, hidden documents, and page suspension stop animation.
Focus changes ease speed over 650 milliseconds. Rendering is capped at 30 frames per second.
A generated still image remains available when WebGL or texture loading fails.

The [renderer module](webgl/scene.js) exports `mountDesert(element, { assetBase })` for direct integration.
Its controller exposes `ready`, `pause()`, `resume()`, and idempotent `dispose()`.
Repeated mounting on the same element returns its existing controller.
Load [webgl/scene.css](webgl/scene.css) and place the root inside a positioned, sized container.
The low-level `createRenderer(canvas, gl, images)` supplies the same artwork to the SVG exporter.
Its `exportAssets(width, height)` returns the rendered scene, depth mask, and dust sprite;
`dispose()` releases GPU allocations. Export failures throw.

## SVG embedding

From a stylesheet at the project root:

```css
.desert {
  background: #211b16 url('./svg/arrakis-desert.svg') center / 100% 100%;
}
@media (prefers-reduced-motion: reduce) {
  .desert { background-image: url('./svg/arrakis-desert-still.svg'); }
}
```

Give the element a width and height. The [SVG variant](svg/index.html) needs no JavaScript.
When copying only [svg](svg), use `./arrakis-desert.svg` and `./arrakis-desert-still.svg` beside the stylesheet.
The SVG embeds seven aspect-specific snapshots, including square and 1.2:1 compositions for near-square viewports.
Each snapshot includes its depth mask and the dust sprite.
It contains no scripts or external resource references.
CSS keyframes approximate the live storm with 48 clouds across far and near layers and 24 motion intervals; gust timing and depth occlusion differ.
The terrain and moons are rasterized, so extreme enlargement can reveal fixed-resolution detail.
The [still SVG](svg/arrakis-desert-still.svg) contains no animation declarations.
The animated SVG does not apply reduced-motion preferences internally.
Its host must select the still SVG using the media query above; [svg/index.html](svg/index.html) already does this.

## Sources and verification

Canonical code and assets live in [src](src); edit those files and rebuild.
[Build scripts](scripts) copy the WebGL files and assets, bundle the component,
and generate self-contained SVGs plus local fallback copies.
Renderer files and assets inside the variants are generated from these shared sources.

The [component](src/component.js) and [renderer](src/scene.js) are bundled with esbuild.
The [SVG generator](scripts/build-svg.mjs) calls the shared renderer directly in Chromium.
It embeds the scene, depth masks, and original dust sprite into the SVG outputs.
The [build manifest](build-manifest.json) records source and output hashes;
`npm run check:generated` rejects stale generated files before a rebuild. Rebuild after editing artwork or styles.
Rendering can vary slightly between GPU drivers, so generated JPEG bytes may vary.

`npm test` runs the adapted upstream lifecycle suite and both browsers' real-page tests.
Coverage includes both crescent landmarks independently, dunes, visible foreground storm
motion, reduced motion, GPU limits, shaders, textures, framebuffers, focus easing,
visibility, context loss, mounting, disposal, resizing, and reconnecting.
Negative controls remove each moon separately and prove its pixel assertion fails.
Tests copy each variant alone into an isolated HTTP root, reject missing or external requests,
and verify both moons and dunes. They also exercise portrait and landscape layouts,
component isolation, nested URL embedding, and the side-by-side comparison.
Screenshots and logs belong in the ignored [test-results](test-results) directory.

Browser automation does not replace physical-device testing.

## Credits

The artwork and original lifecycle tests were copied from the CHOAM Arrakis study.
Their local adaptation has no runtime, generator, or test dependency on that repository.
The renderer preserves its terrain, moon shaders, and storm composition.
The GoodBytes Arrakis demo inspired the composition; its code, audio, and images are not included.

The lunar texture is from Solar System Scope under CC BY 4.0.
See [asset credits](src/assets/CREDITS.txt) and
[the optional texture preparation recipe](scripts/prepare_texture.py).
The recipe uses its own inline-pinned Pillow dependency and a locally downloaded original;
normal builds use the included texture without Python or network access.
The recipe writes its result to [src/assets/moon.jpg](src/assets/moon.jpg).
