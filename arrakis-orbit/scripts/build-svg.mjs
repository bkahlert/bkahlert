import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** Generates a responsive, self-contained Eclipse SVG from the project's local textures. */
export async function buildSvg(rootDirectory) {
  const assets = path.join(rootDirectory, 'src/assets');
  const [arrakis, caladan, moon, credits] = await Promise.all([
    sphere(path.join(assets, 'arrakis.jpg'), 768, 'arrakis', [-0.74, 0.40, -0.35]),
    sphere(path.join(assets, 'caladan-clouds.jpg'), 192, 'caladan', [-0.65, 0.40, 0.25]),
    sphere(path.join(assets, 'moon.jpg'), 128, 'moon', [-0.65, 0.48, 0.65]),
    readFile(path.join(assets, 'CREDITS.txt'), 'utf8'),
  ]);
  let seed = 7341;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stars = Array.from({ length: 560 }, (_, index) => {
    const x = (random() * 100).toFixed(3);
    const y = (random() * 100).toFixed(3);
    const radius = (0.3 + random() ** 5 * 1.1).toFixed(2);
    const color = index % 3 ? '#93aec6' : '#dfbb91';
    const opacity = (0.25 + random() * 0.65).toFixed(2);
    return `<circle cx="${x}%" cy="${y}%" r="${radius}" fill="${color}" opacity="${opacity}"/>`;
  }).join('');
  const svg = motion => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
<title>Arrakis orbit — Eclipse</title>
<metadata>${escapeXml(credits)}
Generated from the local texture artwork. Sphere lighting is baked; CSS animates drift and starlight.</metadata>
<style>
.planet { transform-box:fill-box; transform:translate(-50%,-50%); }
${motion ? `#arrakis-motion { animation:orbit-drift 37s ease-in-out infinite alternate; }
#caladan-motion { animation:orbit-drift 43s ease-in-out infinite alternate-reverse; }
#stars { animation:starlight 7s ease-in-out infinite alternate; }
@keyframes orbit-drift { from { transform:translate(-2px,0); } to { transform:translate(3px,2px); } }
@keyframes starlight { from { opacity:.65; } to { opacity:1; } }` : ''}
</style>
<defs>
<radialGradient id="nebula">
<stop offset="0" stop-color="#19222b" stop-opacity=".65"/><stop offset="1" stop-color="#05070c" stop-opacity="0"/></radialGradient>
<radialGradient id="sun">
<stop offset="0" stop-color="#733116" stop-opacity=".38"/><stop offset="1" stop-color="#05070c" stop-opacity="0"/></radialGradient>
</defs>
<rect width="100%" height="100%" fill="#030509"/>
<ellipse cx="53%" cy="44%" rx="68%" ry="33%" fill="url(#nebula)"/>
<ellipse cx="17%" cy="61%" rx="30vmin" ry="30vmin" fill="url(#sun)"/>
<g id="stars">${stars}</g>
<g id="caladan-motion">
<image id="caladan" class="planet" x="86%" y="20%" width="8.6vmin" height="8.6vmin"
 href="data:image/png;base64,${caladan}"/></g>
<g id="arrakis-motion">
<image id="arrakis" class="planet" x="20%" y="84%" width="106vmin" height="106vmin"
 href="data:image/png;base64,${arrakis}"/></g>
<image id="moon" class="planet" x="64%" y="50%" width="4.6vmin" height="4.6vmin" href="data:image/png;base64,${moon}"/>
</svg>`;
  await mkdir(path.join(rootDirectory, 'svg'), { recursive: true });
  await Promise.all([
    writeFile(path.join(rootDirectory, 'svg/arrakis-orbit.svg'), svg(true)),
    writeFile(path.join(rootDirectory, 'svg/arrakis-orbit-still.svg'), svg(false)),
  ]);
}

async function sphere(filename, size, kind, lightDirection) {
  const { data: texture, info } = await sharp(filename).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.alloc(size * size * 4);
  const magnitude = Math.hypot(...lightDirection);
  const light = lightDirection.map(value => value / magnitude);
  const ocean = kind === 'caladan';
  const tilt = ocean ? -0.35 : 0.24;
  const angle = ocean ? 2.4 : 0.7;
  const atmosphere = kind === 'arrakis' ? [0.85, 0.43, 0.15] : ocean ? [0.19, 0.40, 0.60] : [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = 1 - (y + 0.5) / size * 2;
      const distance = Math.hypot(nx, ny);
      if (distance >= 1) continue;
      const nz = Math.sqrt(1 - distance * distance);
      const sx = Math.cos(tilt) * nx + Math.sin(tilt) * ny;
      const sy = -Math.sin(tilt) * nx + Math.cos(tilt) * ny;
      const rx = Math.cos(angle) * sx + Math.sin(angle) * nz;
      const rz = -Math.sin(angle) * sx + Math.cos(angle) * nz;
      const u = Math.atan2(rz, rx) / (2 * Math.PI) + 0.5;
      const v = Math.asin(sy) / Math.PI + 0.5;
      const tx = Math.floor(u * (info.width - 1));
      const ty = Math.floor((1 - v) * (info.height - 1));
      const source = (ty * info.width + tx) * info.channels;
      const daylight = Math.max(nx * light[0] + ny * light[1] + nz * light[2], 0);
      const target = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const sample = texture[source + c] / 255;
        let shaded;
        if (ocean) {
          const cloud = texture[source] / 255;
          const water = [0.003, 0.018, 0.042][c] * (1 - cloud * 0.65);
          const cloudCover = cloud ** 1.15 * 0.92;
          shaded = (water * (1 - cloudCover) + [0.22, 0.30, 0.38][c] * cloudCover) * (0.0006 + daylight * 0.58);
        } else if (kind === 'arrakis') {
          shaded = sample ** 2.2 * (0.00035 + [1.15, 0.98, 0.72][c] * daylight);
        } else {
          shaded = (sample * [0.76, 0.72, 0.66][c]) ** 2.2 * (0.0003 + daylight * 0.7);
        }
        shaded += atmosphere[c] ** 2.2 * (1 - nz) ** 4 * daylight ** 0.7 * (ocean ? 0.14 : 0.28);
        pixels[target + c] = Math.min(255, Math.round(shaded ** (1 / 2.2) * 255));
      }
      pixels[target + 3] = Math.round(Math.min(1, (1 - distance) * size / 1.5) * 255);
    }
  }
  const png = await sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  return png.toString('base64');
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
