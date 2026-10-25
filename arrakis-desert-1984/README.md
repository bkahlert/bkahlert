# Arrakis Desert (1984)

An independent crimson desert background with cyan textured moons and moving dust.
The upper moon sits right; the lower moon sits left behind the dunes.

[![Arrakis Desert (1984)](svg/arrakis-desert-1984.svg)](svg/arrakis-desert-1984.svg)

Open the [comparison](index.html) to compare the three formats.
Each distribution folder can be copied into an unrelated HTTP root:

| Format           | Entry                                              | Integration                                   |
|------------------|----------------------------------------------------|-----------------------------------------------|
| WebGL            | [webgl/index.html](webgl/index.html)               | Local module, stylesheet, and assets          |
| Native component | [webcomponent/index.html](webcomponent/index.html) | Shadow DOM custom element                     |
| SVG              | [svg/index.html](svg/index.html)                   | Self-contained animated and still backgrounds |

The runtime pages contain only the decorative background.
All runtime resources are local. No runtime dependencies or CDN requests are needed.

## Native component

Copy the complete [webcomponent](webcomponent) directory beside the embedding page.
The element fills its own dimensions; size it in the host page.

```html

<script type="module" src="./webcomponent/arrakis-desert-1984.js"></script>
<arrakis-desert-1984 style="display:block;width:100%;height:100vh">
</arrakis-desert-1984>
```

`await element.ready` settles after initialization, including fallback failures.
The Boolean `paused` property reflects the `paused` attribute.
`pause()` enables explicit pause; `resume()` clears it.
A paused frame remains visible.

Each element owns its resources and pause state.
Disconnecting disposes the renderer and listeners.
Reconnecting creates a fresh renderer and `ready` promise.
Texture and fallback URLs resolve beside the module, including nested paths.

## Renderer

[Canonical source](src/scene.js) exports `mountDesert(root, { assetBase })`.
The root must have dimensions. The optional asset base identifies the texture folder.
The returned controller provides `ready`, `pause()`, `resume()`, and `dispose()`.
Repeated mounts of one root return its existing controller until disposal.

Hidden pages, page suspension, explicit pause, and reduced-motion preferences stop animation.
Focus transitions ease over 650 milliseconds. Rendering is capped at 30 FPS.
Resizing and WebGL context restoration retain the lifecycle behavior.
Unavailable WebGL, shader failures, or texture failures reveal the local still SVG.

## SVG differences

The SVG embeds seven responsive compositions exported from the renderer, including square and 1.2:1 scenes for near-square viewports.
It contains 48 independently moving dust clouds using the current sprite and palette.
Near particles span the full view and cross in front of the moons.
Two depth masks approximate the renderer's per-pixel terrain occlusion.
The far and near layers retain their different projection, altitude, and opacity.

SVG uses 24 sampled motion intervals per repeating particle path and layer altitude gradients.
It approximates gust timing and depth transitions between two masks.
The broad volumetric gust is baked into the exported landscape at scene time zero.
SVG therefore approximates motion rather than reproducing every WebGL frame.
The page selects the still asset for reduced motion.
The animated SVG itself remains animated independently of host media preferences.
Both SVG files contain no JavaScript or external resource requests.

## Build and verification

Node.js 22 or newer is required. Development dependencies are pinned in the lockfile.

```shell
npm ci
npx playwright install chromium webkit
npm run build
npm run check:generated
npm test
npm run serve
```

The server uses port 4185; `PORT` overrides it.
[Build scripts](scripts) generate the WebGL copy, component bundle, and SVG assets.
[The manifest](build-manifest.json) records input and output SHA-256 hashes.
`check:generated` checks freshness without rebuilding.
Committed generated duplication keeps every runtime folder independently copyable.

Package-owned tests compile real shaders in Chromium and WebKit.
They cover responsive moons and dunes, negative visual controls, visible storm motion,
independent copies, nested URLs, component lifecycle, fallback, context loss,
focus easing, visibility, reduced motion, and disposal during texture loading.

## Credits

[Asset credits](src/assets/CREDITS.txt) identify the Solar System Scope moon texture,
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Terrain, dust, composition, and crimson recoloring are original procedural artwork.
