# Arrakis Orbit (1984)

Crimson twilight behind cyan textured moons and an eclipsed Arrakis at lower left.
The WebGL scene includes slow rotation and moving clouds.

[![Arrakis Orbit (1984)](svg/arrakis-orbit-1984.svg)](svg/arrakis-orbit-1984.svg)

Open [index.html](index.html) to compare the three formats. Each runtime page
contains only the decorative background.

| Format             | Standalone page                                    |
|--------------------|----------------------------------------------------|
| WebGL              | [webgl/index.html](webgl/index.html)               |
| Web component      | [webcomponent/index.html](webcomponent/index.html) |
| SVG CSS background | [svg/index.html](svg/index.html)                   |

Each variant directory can be copied alone to any HTTP root. The component also
works from nested module URLs. Runtime files use local assets and require no
package installation, CDN, or external requests. Serve modules over HTTP.

## Development

Requires Node.js 22 or newer. Install the pinned build dependencies:

```shell
npm ci
```

Install Chromium and WebKit before building or testing. Chromium renders the
shader layers used by the SVG generator.

```shell
npx playwright install chromium webkit
```

Regenerate the bundles and SVGs:

```shell
npm run build
```

Verify generated source/output hashes without rebuilding:

```shell
npm run check:generated
```

Run the package's independent browser and Node tests:

```shell
npm test
```

Serve the comparison and variants on the printed URL. `PORT` overrides 4186:

```shell
npm run serve
```

Canonical code, styles, and textures live in [src](src). The
[build manifest](build-manifest.json) records build inputs and outputs.
Builds are local and offline after dependency/browser installation. SVG raster
pixels can vary with Chromium and graphics drivers; freshness checks use recorded
hashes and do not rerender artwork.

## Embed

Copy the complete [webcomponent](webcomponent) directory, including its assets.

```html

<script type="module" src="./webcomponent/arrakis-orbit-1984.js"></script>
<arrakis-orbit-1984
  style="width:100%;height:480px"
  aria-hidden="true"
></arrakis-orbit-1984>
```

The element fills an explicitly sized host and owns its Shadow DOM, observer,
listeners, animation, and GPU resources. Instances have independent sizes and pause
states. Removal disposes resources; reconnection creates a fresh renderer.

The Boolean `paused` attribute/property stops motion. `pause()` and `resume()`
provide the same control. `ready` settles after drawing, fallback, or disconnection.
Read `ready` again after reconnection for that connection's initialization.

```javascript
const scene = document.querySelector('arrakis-orbit-1984');
await scene.ready;
scene.pause();
scene.resume();
```

The WebGL page exposes `window.orbit.ready`, `setPaused(Boolean)`, and `dispose()`.
The reusable [mountOrbit](src/renderer.js) accepts a container, optional
module-relative `assetBase`, and optional `paused`. It returns the same controller
and its decorative root. No scene selector is supported.

## Motion and fallback

Live rotation is `0.0045` radians per scene second. Cloud time is scene time times
`0.67`; star drift remains independent. Focus changes ease over 650 milliseconds.
Hidden pages, page suspension, explicit pause, and reduced motion stop animation.
Resizing still works while paused. WebGL context restoration recreates resources.
Missing textures or unavailable WebGL show the local CSS fallback.

The SVG generator renders separate clouds, stars, and sphere layers from the actual
fragment shader at time zero. It embeds every image as a data URI. Cyan
moons, the crimson plume, and lower-left eclipse retain their responsive placement.
Sphere exports use supersampling and transparent edge coverage. Stars receive
modest brightness compensation for raster downsampling.

The animated SVG drifts clouds, stars, and the large moon independently. It bakes
sphere rotation, procedural cloud evolution, and grain; its vignette and additive
halos approximate WebGL compositing. Raster layers soften at extreme zoom. Cloud
framing follows the shader for viewport aspect ratios up to 4:1. Wider views crop
the baked sky. Live WebGL supports arbitrary viewport sizes.

The [SVG page](svg/index.html) selects the [still SVG](svg/arrakis-orbit-1984-still.svg)
under the host's reduced-motion query. Keep that CSS query when embedding as a
background image; SVG image documents do not consistently inherit host preferences.
The animated SVG contains CSS animation and no JavaScript or external requests.

## Attribution and tests

Planet maps came from existing repository assets. [Credits](src/assets/CREDITS.txt)
retain Solar System Scope / INOVE attribution, source URLs, adaptation details,
and CC BY 4.0 licensing. This is artistic Dune-inspired artwork, not an
astronomical map or an official licensed adaptation.

Package-owned tests exercise Chromium and WebKit, actual shader compilation,
landmark omission controls, desktop/phone/landscape composition, motion, focus,
visibility, reduced motion, texture/compile/link failures, context restoration,
multiple components, pause, resize, disconnect/reconnect, and delayed removal.
They copy runtime variants into isolated HTTP roots and verify local requests,
SVG self-containment, generated freshness, and fallback readiness. Screenshots are
written to [test-results](test-results). Physical devices and GPU drivers remain
outside the automated coverage.
