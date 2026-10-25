const { instrument } = require('./instrument.cjs');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const app = path.join(__dirname, '..');
const config = app;
const script = fs.readFileSync(path.join(config, 'webgl/scene.js'), 'utf8');
const style = fs.readFileSync(path.join(config, 'src/scene.css'), 'utf8');

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  describe(name, () => {
    let browser;
    before(async () => { browser = await engine.launch({ headless: true }); });
    after(async () => { await browser?.close(); });

    it('contains no demo controls or attribution overlays', async () => {
      const page = await setup(browser);
      const count = await page.locator('#choam-motion-toggle, #choam-background-credits').count();
      assert.equal(count, 0);
      await page.close();
    });

    it('renders a decorative scene without intercepting dashboard links', async () => {
      const page = await setup(browser);
      assert.equal(await page.locator('#choam-universe canvas').count(), 1);
      const result = await page.evaluate(() => ({
        draws: window.fixture.draws,
        colored: window.fixture.colored,
        target: document.elementFromPoint(100, 100).id,
        hidden: document.querySelector('#choam-universe').getAttribute('aria-hidden'),
      }));
      assert.ok(result.draws > 0);
      assert.ok(result.colored, 'shader produces colored pixels');
      assert.equal(result.target, 'dashboard-link');
      assert.equal(result.hidden, 'true');
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('loads detailed local planet maps into the GPU', async () => {
      const page = await setup(browser);
      const textures = await page.evaluate(() => fixture.textures);
      assert.deepEqual(textures, [[4096, 2048], [2048, 1024], [1024, 512]]);
      assert.equal(await page.locator('canvas').evaluate(c => c.getContext('webgl').getError()), 0);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('shows only atmosphere until the first textured frame is ready', async () => {
      const page = await setup(browser, { deferTextures: true, initialFocus: false });
      const loading = await page.evaluate(() => ({
        planets: [...document.querySelectorAll('.choam-universe__still i')].map(planet => {
          const style = getComputedStyle(planet);
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
        }),
        canvasOpacity: Number(getComputedStyle(document.querySelector('canvas')).opacity),
        draws: fixture.draws,
        textures: fixture.textures,
        pending: fixture.pending.size,
      }));
      assert.ok(loading.planets.every(visible => !visible), JSON.stringify(loading));
      assert.equal(loading.canvasOpacity, 0);
      assert.equal(loading.draws, 0);
      assert.deepEqual(loading.textures, []);
      assert.equal(loading.pending, 0);
      page.releaseTextures();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('canvas')).opacity === '1');
      const ready = await page.evaluate(() => ({
        draws: fixture.draws, colored: fixture.colored, textures: fixture.textures,
        pending: fixture.pending.size, time: fixture.time,
      }));
      assert.ok(ready.draws > 0);
      assert.equal(ready.colored, true);
      assert.deepEqual(ready.textures, [[4096, 2048], [2048, 1024], [1024, 512]]);
      assert.equal(ready.pending, 0);
      assert.equal(ready.time, 0);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('keeps the static fallback if a texture cannot load', async () => {
      const page = await setup(browser, { textureFailure: true });
      assert.equal(await page.locator('canvas').evaluate(canvas => getComputedStyle(canvas).opacity), '0');
      assert.equal(await page.locator('.choam-universe__still i').first().isVisible(), true);
      assert.equal(await page.locator('#choam-universe').evaluate(element => element.classList.contains('choam-universe--loading')), false);
      assert.equal(await page.evaluate(() => fixture.pending.size), 0);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('eases visible blur to a complete stop within 650 milliseconds', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(() => {
        const f = window.fixture;
        f.advance(4000);
        f.focus(false);
        const pending = f.pending.size;
        const start = f.time;
        const deltas = [];
        for (let sample = 0; sample < 4; sample++) {
          const before = f.time;
          f.advance(160);
          deltas.push(f.time - before);
        }
        const easing = f.pending.size;
        f.advance(10);
        const stopped = f.time;
        const finished = f.pending.size;
        f.advance(60000);
        return { pending, deltas, easing, finished, travel: stopped - start, stopped, later: f.time };
      });
      assert.equal(result.pending, 1);
      assert.equal(result.easing, 1);
      assert.equal(result.finished, 0);
      assert.ok(result.deltas[0] > 0.13, JSON.stringify(result));
      assert.ok(result.deltas.every((delta, index) => index === 0 || delta < result.deltas[index - 1]), JSON.stringify(result));
      assert.ok(result.deltas[3] > 0 && result.deltas[3] < 0.04, JSON.stringify(result));
      assert.ok(result.travel > 0.3 && result.travel < 0.37, JSON.stringify(result));
      assert.equal(result.later, result.stopped);
      await page.close();
    });

    it('keeps blur easing below one second when frame callbacks slow down', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(() => {
        fixture.advance(4000);
        fixture.focus(false);
        fixture.advance(200, 200);
        const easing = fixture.pending.size;
        fixture.advance(600, 200);
        return { easing, finished: fixture.pending.size };
      });
      assert.equal(result.easing, 1);
      assert.equal(result.finished, 0);
      await page.close();
    });

    it('resumes from the last painted position and reaches full speed within 650 milliseconds', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(() => {
        const f = window.fixture;
        f.advance(4000);
        f.focus(false);
        f.advance(650);
        const stopped = f.time;
        f.advance(60000);
        f.focus(true);
        f.advance(10);
        const firstFrame = f.time;
        const deltas = [];
        for (let sample = 0; sample < 4; sample++) {
          const before = f.time;
          f.advance(160);
          deltas.push(f.time - before);
        }
        f.advance(40);
        const cruising = f.time;
        f.advance(160);
        return { stopped, firstFrame, deltas, fullSpeedTravel: f.time - cruising };
      });
      assert.equal(result.firstFrame, result.stopped);
      assert.ok(result.deltas[0] > 0 && result.deltas[0] < 0.02, JSON.stringify(result));
      assert.ok(result.deltas.every((delta, index) => index === 0 || delta > result.deltas[index - 1]), JSON.stringify(result));
      assert.ok(result.deltas[3] > 0.13, JSON.stringify(result));
      assert.ok(Math.abs(result.fullSpeedTravel - 0.16) < 0.001, JSON.stringify(result));
      await page.close();
    });

    it('preserves intermediate speed when focus reverses during easing', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(() => {
        const f = window.fixture;
        f.advance(4000);
        f.focus(false);
        f.advance(320);
        const beforeFocus = f.time;
        f.focus(true);
        const afterFocus = f.time;
        f.advance(40);
        const focusTravel = f.time - afterFocus;
        f.advance(160);
        const beforeBlur = f.time;
        f.focus(false);
        const afterBlur = f.time;
        f.advance(40);
        const blurTravel = f.time - afterBlur;
        const beforeRefocus = f.time;
        f.focus(true);
        f.advance(40);
        return { beforeFocus, afterFocus, focusTravel, beforeBlur, afterBlur, blurTravel, refocusTravel: f.time - beforeRefocus };
      });
      assert.equal(result.afterFocus, result.beforeFocus);
      assert.equal(result.afterBlur, result.beforeBlur);
      for (const distance of [result.focusTravel, result.blurTravel, result.refocusTravel]) {
        assert.ok(distance > 0.01 && distance < 0.035, JSON.stringify(result));
      }
      await page.close();
    });

    it('stops immediately when visibility interrupts a blur transition', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(() => {
        fixture.advance(4000);
        fixture.focus(false);
        fixture.advance(160);
        const before = fixture.time;
        fixture.visible(false);
        const pending = fixture.pending.size;
        fixture.advance(60000);
        const hiddenTime = fixture.time;
        fixture.focus(true);
        fixture.visible(true);
        fixture.advance(10);
        return { before, pending, hiddenTime, firstFrame: fixture.time };
      });
      assert.equal(result.pending, 0);
      assert.equal(result.hiddenTime, result.before);
      assert.equal(result.firstFrame, result.before);
      await page.close();
    });

    it('requires both visibility and focus to restart', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(() => {
        const f = window.fixture;
        f.visible(false);
        f.focus(true);
        const hidden = f.pending.size;
        f.focus(false);
        f.visible(true);
        const blurred = f.pending.size;
        f.focus(true);
        return { hidden, blurred, active: f.pending.size };
      });
      assert.deepEqual(result, { hidden: 0, blurred: 0, active: 1 });
      await page.close();
    });

    it('starts on a visible touch device before Safari gives the document focus', async () => {
      const page = await setup(browser, { isMobile: true, hasTouch: true, initialFocus: false });
      assert.equal(await page.evaluate(() => fixture.pending.size), 1);
      const result = await page.evaluate(() => {
        fixture.advance(4000);
        const runningTime = fixture.time;
        fixture.focus(false);
        const blurred = fixture.pending.size;
        fixture.visible(false);
        const hidden = fixture.pending.size;
        fixture.visible(true);
        return { runningTime, blurred, hidden, resumed: fixture.pending.size };
      });
      assert.ok(result.runningTime > 1);
      assert.equal(result.blurred, 1);
      assert.equal(result.hidden, 0);
      assert.equal(result.resumed, 1);
      await page.close();
    });

    it('keeps reduced motion static and reacts to preference changes', async () => {
      const page = await setup(browser, { reducedMotion: 'reduce' });
      assert.equal(await page.evaluate(() => fixture.pending.size), 0);

      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.waitForFunction(() => fixture.pending.size === 1);
      await page.evaluate(() => { fixture.advance(4000); fixture.focus(false); fixture.advance(160); });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => fixture.pending.size === 0);
      const result = await page.evaluate(() => {
        const before = fixture.time;
        fixture.advance(10000);
        return { before, after: fixture.time };
      });
      assert.equal(result.after, result.before);
      await page.close();
    });

    {
      it('preserves manual pause across focus changes', async () => {
        const page = await setup(browser);
        const result = await page.evaluate(() => {
          fixture.advance(4000);
          fixture.focus(false);
          fixture.advance(160);
          const before = fixture.time;
          window.orbit.setPaused(true);
          fixture.focus(false);
          fixture.focus(true);
          fixture.advance(10000);
          return { pending: fixture.pending.size, before, after: fixture.time };
        });
        assert.equal(result.pending, 0);
        assert.equal(result.after, result.before);

        await page.evaluate(() => window.orbit.setPaused(false));
        assert.equal(await page.evaluate(() => fixture.pending.size), 1);
        await page.close();
      });

    }

    it('bounds mobile rendering resolution and survives rotation', async () => {
      const page = await setup(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
      const first = await page.locator('canvas').evaluate(c => ({ width: c.width, height: c.height }));
      assert.ok(first.width * first.height <= 1800000);
      assert.ok(first.width >= 390);
      await page.evaluate(() => { window.resized = new Promise(resolve => addEventListener('resize', resolve, { once: true })); });
      await page.setViewportSize({ width: 844, height: 390 });
      await page.evaluate(async () => { await window.resized; });
      await page.evaluate(() => fixture.advance(100));
      const rotated = await page.locator('canvas').evaluate(c => ({ width: c.width, height: c.height }));
      assert.ok(rotated.width > rotated.height);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('mounts only once when Homepage loads the script again', async () => {
      const page = await setup(browser);
      await page.addScriptTag({ content: script || ';' });
      assert.equal(await page.locator('#choam-universe').count(), 1);
      assert.equal(await page.locator('#choam-motion-toggle').count(), 0);
      assert.equal(await page.evaluate(() => fixture.pending.size), 1);
      await page.close();
    });

    it('suspends for pagehide and restores after pageshow', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(() => {
        fixture.advance(4000);
        fixture.focus(false);
        fixture.advance(160);
        const before = fixture.time;
        dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        const hidden = fixture.pending.size;
        fixture.advance(10000);
        const hiddenTime = fixture.time;
        fixture.focus(true);
        dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        const shown = fixture.pending.size;
        fixture.advance(10);
        return { hidden, shown, before, hiddenTime, firstFrame: fixture.time };
      });
      assert.equal(result.hidden, 0);
      assert.equal(result.shown, 1);
      assert.equal(result.hiddenTime, result.before);
      assert.equal(result.firstFrame, result.before);
      await page.close();
    });

    it('restores the scene after a real WebGL context loss', async () => {
      const page = await setup(browser);
      const supported = await page.evaluate(() => {
        window.contextExtension = document.querySelector('canvas').getContext('webgl').getExtension('WEBGL_lose_context');
        return Boolean(window.contextExtension);
      });
      assert.ok(supported, 'browser exposes context-loss testing');
      await page.evaluate(async () => {
        fixture.advance(4000);
        fixture.focus(false);
        fixture.advance(160);
        const canvas = document.querySelector('canvas');
        const lost = new Promise(resolve => canvas.addEventListener('webglcontextlost', resolve, { once: true }));
        window.contextExtension.loseContext();
        await lost;
      });
      assert.equal(await page.evaluate(() => fixture.pending.size), 0);
      assert.equal(await page.locator('canvas').evaluate(canvas => getComputedStyle(canvas).opacity), '0');
      assert.equal(await page.locator('.choam-universe__still i').first().isVisible(), true);
      await page.evaluate(async () => {
        const canvas = document.querySelector('canvas');
        window.restoreFallbackVisibility = [];
        const root = document.getElementById('choam-universe');
        const prototype = WebGLRenderingContext.prototype;
        const createShader = prototype.createShader;
        prototype.createShader = function(...args) {
          window.restoreFallbackVisibility.push([...root.querySelectorAll('.choam-universe__still i')]
            .every(planet => getComputedStyle(planet).visibility === 'hidden'));
          return createShader.apply(this, args);
        };
        const restored = new Promise(resolve => canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
        window.contextExtension.restoreContext();
        await restored;
      });
      await page.waitForSelector('.choam-universe--ready');
      const fallbackVisibility = await page.evaluate(() => restoreFallbackVisibility);
      assert.ok(fallbackVisibility.length > 0);
      assert.ok(fallbackVisibility.every(hidden => hidden), JSON.stringify(fallbackVisibility));
      assert.equal(await page.locator('#choam-universe').getAttribute('class'), 'choam-universe choam-universe--ready');
      await page.evaluate(() => fixture.focus(true));
      assert.equal(await page.evaluate(() => fixture.pending.size), 1);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('limits drawing to thirty frames per second', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(() => {
        const before = fixture.draws;
        fixture.advance(1000);
        return fixture.draws - before;
      });
      assert.ok(result >= 20 && result <= 31);
      await page.close();
    });

    it('fits a still scene after resizing an unfocused window', async () => {
      const page = await setup(browser);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => {
        fixture.focus(false);
        window.resized = new Promise(resolve => addEventListener('resize', resolve, { once: true }));
      });
      await page.setViewportSize({ width: 320, height: 480 });
      await page.evaluate(async () => { await window.resized; fixture.focus(true); });
      const result = await page.locator('canvas').evaluate(c => ({ width: c.width, height: c.height }));
      assert.ok(result.width < result.height);
      assert.equal(await page.evaluate(() => fixture.pending.size), 0);
      await page.close();
    });

    it('retains a CSS space scene when WebGL is unavailable', async () => {
      const page = await setup(browser, {}, true);
      assert.equal(await page.locator('#choam-universe').count(), 1);
      assert.equal(await page.locator('.choam-universe__still').isVisible(), true);
      assert.equal(await page.locator('.choam-universe__still i').first().isVisible(), true);
      assert.equal(await page.evaluate(() => fixture.pending.size), 0);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });
  });
}

async function setup(browser, options = {}, noWebGL = false, existingPage = null) {
  const { textureFailure = false, deferTextures = false, initialFocus = true, gpuLimit = null, failFramebufferAt = null, ...browserOptions } = options;
  const page = existingPage || await browser.newPage({ viewport: { width: 480, height: 320 }, ...browserOptions });
  const texturesReady = deferTextures ? new Promise(resolve => { page.releaseTextures = resolve; }) : Promise.resolve();
  page.textureRequests = [];
  page.on('request', request => {
    if (request.url().endsWith('.jpg')) page.textureRequests.push(new URL(request.url()).pathname);
  });
  page.failures = [];
  page.on('pageerror', e => page.failures.push(e.message));
  const markup = `<html lang="en"><body>
    <div id="__next"><div id="page_wrapper"><div id="background"></div><div id="inner_wrapper">
      <a id="dashboard-link" href="#dashboard-link"
         style="position:absolute;left:60px;top:60px;width:160px;height:80px;z-index:10">Dashboard</a>
      <div id="homepage-card" class="service-card" style="display:none"></div>
    </div></div></div>
  </body></html>`;
  await page.route('https://homepage.test/', route => route.fulfill({ contentType: 'text/html', body: markup }));
  const assetBase = '/assets/';
  const assetDirectory = path.join(config, 'src/assets');
  await page.route(`https://homepage.test${assetBase}**`, async route => {
    await texturesReady;
    if (textureFailure) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: path.join(assetDirectory, path.basename(new URL(route.request().url()).pathname)) });
  });
  await page.goto('https://homepage.test/');
  await page.addStyleTag({ content: '.service-card { background: rgb(21, 31, 41); }' });
  await page.addStyleTag({ content: style });
  await page.evaluate(instrument, { noWebGL, initialFocus, gpuLimit, failFramebufferAt });
  await page.addScriptTag({ content: script || ';' });
  await page.waitForFunction(() => document.getElementById('choam-universe'));
  if (!deferTextures) {
    await page.waitForFunction(() => {
      const root = document.getElementById('choam-universe');
      return root && !root.classList.contains('choam-universe--loading');
    });
  }
  return page;
}

async function errors(page) { return page.failures; }
