![Kaomoji Hero](kaomoji-hero.svg)

## Animated backgrounds

Each background is an independent mini-project with local artwork, documentation,
generators, and browser tests. Each provides a plain WebGL page, a native web component,
and a self-contained SVG CSS background. Each project page compares the three
variants side by side in iframes.

| Project                                     | Scene                                       | Guide                                    |
| ------------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| [Arrakis desert](arrakis-desert/index.html) | Two moons above dunes and approaching sand  | [Desert guide](arrakis-desert/README.md) |
| [Arrakis orbit](arrakis-orbit/index.html)   | Eclipse, planets, and a starfield           | [Orbit guide](arrakis-orbit/README.md)   |

The [background workflow](.github/workflows/backgrounds.yml) installs, builds, and tests
each project independently in Chromium and WebKit. Setup and local commands live in each guide.
