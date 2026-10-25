![Kaomoji Hero](kaomoji-hero.svg)

## Animated backgrounds

Each background is an independent mini-project with local artwork, documentation,
generators, and browser tests. Each provides a plain WebGL page, a native web component,
and a self-contained SVG CSS background. Each project page compares the three
variants side by side in iframes.

| Project                                               | Scene                                                 | Guide                                              |
| ----------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| [Arrakis desert](arrakis-desert/index.html)           | Two moons above dunes and approaching sand            | [Desert guide](arrakis-desert/README.md)           |
| [Arrakis orbit](arrakis-orbit/index.html)             | Eclipse, planets, and a starfield                     | [Orbit guide](arrakis-orbit/README.md)             |
| [Arrakis desert 1984](arrakis-desert-1984/index.html) | Cyan moons, crimson skies, and an eye-level sandstorm | [Desert 1984 guide](arrakis-desert-1984/README.md) |
| [Arrakis orbit 1984](arrakis-orbit-1984/index.html)   | Crimson clouds, cyan moons, and a warm eclipse        | [Orbit 1984 guide](arrakis-orbit-1984/README.md)   |

The [1984 gallery](previews/1984/index.html) shows both selected scenes and links
to their format comparisons.

The [background workflow](.github/workflows/backgrounds.yml) installs, builds, and tests
each project independently in Chromium and WebKit. Setup and local commands live in each guide.
