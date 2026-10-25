import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import sharp from 'sharp';

/** Generates self-contained SVG layers directly from the fragment shader at scene time zero. */
export async function buildSvg(rootDirectory) {
  const source = await readFile(path.join(rootDirectory, 'src/renderer.js'), 'utf8');
  const credits = await readFile(path.join(rootDirectory, 'src/assets/CREDITS.txt'), 'utf8');
  const browser = await chromium.launch({ headless: true });
  const layers = {};
  try {
    for (const layer of ['clouds', 'stars', 'arrakis', 'moon-large', 'moon-small']) {
      const sphere = !['clouds', 'stars'].includes(layer);
      const main = sphere ? sphereMain(layer) : skyMain(layer);
      const start = source.indexOf('      void main() {\n        float aspect');
      const end = source.indexOf('\n    `', start);
      if (start < 0 || end < 0) throw new Error('Fragment main was not found');
      const replacement = source.slice(0, start) + main + source.slice(end);
      const prepared = replacement.replace('alpha: false,', 'alpha: true, premultipliedAlpha: false,')
        .replace('const budget = width < 700 ? 1100000 : 2200000', 'const budget = Infinity');
      const bundled = await build({
        stdin: { contents: prepared + '\nwindow.exportController = mountOrbit(document.body);', resolveDir: path.join(rootDirectory, 'src'), sourcefile: 'svg-export.js' },
        bundle: true, format: 'esm', loader: { '.css': 'text' }, write: false, logLevel: 'error',
      });
      const page = await browser.newPage({ viewport: sphere ? { width: 3072, height: 3072 } : layer === 'stars' ? { width: 4096, height: 1024 } : { width: 2048, height: 512 }, reducedMotion: 'reduce' });
      await page.route('https://export.test/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<html lang="en"><style>html,body{margin:0;width:100%;height:100%}</style><body><script type="module" src="/export.js"></script></body></html>' });
        if (pathname === '/export.js') return route.fulfill({ contentType: 'text/javascript', body: bundled.outputFiles[0].text });
        return route.fulfill({ contentType: 'image/jpeg', body: await readFile(path.join(rootDirectory, 'src', pathname)) });
      });
      await page.goto('https://export.test/');
      await page.evaluate(() => window.exportController.ready);
      const error = await page.locator('.orbit-1984').getAttribute('data-error');
      if (error || !await page.locator('.orbit-1984--ready').count()) throw new Error(error || 'SVG export needs working Chromium WebGL');
      const data = await page.locator('canvas').evaluate(canvas => canvas.toDataURL('image/png').split(',')[1]);
      let raster = sharp(Buffer.from(data, 'base64'));
      if (sphere) raster = raster.resize(1536, 1536);
      layers[layer] = (await raster.png({ compressionLevel: 9 }).toBuffer()).toString('base64');
      await page.close();
    }
  } finally { await browser.close(); }
  const image = (id, x, y, diameter) => `<image id="${id}" class="planet" x="${x}%" y="${y}%" width="${diameter}vmin" height="${diameter}vmin" href="data:image/png;base64,${layers[id]}"/>`;
  const svg = motion => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
<title>Arrakis orbit 1984 — crimson twilight</title>
<metadata>${escapeXml(credits)}
Actual shader exports at time zero. Cloud and star layers drift independently. Sphere rotation and procedural cloud evolution are baked.</metadata>
<style>
.planet { transform:translate(-50%,-50%); transform-box:fill-box; }
#arrakis { x:21%; }
@media (max-aspect-ratio:4/5) { #arrakis { x:16%; } }
${motion ? `#clouds { animation:cloud-drift 90s ease-in-out infinite alternate; }
#stars { animation:star-drift 120s linear infinite alternate; }
#moon-large-motion { animation:moon-drift 80s ease-in-out infinite alternate; }
@keyframes cloud-drift { to { transform:translate(5px,-2px); } }
@keyframes star-drift { to { transform:translate(-12px,3px); } }
@keyframes moon-drift { to { transform:translate(2px,-2px); } }` : ''}
</style>
<defs><radialGradient id="vignette"><stop offset="26%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".35"/></radialGradient></defs>
<rect width="100%" height="100%" fill="#000101"/>
<svg width="100%" height="100%" viewBox="0 0 4096 1024" preserveAspectRatio="xMidYMid slice">
<image id="clouds" width="4096" height="1024" href="data:image/png;base64,${layers.clouds}"/>
<image id="stars" width="4096" height="1024" href="data:image/png;base64,${layers.stars}"/>
</svg>
<g id="moon-large-motion">${image('moon-large', 75, 24, 25 / .84)}</g>
${image('moon-small', 58, 47, 8.6 / .84)}
${image('arrakis', 21, 88, 106 / .84)}
<rect width="100%" height="100%" fill="url(#vignette)"/>
</svg>`;
  await mkdir(path.join(rootDirectory, 'svg'), { recursive: true });
  await Promise.all([
    writeFile(path.join(rootDirectory, 'svg/arrakis-orbit-1984.svg'), svg(true)),
    writeFile(path.join(rootDirectory, 'svg/arrakis-orbit-1984-still.svg'), svg(false)),
  ]);
}

function skyMain(layer) {
  return `      void main() {
    vec2 uv = (gl_FragCoord.xy - u_resolution * 0.5) / u_resolution.y;
    vec3 gas = plume(uv, 0.0);
    vec3 color = ${layer === 'clouds' ? 'vec3(0.0015, 0.0020, 0.0050) + gas' : '(stars(uv, 58.0, 0.45) * 0.38 + stars(uv, 25.0, 1.0) * 0.68) * (1.0 - min(0.8, length(gas))) * 1.5'};
    float alpha = ${layer === 'clouds' ? '1.0' : 'clamp(max(color.r, max(color.g, color.b)), 0.0, 1.0)'};
    gl_FragColor = vec4(color / max(alpha, 0.00001), alpha);
  }`;
}

function sphereMain(layer) {
  const kind = layer === 'arrakis' ? '0.0' : layer === 'moon-large' ? '1.0' : '2.0';
  const light = layer === 'arrakis' ? '0.44, 0.74, -0.40' : layer === 'moon-large' ? '-0.68, 0.20, 0.64' : '-0.5, 0.3, 0.8';
  return `      void main() {
    vec2 uv = (gl_FragCoord.xy - u_resolution * 0.5) / u_resolution.y;
    vec3 color = planet(vec3(0.0), uv, vec2(0.0), 0.42, ${kind}, normalize(vec3(${light})));
    float distance = length(uv) / 0.42;
    ${layer === 'arrakis' ? 'color += vec3(0.55, 0.10, 0.055) * exp(-abs(distance - 1.0) * 18.0) * 0.20;' : ''}
    float coverage = 1.0 - smoothstep(1.0 - 1.6 / (u_resolution.y * 0.42), 1.0, distance);
    float alpha = max(coverage, clamp(max(color.r, max(color.g, color.b)), 0.0, 1.0));
    gl_FragColor = vec4(color / max(alpha, 0.00001), alpha);
  }`;
}

function escapeXml(value) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
