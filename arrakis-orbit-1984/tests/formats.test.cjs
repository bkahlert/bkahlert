const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('node:http');
const { chromium, webkit } = require('playwright');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const landmarks = ['arrakis', 'moon-large', 'moon-small', 'clouds', 'stars'];

for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  describe(`${engineName} rendered formats`, () => {
    let browser;
    before(async () => { browser = await engine.launch({ headless: true }); });
    after(async () => { await browser?.close(); });



    for (const variant of ['webgl', 'webcomponent', 'svg']) {
      it(`${variant} renders after copying only its runtime folder`, async () => {
        const runtime = await isolatedRuntime(variant);
        const page = await browser.newPage({ viewport: { width: 960, height: 600 }, reducedMotion: 'reduce' });
        const failures = [];
        const requests = [];
        page.on('pageerror', error => failures.push(error.message));
        page.on('request', request => requests.push(request.url()));
        page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure().errorText}`));
        page.on('response', response => {
          if (response.status() >= 400) failures.push(`${response.url()}: HTTP ${response.status()}`);
        });
        try {
          await page.goto(runtime.url);
          assert.deepEqual(failures, [], 'isolated runtime has no loading errors');
          await rendered(page, `${variant}/index.html`);
          const image = await capture(page, `${engineName}-isolated-${variant}`);
          for (const landmark of landmarks) assertLandmark(image, landmark);
          assert.ok(requests.length > 1, 'loads artwork or a renderer from the copied runtime');
          assert.ok(requests.every(url => url.startsWith(runtime.url)), 'all requests stay within the isolated root');
          assert.deepEqual(failures, [], 'isolated runtime has no rendering or asset errors');
        } finally {
          await page.close();
          await runtime.close();
        }
      });
    }

    it('compares three complete backgrounds in separate side-by-side frames', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      const failures = [];
      page.on('pageerror', error => failures.push(error.message));
      await page.route('https://orbit.test/copied/project/**', async route => {
        const filename = new URL(route.request().url()).pathname.slice('/copied/project/'.length);
        const file = path.join(root, filename);
        const body = await fs.readFile(file);
        await route.fulfill({ contentType: contentType(path.extname(file)), body });
      });
      try {
        await page.goto('https://orbit.test/copied/project/index.html');
        const frames = page.locator('iframe');
        assert.equal(await frames.count(), 3, 'comparison contains all three live variants');
        const expected = ['webgl/index.html', 'webcomponent/index.html', 'svg/index.html'];
        const boxes = [];
        for (let index = 0; index < expected.length; index++) {
          const iframe = frames.nth(index);
          const src = await iframe.getAttribute('src');
          assert.equal(src, expected[index]);
          const handle = await iframe.elementHandle();
          const frame = await handle.contentFrame();
          assert.ok(frame, `${expected[index]} has a browsing context`);
          await rendered(frame, expected[index]);
          const box = await iframe.boundingBox();
          assert.ok(box.width >= 320 && box.height >= 600, 'comparison frames remain large enough to inspect');
          boxes.push(box);
          const image = await capture(iframe, `${engineName}-comparison-${expected[index].split('/')[0]}`);
          for (const landmark of landmarks) assertLandmark(image, landmark);
        }
        for (let index = 1; index < boxes.length; index++) {
          assert.ok(boxes[index].x >= boxes[index - 1].x + boxes[index - 1].width,
            'comparison frames do not overlap horizontally');
          assert.ok(Math.abs(boxes[index].y - boxes[0].y) < 1, 'comparison frames share a row');
        }
        assert.ok(boxes[2].x + boxes[2].width <= 1440, 'all comparison frames fit the desktop viewport');
        await page.setViewportSize({ width: 390, height: 844 });
        const narrow = await frames.evaluateAll(elements => elements.map(element => {
          const { x, y, width } = element.getBoundingClientRect();
          return { x, y, width };
        }));
        assert.ok(narrow.every(box => box.width >= 320), 'narrow comparison keeps inspectable frame widths');
        for (let index = 1; index < narrow.length; index++) {
          assert.ok(narrow[index].x >= narrow[index - 1].x + narrow[index - 1].width,
            'narrow comparison frames do not overlap');
          assert.ok(Math.abs(narrow[index].y - narrow[0].y) < 1, 'narrow comparison keeps a single row');
        }
        const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(scrolls, true, 'narrow comparison scrolls horizontally');
        assert.deepEqual(failures, []);
      } finally {
        await page.close();
      }
    });

    for (const entry of ['webgl/index.html', 'webcomponent/index.html', 'svg/index.html']) {
      const cases = [
        { viewport: { width: 960, height: 600 }, negativeControls: true },
        { viewport: { width: 390, height: 844 }, negativeControls: true },
        { viewport: { width: 844, height: 390 }, negativeControls: false },
        { viewport: { width: 768, height: 1024 }, negativeControls: false },
      ];
      for (const { viewport, negativeControls } of cases) {
        const claim = negativeControls ? 'detects landmarks and rejects omissions' : 'detects landmarks';
        it(`${entry} at ${viewport.width}×${viewport.height} ${claim}`, async () => {
          const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
          const failures = [];
          page.on('pageerror', error => failures.push(error.message));
          let omitted = null;
          await page.route('https://orbit.test/copied/project/**', async route => {
            const filename = new URL(route.request().url()).pathname.slice('/copied/project/'.length);
            const file = path.join(root, filename);
            let body = await fs.readFile(file);
            const extension = path.extname(file);
            if (omitted && ['.svg', '.js'].includes(extension)) {
              body = removeLandmark(body.toString(), omitted, extension);
            }
            await route.fulfill({ contentType: contentType(extension), body });
          });
          const variantName = entry.replaceAll('/', '-').slice(0, -5);
          const prefix = `${engineName}-${variantName}-${viewport.width}x${viewport.height}`;
          try {
            await page.goto(`https://orbit.test/copied/project/${entry}`);
            await rendered(page, entry);
            const image = await capture(page, `${prefix}-complete`);
            for (const landmark of landmarks) assertLandmark(image, landmark);
            const controls = await page.locator('button,a,nav,iframe').count();
            assert.equal(controls, 0, 'background pages have no demo controls');
            for (const landmark of negativeControls ? landmarks : []) {
              omitted = landmark;
              await page.reload();
              await rendered(page, entry);
              const missing = await capture(page, `${prefix}-without-${landmark}`);
              assert.throws(() => assertLandmark(missing, landmark),
                assert.AssertionError, `${landmark} oracle rejects actual artwork removal`);
            }
            assert.deepEqual(failures, []);
          } finally {
            await page.close();
          }
        });
      }
    }
  });
}

async function rendered(page, entry) {
  if (entry === 'svg/index.html') {
    await page.evaluate(async () => {
      const image = new Image();
      image.src = getComputedStyle(document.body).backgroundImage.slice(5, -2);
      await image.decode();
    });
  } else {
    await page.locator('.orbit-1984--ready').waitFor();
  }
}

async function capture(page, name) {
  await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
  const buffer = await page.screenshot({ path: path.join(root, 'test-results', `${name}.png`) });
  return PNG.sync.read(buffer);
}

function assertLandmark(image, landmark) {
  const { width, height, data } = image;
  const unit = Math.min(width, height);
  const centers = {
    arrakis: [(width / height < .8 ? .16 : .21) * width, .88 * height, .53 * unit],
    'moon-large': [.75 * width, .24 * height, .125 * unit],
    'moon-small': [.58 * width, .47 * height, .043 * unit],
  };
  let matching = 0;
  let examined = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
      if (landmark === 'clouds') {
        if (y < height * .30 || y > height * .62 || x < width * .45) continue;
        if (Object.values(centers).some(([cx, cy, radius]) => Math.hypot(x-cx,y-cy) < radius*1.15)) continue;
        examined++;
        if (r > 50 && r > g * 2 && r > b * 1.3) matching++;
      } else if (landmark === 'stars') {
        if (y > height * .25 || x > width * .55 || x < width * .15) continue;
        examined++;
        if (g > 25 && b > 25 && Math.max(r,g,b) > 40) matching++;
      } else {
        const [cx, cy, radius] = centers[landmark];
        if (Math.hypot(x-cx, y-cy) > radius * .98) continue;
        examined++;
        if (landmark === 'arrakis' && r > 50 && r > g * 1.5 && g > b * 1.25) matching++;
        if (landmark.startsWith('moon') && b > 40 && g > r * 1.5 && b > r * 2) matching++;
      }
    }
  }
  const minimum = landmark === 'stars' ? 8 : Math.max(12, examined * (landmark === 'arrakis' ? .012 : landmark === 'clouds' ? .01 : .25));
  assert.ok(matching >= minimum,
    `${landmark} visible: ${matching} matching pixels, requires ${minimum.toFixed(1)} in ${examined} pixels`);
}

function removeLandmark(source, landmark, extension) {
  if (extension === '.svg') return source.replace(new RegExp(`<image id="${landmark}"[^>]*>`), '');
  if (landmark === 'clouds') return source.replace('vec3 gas = plume(uv + cloudDrift, cloudTime);', 'vec3 gas = vec3(0.0);');
  if (landmark === 'stars') return source.replace(/color \+= \(stars\(sky,[^;]+;/g, '');
  if (landmark === 'arrakis') return source.replace(/color = planet\(color, uv, eclipse,[^;]+;/g, '');
  const x = landmark === 'moon-large' ? '0.75' : '0.58';
  return source.replace(new RegExp('color = planet\\(color, uv, position\\(' + x + ',[^;]+;', 'g'), '');
}

function contentType(extension) {
  const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
  };
  return types[extension] || 'application/octet-stream';
}

async function isolatedRuntime(variant) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'arrakis-orbit-1984-runtime-'));
  const directory = path.join(temporary, 'site');
  await fs.cp(path.join(root, variant), directory, { recursive: true });
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(directory, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`);
    if (!filename.startsWith(directory + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await fs.readFile(filename);
      response.writeHead(200, { 'Content-Type': contentType(path.extname(filename)) });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    async close() {
      await new Promise(resolve => server.close(resolve));
      await fs.rm(temporary, { recursive: true, force: true });
    },
  };
}
