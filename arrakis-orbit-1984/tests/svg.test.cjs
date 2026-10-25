const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');

describe('SVG export', () => {
  it('generates a self-contained 1984 twilight scene from local artwork', async () => {
    const generator = path.join(root, 'scripts/build-svg.mjs');
    const available = await fs.access(generator).then(() => true, () => false);
    assert.equal(available, true, 'SVG generator exists');
    const svg = await fs.readFile(path.join(root, 'svg/arrakis-orbit-1984.svg'), 'utf8');
    for (const landmark of ['arrakis', 'moon-large', 'moon-small', 'clouds', 'stars']) {
      assert.ok(svg.includes(`id="${landmark}"`), landmark);
    }
    assert.doesNotMatch(svg, /prefers-reduced-motion/);
    const page = await fs.readFile(path.join(root, 'svg/index.html'), 'utf8');
    assert.match(page, /prefers-reduced-motion/);
    assert.ok(page.includes('arrakis-orbit-1984-still.svg'));
    assert.match(svg, /@keyframes/);
    assert.match(svg, /data:image\/png;base64,/);
    assert.doesNotMatch(svg, /(?:href|src)="(?:https?:|\/|\.\.)/);
    assert.doesNotMatch(svg, /<script/);
    assert.match(svg, /<metadata>/);
    const still = await fs.readFile(path.join(root, 'svg/arrakis-orbit-1984-still.svg'), 'utf8');
    assert.doesNotMatch(still, /@keyframes/);
  });

  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    for (const viewport of [{ width: 960, height: 600 }, { width: 390, height: 844 }]) {
      it(`${name} CSS SVG at ${viewport.width}×${viewport.height} animates and supports reduced motion`, async () => {
        const browser = await engine.launch({ headless: true });
        try {
          const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' });
          const requests = [];
          page.on('request', request => requests.push(request.url()));
          await page.route('https://orbit.test/**', async route => {
            const url = new URL(route.request().url());
            const body = await fs.readFile(path.join(root, url.pathname));
            const type = url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
            await route.fulfill({ contentType: type, body });
          });
          await page.goto('https://orbit.test/svg/index.html');
          await loadedBackground(page);
          const first = await page.screenshot();
          await page.waitForTimeout(1200);
          const animated = await page.screenshot();
          assert.ok(changedPixels(first, animated) > 100, 'CSS SVG animation changes visible pixels');
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await loadedBackground(page);
          const still = await page.screenshot();
          await page.waitForTimeout(1200);
          const stillLater = await page.screenshot();
          assert.equal(changedPixels(still, stillLater), 0, 'reduced motion freezes the CSS SVG');
          assert.deepEqual([...new Set(requests)], [
            'https://orbit.test/svg/index.html',
            'https://orbit.test/svg/arrakis-orbit-1984.svg',
            'https://orbit.test/svg/arrakis-orbit-1984-still.svg',
          ]);
          await page.close();
        } finally {
          await browser.close();
        }
      });
    }
  }

});


function changedPixels(first, second) {
  const a = PNG.sync.read(first);
  const b = PNG.sync.read(second);
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let changed = 0;
  for (let index = 0; index < a.data.length; index += 4) {
    if ([0, 1, 2].some(channel => a.data[index + channel] !== b.data[index + channel])) changed++;
  }
  return changed;
}

async function loadedBackground(page) {
  await page.evaluate(async () => {
    const image = new Image();
    image.src = getComputedStyle(document.body).backgroundImage.slice(5, -2);
    await image.decode();
  });
}
