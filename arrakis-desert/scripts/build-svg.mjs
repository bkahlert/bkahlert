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
  { width: 1920, height: 1200 }, { width: 2100, height: 1000 }, { width: 2400, height: 750 },
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
const styles = [];
const clouds = [[], []];
const stills = [[], []];
for (let i = 0; i < 208; i++) {
  const near = i >= 144;
  const phase = ((near ? i - 144 : i) + random(i, 3) * 0.8) / (near ? 64 : 144);
  const variation = (phase * 17.31) % 1;
  const speed = (5 + variation * 6) * (near ? 0.35 : 1);
  const span = near ? 5.85 : 42;
  const nearest = near ? 0.15 : 0.35;
  const duration = span / speed;
  const x = (random(i, 1) - 0.5) * (near ? 3 : 30);
  const y = (random(i, 2) - 0.5) * (near ? 2.4 : 20);
  const size = near ? 0.6 + random(i, 4) * 0.8 : 3 + random(i, 4) * 3.5;
  const keys = [];
  let stillState;
  for (let frame = 0; frame <= 80; frame++) {
    const progress = frame / 80;
    const elapsed = progress * duration;
    const travel = progress + 0.055 * Math.sin(progress * Math.PI * 2);
    const depth = nearest + span * (1 - travel);
    const curl = elapsed * (0.4 + variation * 0.35) + phase * 19;
    const radius = (1.5 + variation * 2) * (near ? 0.16 : 1);
    const cx = 1000 * (x + Math.sin(curl) * radius) / depth;
    const cy = -1000 * (y + Math.cos(curl * 0.83) * radius) / depth;
    const scale = 1000 * size / depth;
    const angle = -(phase * Math.PI * 2 + elapsed * (0.12 + variation * 0.24)
      + 0.35 * Math.sin(elapsed * 0.9 + phase * 11)) * 180 / Math.PI;
    const opacity = smoothstep(nearest, near ? 0.4 : 1.5, depth)
      * (1 - smoothstep(near ? 4.5 : 34, nearest + span, depth)) * (near ? 0.33 : 0.52);
    const state = `transform:translate(${fixed(cx)}px,${fixed(cy)}px) `
      + `rotate(${fixed(angle)}deg) scale(${fixed(scale)});opacity:${fixed(opacity)}`;
    keys.push(`${fixed(progress * 100)}%{${state}}`);
    if (frame === Math.round((1 - phase) * 80)) stillState = state;
  }
  styles.push(`@keyframes cloud${i}{${keys.join('')}}`);
  const animation = `cloud${i} ${fixed(duration)}s linear -${fixed((1 - phase) * duration)}s infinite`;
  clouds[near ? 1 : 0].push(`<g class="cloud" style="animation:${animation}"><use href="#dust"/></g>`);
  stills[near ? 1 : 0].push(`<g style="${stillState}"><use href="#dust"/></g>`);
}

function composeSvg(animated) {
  const particles = animated ? clouds : stills;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
<title>Arrakis — desert storm</title>
<desc>Self-contained SVG: rendered landscape with ${animated ? 'animated' : 'still'} dust.
Moon texture by Solar System Scope, CC BY 4.0, https://www.solarsystemscope.com/textures/.
Texture converted to grayscale, resized, and rendered onto two fictional moons.
License: https://creativecommons.org/licenses/by/4.0/. Original terrain and dust from scene.js.</desc>
<style>
.frame{display:none}.frame-0{display:inline}
@media(min-aspect-ratio:3/4){.frame-0{display:none}.frame-1{display:inline}}
@media(min-aspect-ratio:6/5){.frame-1{display:none}.frame-2{display:inline}}
@media(min-aspect-ratio:9/5){.frame-2{display:none}.frame-3{display:inline}}
@media(min-aspect-ratio:12/5){.frame-3{display:none}.frame-4{display:inline}}
${animated ? styles.join('\n') : ''}
</style>
<defs>
<image id="dust" x="-1" y="-1" width="2" height="2" href="${sprite}"/>
<g id="far-storm">${particles[0].join('\n')}</g>
<g id="near-storm">${particles[1].join('\n')}</g>
${compositions.map((composition, index) => {
  const width = composition.width / composition.height * 1000;
  return `<mask id="ground-${index}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="1000">
<image width="${width}" height="1000" href="${composition.mask}"/>
</mask>`;
}).join('\n')}
</defs>
${compositions.map((composition, index) => {
  const width = composition.width / composition.height * 1000;
  return `<svg class="frame frame-${index}" width="100%" height="100%" viewBox="0 0 ${width} 1000" preserveAspectRatio="xMidYMid slice">
<image width="${width}" height="1000" href="${composition.landscape}"/>
<g mask="url(#ground-${index})"><g transform="translate(${width / 2} 490)"><use href="#far-storm"/></g></g>
<g transform="translate(${width / 2} 490)"><use href="#near-storm"/></g>
</svg>`;
}).join('\n')}
</svg>
`;
}
const svg = composeSvg(true);
await writeFile(new URL('svg/arrakis-desert.svg', directory), svg);
await writeFile(new URL('svg/arrakis-desert-still.svg', directory), composeSvg(false));
const sizeMiB = (Buffer.byteLength(svg) / 1024 / 1024).toFixed(2);
console.log(`Created arrakis-desert.svg: ${sizeMiB} MiB; 208 dust clouds; five responsive compositions.`);

for (const variant of ['webgl', 'webcomponent']) {
  await copyFile(new URL('svg/arrakis-desert-still.svg', directory), new URL(`${variant}/arrakis-desert-still.svg`, directory));
}

const files = ['src/scene.js', 'src/scene.css', 'src/component.js', 'src/assets/moon.jpg', 'src/assets/CREDITS.txt',
  'scripts/build.mjs', 'scripts/build-svg.mjs', 'package.json', 'package-lock.json',
  'webgl/scene.js', 'webgl/scene.css', 'webgl/assets/moon.jpg', 'webgl/assets/CREDITS.txt', 'webgl/arrakis-desert-still.svg',
  'webcomponent/arrakis-desert.js', 'webcomponent/assets/moon.jpg', 'webcomponent/assets/CREDITS.txt',
  'webcomponent/arrakis-desert-still.svg', 'svg/arrakis-desert.svg', 'svg/arrakis-desert-still.svg'];
const sha256 = {};
for (const file of files) {
  sha256[file] = createHash('sha256').update(await readFile(new URL(file, directory))).digest('hex');
}
await writeFile(new URL('provenance/build-manifest.json', directory), JSON.stringify({ sha256 }, null, 2) + '\n');
