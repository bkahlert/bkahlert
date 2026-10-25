import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const directory = new URL('../', import.meta.url);
const browser = await chromium.launch();
let sprite;
const compositions = [
  { width: 900, height: 1600 }, { width: 900, height: 1200 },
  { width: 1200, height: 1200 }, { width: 1440, height: 1200 },
  { width: 1920, height: 1200 },
  { width: 2100, height: 1000 }, { width: 2400, height: 750 },
];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => console.error(error.message));
  await page.route('http://arrakis.local/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><title>Export</title><body>
        <canvas></canvas><script type="module">
        import { createRenderer } from './scene.js';
        const image = new Image();
        image.src = './assets/moon.jpg';
        await image.decode();
        const canvas = document.querySelector('canvas');
        const renderer = createRenderer(canvas, canvas.getContext('webgl', {alpha:false}), [image]);
        globalThis.exportArrakis = (width, height) => renderer.exportAssets(width, height);
        </script></body></html>` });
    } else if (pathname === '/scene.js') {
      await route.fulfill({
        contentType: 'application/javascript', path: fileURLToPath(new URL('src/scene.js', directory)),
      });
    } else if (pathname === '/assets/moon.jpg') {
      await route.fulfill({ contentType: 'image/jpeg', path: fileURLToPath(new URL('src/assets/moon.jpg', directory)) });
    } else {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  await page.goto('http://arrakis.local/');
  await page.waitForFunction(() => typeof globalThis.exportArrakis === 'function');
  for (const composition of compositions) {
    const artwork = await page.evaluate(({width, height}) => globalThis.exportArrakis(width, height), composition);
    Object.assign(composition, artwork);
  }
  const spriteBytes = Buffer.from(compositions[0].sprite.split(',')[1], 'base64');
  const compressed = await sharp(spriteBytes).resize(512, 512).webp({ quality: 90, alphaQuality: 95 }).toBuffer();
  sprite = `data:image/webp;base64,${compressed.toString('base64')}`;
} finally {
  await browser.close();
}

const random = (x, y) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const smoothstep = (low, high, value) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
const fixed = value => Number(value.toFixed(3));
const depths = [0.5, 42];
const farCloudCount = 32;
const nearCloudCount = 16;
const sampleCount = 24;
const styles = [];
const clouds = depths.map(() => [[], []]);
const stills = depths.map(() => [[], []]);
for (let i = 0; i < farCloudCount + nearCloudCount; i++) {
  const near = i >= farCloudCount;
  const phase = ((near ? i - farCloudCount : i) + random(i, 3) * 0.8) / (near ? nearCloudCount : farCloudCount);
  const variation = (phase * 17.31) % 1;
  const speed = (2 + variation * 3) * (near ? 0.35 : 1);
  const span = near ? 5.85 : 42;
  const nearest = near ? 0.15 : 0.35;
  const duration = span / speed;
  const x = (random(i, 1) - 0.5) * (near ? 3 : 30);
  const y = (random(i, 2) - 0.5) * (near ? 2.4 : 20);
  const size = near ? 0.6 + random(i, 4) * 0.8 : 3 + random(i, 4) * 3.5;
  const states = depths.map(() => []);
  for (let frame = 0; frame <= sampleCount; frame++) {
    const progress = frame / sampleCount;
    const elapsed = progress * duration;
    const travel = progress + 0.055 * Math.sin(progress * Math.PI * 2);
    const depth = nearest + span * (1 - travel);
    const curl = elapsed * (0.4 + variation * 0.35) + phase * 19;
    const radius = (1.5 + variation * 2) * (near ? 0.16 : 1);
    const cx = 1000 * (x + Math.sin(curl) * radius) / depth;
    const verticalScale = near ? 750 : 425;
    const cy = (near ? 500 : 750) - verticalScale * (y + Math.cos(curl * 0.83) * radius) / depth;
    const scaleX = 1000 * size / depth;
    const scaleY = verticalScale * size / depth;
    const angle = -(phase * Math.PI * 2 + elapsed * (0.12 + variation * 0.24)
      + 0.35 * Math.sin(elapsed * 0.9 + phase * 11)) * 180 / Math.PI;
    const opacity = smoothstep(nearest, near ? 0.4 : 1.5, depth)
      * (1 - smoothstep(near ? 4.5 : 34, nearest + span, depth)) * (near ? 0.16 : 0.32);
    const nearestMask = depths.reduce((best, candidate) =>
      Math.abs(candidate - depth) < Math.abs(best - depth) ? candidate : best);
    for (const [index, maskDepth] of depths.entries()) {
      const state = `transform:translate(${fixed(cx)}px,${fixed(cy)}px) `
        + `scale(${fixed(scaleX)},${fixed(scaleY)}) rotate(${fixed(angle)}deg);`
        + `opacity:${fixed(maskDepth === nearestMask ? opacity : 0)}`;
      states[index].push(`${fixed(progress * 100)}%{${state}}`);
      if (frame === Math.round((1 - phase) * sampleCount) && maskDepth === nearestMask) {
        stills[index][near ? 1 : 0].push(`<g style="${state}"><use href="#dust"/></g>`);
      }
    }
  }
  for (const [index] of depths.entries()) {
    styles.push(`@keyframes cloud${i}-${index}{${states[index].join('')}}`);
    const animation = `cloud${i}-${index} ${fixed(duration)}s linear -${fixed((1 - phase) * duration)}s infinite`;
    clouds[index][near ? 1 : 0].push(`<g style="animation:${animation}"><use href="#dust"/></g>`);
  }
}

function composeSvg(animated) {
  const particles = animated ? clouds : stills;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
<title>Arrakis 1984 — desert storm</title>
<desc>Self-contained crimson landscape with ${animated ? 'animated' : 'still'} dust.
Moon texture by Solar System Scope, CC BY 4.0, https://www.solarsystemscope.com/textures/.
Texture converted to grayscale, resized, and rendered onto two fictional moons.
License: https://creativecommons.org/licenses/by/4.0/. Original terrain and dust from scene.js.</desc>
<style>
.frame{display:none}.frame-0{display:inline}
@media(min-aspect-ratio:3/4){.frame-0{display:none}.frame-1{display:inline}}
@media(min-aspect-ratio:7/8){.frame-1{display:none}.frame-2{display:inline}}
@media(min-aspect-ratio:1/1){.frame-2{display:none}.frame-3{display:inline}}
@media(min-aspect-ratio:6/5){.frame-3{display:none}.frame-4{display:inline}}
@media(min-aspect-ratio:9/5){.frame-4{display:none}.frame-5{display:inline}}
@media(min-aspect-ratio:12/5){.frame-5{display:none}.frame-6{display:inline}}
${animated ? styles.join('\n') : ''}
</style>
<defs>
<image id="dust" x="-1" y="-1" width="2" height="2" href="${sprite}"/>
<linearGradient id="far-altitude" x2="0" y2="1">
<stop offset="0" stop-color="black"/><stop offset="0.18" stop-color="black"/>
<stop offset="0.68" stop-color="white"/><stop offset="1" stop-color="white"/>
</linearGradient>
<linearGradient id="near-altitude" x2="0" y2="1">
<stop offset="0" stop-color="#727272"/><stop offset="0.28" stop-color="white"/>
<stop offset="1" stop-color="white"/>
</linearGradient>
${particles.map((layers, index) => layers.map((layer, near) =>
  `<g id="storm-${index}-${near}">${layer.join('\n')}</g>`).join('\n')).join('\n')}
${compositions.map((composition, index) => {
  const width = composition.width / composition.height * 1000;
  return depths.map((depth, depthIndex) => `<mask id="ground-${index}-${depthIndex}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="1000">
<image width="${width}" height="1000" href="${composition.masks[depth]}"/>
</mask>`).join('\n') + [0, 1].map(near => `<mask id="altitude-${index}-${near}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="1000">
<rect width="${width}" height="1000" fill="url(#${near ? 'near' : 'far'}-altitude)"/>
</mask>`).join('\n');
}).join('\n')}
</defs>
${compositions.map((composition, index) => {
  const width = composition.width / composition.height * 1000;
  return `<svg class="frame frame-${index}" width="100%" height="100%" viewBox="0 0 ${width} 1000" preserveAspectRatio="xMidYMid slice">
<image width="${width}" height="1000" href="${composition.landscape}"/>
${[0, 1].map(near => `<g mask="url(#altitude-${index}-${near})">${depths.map((_, depthIndex) =>
    `<g mask="url(#ground-${index}-${depthIndex})"><g transform="translate(${width / 2} 0)"><use href="#storm-${depthIndex}-${near}"/></g></g>`).join('\n')}</g>`).join('\n')}
</svg>`;
}).join('\n')}
</svg>
`;
}
const svg = composeSvg(true);
await writeFile(new URL('svg/arrakis-desert-1984.svg', directory), svg);
await writeFile(new URL('svg/arrakis-desert-1984-still.svg', directory), composeSvg(false));
console.log(`Created arrakis-desert-1984.svg: ${(Buffer.byteLength(svg) / 1024 / 1024).toFixed(2)} MiB; ${farCloudCount + nearCloudCount} dust clouds; ${depths.length} depth masks; ${sampleCount} motion intervals; ${compositions.length} compositions.`);
for (const variant of ['webgl', 'webcomponent']) {
  await copyFile(new URL('svg/arrakis-desert-1984-still.svg', directory), new URL(`${variant}/arrakis-desert-1984-still.svg`, directory));
}
const files = ['src/scene.js', 'src/scene.css', 'src/component.js', 'src/assets/moon.jpg', 'src/assets/CREDITS.txt',
  'scripts/build.mjs', 'scripts/build-svg.mjs', 'scripts/serve.mjs', 'package.json', 'package-lock.json',
  'index.html', 'webgl/index.html', 'webcomponent/index.html', 'svg/index.html',
  'webgl/scene.js', 'webgl/scene.css', 'webgl/assets/moon.jpg', 'webgl/assets/CREDITS.txt', 'webgl/arrakis-desert-1984-still.svg',
  'webcomponent/arrakis-desert-1984.js', 'webcomponent/assets/moon.jpg', 'webcomponent/assets/CREDITS.txt',
  'webcomponent/arrakis-desert-1984-still.svg', 'svg/arrakis-desert-1984.svg', 'svg/arrakis-desert-1984-still.svg'];
const sha256 = {};
for (const file of files) sha256[file] = createHash('sha256').update(await readFile(new URL(file, directory))).digest('hex');
await writeFile(new URL('build-manifest.json', directory), JSON.stringify({ sha256 }, null, 2) + '\n');
