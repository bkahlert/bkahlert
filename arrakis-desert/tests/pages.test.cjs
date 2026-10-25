const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const { PNG } = require('pngjs');

for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  describe(`${engineName} real pages`, () => {
    let browser, server, url;
    before(async () => {
      const { serve } = await import('../scripts/serve.mjs');
      server = await serve();
      url = `http://127.0.0.1:${server.address().port}`;
      browser = await engine.launch();
      fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
    });
    after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

    for (const variant of ['webgl', 'webcomponent', 'svg']) {
      it(`renders the ${variant} directory copied without its parent project`, async () => {
        const os = require('node:os');
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `arrakis-${variant}-`));
        fs.cpSync(path.join(__dirname, '..', variant), temporary, { recursive: true });
        const isolated = await serveDirectory(temporary);
        const origin = `http://127.0.0.1:${isolated.address().port}`;
        const page = await browser.newPage({ viewport: { width: 960, height: 600 }, reducedMotion: 'reduce' });
        const failures = [], requests = [];
        page.on('pageerror', error => failures.push(error.message));
        page.on('requestfailed', request => failures.push(request.url()));
        page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
        page.on('request', request => requests.push(request.url()));
        try {
          await page.goto(origin);
          assert.deepEqual(failures, [], 'the standalone variant resolves all local resources');
          await ready(page, `${variant}/index.html`);
          const screenshot = await page.screenshot({
            path: path.join(__dirname, `../test-results/${engineName}-isolated-${variant}.png`),
          });
          const png = PNG.sync.read(screenshot);
          assertMoons(png, 'landscape', variant === 'svg');
          assertTerrain(png);
          assert.deepEqual(failures, []);
          assert.ok(requests.every(request => new URL(request).origin === origin));
          assert.ok(requests.every(request => fs.existsSync(path.join(temporary, new URL(request).pathname))));
        } finally {
          await page.close();
          await new Promise(resolve => isolated.close(resolve));
          fs.rmSync(temporary, { recursive: true, force: true });
        }
      });
    }

    it('shows three labeled previews side by side with visible moons and dunes', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await page.goto(url);
      const previews = page.locator('iframe');
      assert.equal(await previews.count(), 3);
      assert.deepEqual(await page.locator('h1').allTextContents(), ['WebGL', 'Web component', 'SVG']);
      const entries = ['webgl/index.html', 'webcomponent/index.html', 'svg/index.html'];
      const boxes = [];
      for (const [index, entry] of entries.entries()) {
        const preview = previews.nth(index);
        const frame = await (await preview.elementHandle()).contentFrame();
        await ready(frame, entry);
        assert.equal(new URL(frame.url()).pathname, `/${entry}`);
        assert.ok((await preview.getAttribute('title')).trim().length > 0);
        const box = await preview.boundingBox();
        boxes.push(box);
        const screenshot = await preview.screenshot({
          path: path.join(__dirname, `../test-results/${engineName}-comparison-${index}.png`),
        });
        const png = PNG.sync.read(screenshot);
        assertMoons(png, 'comparison', entry === 'svg/index.html');
        assertTerrain(png);
      }
      assert.ok(boxes.every(box => box.width >= 320 && box.height >= 360));
      assert.equal(boxes[0].y, boxes[1].y);
      assert.equal(boxes[1].y, boxes[2].y);
      assert.ok(boxes[0].x + boxes[0].width <= boxes[1].x);
      assert.ok(boxes[1].x + boxes[1].width <= boxes[2].x);
      await page.setViewportSize({ width: 390, height: 844 });
      const narrow = await previews.evaluateAll(elements => elements.map(element => {
        const { x, y, width } = element.getBoundingClientRect();
        return { x, y, width };
      }));
      assert.equal(narrow[0].y, narrow[2].y);
      assert.ok(narrow[0].x + narrow[0].width <= narrow[1].x);
      assert.ok(narrow[1].x + narrow[1].width <= narrow[2].x);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
      await page.close();
    });

    for (const [shape, viewport] of Object.entries({ landscape: { width: 960, height: 600 }, portrait: { width: 390, height: 844 },
      phoneLandscape: { width: 844, height: 390 }, tablet: { width: 768, height: 1024 },
      square: { width: 800, height: 800 }, nearSquare: { width: 1130, height: 1000 },
      ultrawide: { width: 1280, height: 360 } })) {
      for (const entry of ['webgl/index.html', 'webcomponent/index.html', 'svg/index.html']) {
        it(`${entry} shows each crescent and dunes in ${shape}`, async () => {
          const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
          const failures = [];
          page.on('pageerror', error => failures.push(error.message));
          await page.goto(`${url}/${entry}`);
          await ready(page, entry);
          const screenshot = await page.screenshot({ path: path.join(__dirname, `../test-results/${engineName}-${shape}-${entry.replaceAll('/', '-')}.png`) });
          const png = PNG.sync.read(screenshot);
          assertMoons(png, shape, entry === 'svg/index.html');
          assertTerrain(png);
          const layout = await page.evaluate(() => ({
            text: document.body.innerText.trim(),
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
            controls: document.querySelectorAll('a,button,nav,input,iframe').length,
          }));
          assert.equal(layout.text, '');
          assert.equal(layout.controls, 0);
          assert.equal(layout.width, viewport.width);
          assert.equal(layout.height, viewport.height);
          assert.deepEqual(failures, []);
          await page.close();
        });
      }

      for (const moon of ['large', 'small'].filter(() => ['landscape','portrait'].includes(shape))) {
        it(`rejects a removed ${moon} moon in ${shape} across all formats`, async () => {
          const source = fs.readFileSync(path.join(__dirname, '../src/scene.js'), 'utf8');
          const call = moon === 'large'
            ? 'color=moon(color,uv,largeCenter,largeRadius,0.68);'
            : 'color=moon(color,uv,vec2(-0.39*aspect,0.35),0.13*unit,0.11);';
          assert.ok(source.includes(call));
          const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
          await page.route('**/scene.js', route => route.fulfill({ contentType: 'text/javascript', body: source.replace(call, '') }));
          await page.route('**/arrakis-desert.js', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, '../webcomponent/arrakis-desert.js'), 'utf8').replace(call, '') }));
          for (const entry of ['webgl/index.html', 'webcomponent/index.html']) {
            await page.goto(`${url}/${entry}`);
            await ready(page, entry);
            const screenshot = await page.screenshot({ path: path.join(__dirname, `../test-results/${engineName}-${shape}-${entry.replaceAll('/', '-')}-without-${moon}.png`) });
            const png = PNG.sync.read(screenshot);
            assert.throws(() => assertMoon(png, shape, moon), /crescent contrast/u);
            assertMoon(png, shape, moon === 'large' ? 'small' : 'large');
          }
          const artwork = await page.evaluate(async () => {
            const { createRenderer } = await import('../webgl/scene.js');
            const image = new Image();
            image.src = '../webgl/assets/moon.jpg';
            await image.decode();
            const canvas = document.createElement('canvas');
            const renderer = createRenderer(canvas, canvas.getContext('webgl', { alpha: false }), [image]);
            const frames = [[900,1600],[900,1200],[1200,1200],[1440,1200],[1920,1200],[2100,1000],[2400,750]];
            const artwork = frames.map(([width,height]) => renderer.exportAssets(width,height).landscape);
            renderer.dispose();
            return artwork;
          });
          await page.route('**/arrakis-desert-still.svg', route => {
            let index = 0;
            const svg = fs.readFileSync(path.join(__dirname, '../svg/arrakis-desert-still.svg'), 'utf8');
            const negative = svg.replace(/data:image\/jpeg;base64,[^"\s]+/gu, () => artwork[index++]);
            return route.fulfill({ contentType: 'image/svg+xml', body: negative });
          });
          await page.goto(`${url}/svg/index.html`);
          await ready(page, 'svg/index.html');
          const screenshot = await page.screenshot({ path: path.join(__dirname, `../test-results/${engineName}-${shape}-svg-without-${moon}.png`) });
          const png = PNG.sync.read(screenshot);
          assert.throws(() => assertMoon(png, shape, moon, true), /crescent contrast/u);
          assertMoon(png, shape, moon === 'large' ? 'small' : 'large', true);
          await page.close();
        });
      }
    }

    it('sizes and isolates multiple components, then reconnects with one canvas', async () => {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      await page.goto(`${url}/webcomponent/index.html`);
      await ready(page, 'webcomponent/index.html');
      const result = await page.evaluate(async () => {
        document.body.innerHTML = '<div style="width:320px;height:240px"><arrakis-desert style="width:100%;height:100%"></arrakis-desert></div><div style="width:240px;height:400px"><arrakis-desert style="width:100%;height:100%"></arrakis-desert></div>';
        const [first, second] = document.querySelectorAll('arrakis-desert');
        await Promise.all([first.ready, second.ready]);
        const bounds = element => { const r = element.shadowRoot.querySelector('canvas').getBoundingClientRect(); return [r.width,r.height]; };
        const initial = [bounds(first), bounds(second)];
        first.parentElement.style.width = '360px';
        await new Promise(resolve => new ResizeObserver((_, observer) => { observer.disconnect(); resolve(); }).observe(first));
        const resized = bounds(first);
        const parent = first.parentElement;
        first.remove();
        const disconnected = first.shadowRoot.querySelectorAll('canvas').length;
        parent.append(first);
        await first.ready;
        return { initial, resized, disconnected, canvases: [first.shadowRoot.querySelectorAll('canvas').length, second.shadowRoot.querySelectorAll('canvas').length], shadows: first.shadowRoot !== second.shadowRoot };
      });
      assert.deepEqual(result.initial, [[320,240],[240,400]]);
      assert.deepEqual(result.resized, [360,240]);
      assert.equal(result.disconnected, 0);
      assert.deepEqual(result.canvases, [1,1]);
      assert.equal(result.shadows, true);
      await page.close();
    });

    it('loads from a relocated project and resolves component assets beside its module', async () => {
      const os = require('node:os');
      const { pathToFileURL } = require('node:url');
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'arrakis-desert-'));
      const folder = path.join(temporary, 'nested', 'background');
      fs.mkdirSync(folder, { recursive: true });
      const files = ['arrakis-desert.js', 'arrakis-desert-still.svg', 'assets/moon.jpg'];
      for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(folder,file)), { recursive: true });
        fs.copyFileSync(path.join(__dirname,'../webcomponent',file), path.join(folder,file));
      }
      fs.mkdirSync(path.join(temporary, 'scripts'));
      fs.copyFileSync(path.join(__dirname,'../scripts/serve.mjs'), path.join(temporary,'scripts/serve.mjs'));
      fs.writeFileSync(path.join(temporary,'index.html'), `<!doctype html><html lang="en"><title>Embedding host</title>
        <style>html,body{margin:0;width:100%;height:100%}arrakis-desert{width:100%;height:100%}</style>
        <script type="module" src="./nested/background/arrakis-desert.js"></script>
        <body><arrakis-desert></arrakis-desert></body></html>`);
      const { serve } = await import(pathToFileURL(path.join(temporary,'scripts/serve.mjs')).href);
      const relocated = await serve();
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      const requests = [];
      page.on('request', request => requests.push(new URL(request.url()).pathname));
      try {
        await page.goto(`http://127.0.0.1:${relocated.address().port}/`);
        await ready(page, 'webcomponent/index.html');
        assert.ok(requests.includes('/nested/background/assets/moon.jpg'));
        const fallback = await page.locator('.choam-universe__still').evaluate(async element => {
          const image = new Image();
          image.src = getComputedStyle(element).backgroundImage.slice(5,-2);
          await image.decode();
          return new URL(image.src).pathname;
        });
        assert.equal(fallback, '/nested/background/arrakis-desert-still.svg');
        assert.ok(requests.includes('/nested/background/arrakis-desert-still.svg'));
        assert.ok(!requests.includes('/assets/moon.jpg'));
        const dimensions = await page.locator('canvas').evaluate(canvas => [canvas.width,canvas.height]);
        assert.deepEqual(dimensions,[1280,720]);
      } finally {
        await page.close();
        await new Promise(resolve => relocated.close(resolve));
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    });

    it('updates the paused attribute without replacing the component', async () => {
      const page = await browser.newPage();
      await page.addInitScript(() => {
        const original = WebGLRenderingContext.prototype.drawElements;
        globalThis.draws = 0;
        WebGLRenderingContext.prototype.drawElements = function (...args) { globalThis.draws++; return original.apply(this,args); };
      });
      await page.goto(`${url}/webcomponent/index.html`);
      await ready(page, 'webcomponent/index.html');
      const result = await page.evaluate(async () => {
        const element = document.querySelector('arrakis-desert');
        element.setAttribute('paused','');
        const start = globalThis.draws;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { start, end: globalThis.draws };
      });
      assert.equal(result.end, result.start);
      await page.close();
    });

    for (const variant of ['webgl', 'webcomponent']) {
      it(`retains the ${variant} static framebuffer after browser compositing`, async () => {
        const page = await browser.newPage({ viewport: { width: 480, height: 320 }, reducedMotion: 'reduce' });
        try {
          await page.goto(`${url}/${variant}/index.html`);
          await ready(page, `${variant}/index.html`);
          await page.screenshot();
          const coloredFraction = await page.locator('canvas').evaluate(canvas => {
            const gl = canvas.getContext('webgl');
            const pixels = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let colored = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 60) colored++;
            }
            return colored / (canvas.width * canvas.height);
          });
          assert.ok(coloredFraction > 0.95, `retained artwork fraction ${coloredFraction}`);
        } finally { await page.close(); }
      });
    }

    it('keeps the animated SVG asset moving independently of host media preferences', async () => {
      const page = await browser.newPage({ viewport: { width: 640, height: 400 }, reducedMotion: 'reduce' });
      try {
        await page.goto(`${url}/svg/arrakis-desert.svg`);
        const initial = PNG.sync.read(await page.screenshot());
        await page.waitForTimeout(700);
        const moving = PNG.sync.read(await page.screenshot());
        assert.ok(changedFraction(initial, moving, 0.8) > 0.03, 'the animated asset retains its foreground motion');
      } finally { await page.close(); }
    });

    it('animates SVG sand in the foreground and holds reduced motion still', async () => {
      const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
      await page.goto(`${url}/svg/index.html`);
      await ready(page, 'svg/index.html');
      const initial = PNG.sync.read(await page.screenshot());
      await page.waitForTimeout(700);
      const moving = PNG.sync.read(await page.screenshot());
      assert.ok(changedFraction(initial, moving, 0.8) > 0.03, 'foreground storm changes visible pixels');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await ready(page, 'svg/index.html');
      const still = await page.screenshot();
      await page.waitForTimeout(700);
      const later = await page.screenshot();
      assert.deepEqual(still, later);
      await page.close();
    });
  });
}

function ready(page, entry) {
  return entry === 'svg/index.html'
    ? page.evaluate(async () => { const image = new Image(); image.src = getComputedStyle(document.body).backgroundImage.slice(5,-2); await image.decode(); })
    : page.waitForSelector('.choam-universe--ready', { state: 'attached' });
}

function assertMoons(png, shape, svg) { for (const moon of ['large', 'small']) assertMoon(png, shape, moon, svg); }

function assertMoon(png, shape, moon, svg = false) {
  const aspect = png.width / png.height;
  const sourceAspect = svg ? aspect < 0.75 ? 0.5625 : aspect < 0.875 ? 0.75 : aspect < 1 ? 1
    : aspect < 1.2 ? 1.2 : aspect < 1.8 ? 1.6 : aspect < 2.4 ? 2.1 : 3.2 : aspect;
  const t = Math.max(0, Math.min(1, (sourceAspect - 0.65) / 0.30));
  const portrait = 1 - t * t * (3 - 2 * t);
  const source = moon === 'large'
    ? [(0.35 - 0.03 * portrait) * sourceAspect, -0.01 + 0.08 * portrait, 0.59 * (1 - portrait) + 0.60 * sourceAspect * portrait]
    : [0.11 * sourceAspect, 0.15, 0.13 * Math.min(1, sourceAspect * 1.65)];
  const scale = Math.max(1, aspect / sourceAspect);
  const cx = (source[0] * scale - (sourceAspect * scale - aspect) / 2) / aspect;
  const cy = source[1] * scale - (scale - 1) / 2;
  const r = source[2] * scale;
  let difference = 0, count = 0;
  for (let angle = 0.12; angle < 1.1; angle += 0.01) {
    for (let offset = -0.025; offset < 0.025; offset += 0.005) {
      const sample = scale => {
        const x = Math.round(cx * png.width + r * png.height * scale * Math.cos(angle));
        const y = Math.round(cy * png.height + r * png.height * scale * Math.sin(angle));
        if (x < 0 || x >= png.width || y < 0 || y >= png.height) return undefined;
        const i = (y * png.width + x) * 4;
        return (png.data[i] + png.data[i+1] + png.data[i+2]) / 3;
      };
      const inside = sample(0.90 + offset), outside = sample(1.06 + offset);
      if (inside === undefined || outside === undefined) continue;
      difference += inside - outside;
      count++;
    }
  }
  assert.ok(count > 200, `${moon} has a recognizable visible crescent arc`);
  assert.ok(difference / count > 3, `${moon} crescent contrast ${difference / count} must exceed 3`);
}

function assertTerrain(png) {
  const stripe = y => {
    let sum = 0;
    for (let x = 0; x < png.width; x++) sum += png.data[(Math.floor(y * png.height) * png.width + x) * 4];
    return sum / png.width;
  };
  assert.ok(stripe(0.55) - stripe(0.95) > 15, 'dune foreground is darker than horizon');
}

function changedFraction(a,b,fromY) {
  let count=0,total=0;
  for(let y=Math.floor(a.height*fromY);y<a.height;y++) for(let x=0;x<a.width;x++) {
    const i=(y*a.width+x)*4;
    if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>24) count++;
    total++;
  }
  return count/total;
}

async function serveDirectory(directory) {
  const { createServer } = require('node:http');
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(directory + path.sep)) { response.writeHead(403).end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
    try {
      const bytes = fs.readFileSync(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}
