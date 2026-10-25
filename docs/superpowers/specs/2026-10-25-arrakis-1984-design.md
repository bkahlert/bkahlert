# Arrakis 1984 distributions

## Approved design

The user approved the live 1984 previews and requested complete packages with
their own tests, web components, and SVG generation. This document records that
approved direction; implementation must preserve the artwork rather than reopen it.

- Names are `arrakis-desert-1984` and `arrakis-orbit-1984`.
- Both use the approved crimson palette, cyan textured moons, and dark shadows.
- Desert has its large moon at upper right and its lower moon at left.
  The lower moon radius is `0.145 * moonScale`, centered at
  `(-0.23 * aspect, -0.345)`, partly hidden by dunes.
  The upper moon is centered at `(0.26 * aspect, 0.20)`.
- The desert storm crosses the entire first-person view. Near particles pass in
  front of the moons; depth-based occlusion preserves the dunes. The latest
  prototype particle projection and gust heights are the approved baseline.
- Orbit retains the Twilight composition: large eclipsed Arrakis at lower left,
  cyan moons at upper right and near center, crimson clouds behind them.
  Rotation uses `0.0045` radians per scene second. Cloud time is scene time
  multiplied by `0.67`; independent star drift and other speeds remain unchanged.
- No obsolete Crimson/Twilight selector remains.

## Distribution contract

Each package is an independent directory, following the original packages:

- Canonical JavaScript, CSS, and credited textures in `src/`.
- `webgl/`, `webcomponent/`, and `svg/` are independently copyable runtime folders.
- Every variant has an `index.html` containing only the decorative background.
- The package `index.html` compares the three formats in labeled iframe panels.
- Custom elements are `<arrakis-desert-1984>` and `<arrakis-orbit-1984>`.
  Each owns its Shadow DOM, animation, sizing, resources, and pause state.
- Components support a Boolean `paused` property/attribute, `pause()`, `resume()`,
  and a `ready` promise that settles after initialization, including fallback.
  Disconnecting disposes resources; reconnecting creates a fresh renderer.
- Animation stops for hidden pages, page suspension, reduced motion, and explicit pause.
  Focus transitions retain the existing easing. Resizing and context restoration
  remain functional. Failed WebGL or texture loading displays a local fallback.
- Generated animated and still SVGs are self-contained, with no JavaScript or
  external requests. The SVG page uses them as CSS backgrounds and selects the
  still file under `prefers-reduced-motion: reduce`.
- SVG composition and colors must match the approved renderer at phone,
  landscape, and desktop sizes. Animation may approximate WebGL; the README must
  identify the actual differences. Static image motion alone is insufficient for
  the desert storm: its SVG must contain separately moving dust.
- Build inputs and output hashes are recorded in a generated manifest.
  `check:generated` detects changed sources and stale or missing outputs without
  rebuilding them.
- Node.js 22 or newer. Use the existing pinned esbuild, Playwright, pngjs, and
  sharp versions; no runtime dependencies or CDN requests.
- Each package has its own lockfile, scripts, tests, README, and asset credits.
  Package tests and builds must not import files from the original packages.
- Original `arrakis-desert/` and `arrakis-orbit/` stay unchanged.

## Approach

Promote each approved prototype into the existing source/build/distribution
structure. Reuse the original package patterns where their behavior matches.
Derive SVG artwork from the approved renderer; do not reuse the original beige
desert or different orbital composition. Keep the two packages independent.

Keeping the prototypes as standalone demos would not provide the requested
embedding or verification. Sharing a new cross-package runtime would make copying
the projects harder and add an unnecessary dependency between them.

## Verification

Use package-owned Node tests and real Chromium/WebKit page checks. Cover:

- Real shader compilation, both moons and dunes or planet, crimson colors, and
  visible motion. Include a negative control that proves visual landmark checks
  fail when artwork is missing.
- Desert motion above mid-screen; orbital stars, rotation, and cloud motion.
- Multiple components, independent pause, disconnect/reconnect, resizing,
  reduced motion, focus/visibility, context loss/restoration, and fallback errors.
- Each variant copied into an isolated HTTP root, including nested module URLs,
  with no missing or external requests.
- SVG self-containment, animated-versus-still behavior, host reduced motion,
  responsive layout, and generated artifact freshness.
- Review the generated formats visually against the approved previews.

## Integration and shipping

Add the packages to the root README and existing backgrounds CI matrix/path
filters. Keep the 1984 gallery usable, linking to the complete distributions.
Run checks and an independent review before a local topic-branch commit.
Pushing, publishing, and merging are separate external actions.
