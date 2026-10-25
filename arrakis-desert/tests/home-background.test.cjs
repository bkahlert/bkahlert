const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { chromium, webkit } = require('playwright');
const config = path.join(__dirname, '..');
const sourceDirectory = path.join(config, 'src');
const style = fs.readFileSync(path.join(sourceDirectory, 'scene.css'), 'utf8');

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  describe(name, () => {
    let browser;
    before(async () => { browser = await engine.launch({ headless: true }); });
    after(async () => { await browser?.close(); });
    afterEach(async context => {
      for (const browserContext of browser.contexts()) {
        for (const page of browserContext.pages()) {
          const directory = path.join(config, 'test-results', 'lifecycle', name,
            context.name.replaceAll(/[^a-z0-9]+/gi, '-'));
          fs.mkdirSync(directory, { recursive: true });
          fs.writeFileSync(path.join(directory, 'errors.json'), JSON.stringify(page.failures, null, 2));
          await page.screenshot({ path: path.join(directory, 'failure.png'), timeout: 5000 }).catch(() => {});
        }
        await browserContext.close();
      }
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
      assert.deepEqual(textures, [[4096, 2048]]);
      assert.equal(await page.locator('canvas').evaluate(c => c.getContext('webgl').getError()), 0);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('shows only atmosphere until the first textured frame is ready', async () => {
      const page = await setup(browser, { deferTextures: true, initialFocus: false });
      const loading = await page.evaluate(() => ({
        fallbackImage: getComputedStyle(document.querySelector('.choam-universe__still')).backgroundImage,
        canvasOpacity: Number(getComputedStyle(document.querySelector('canvas')).opacity),
        draws: fixture.draws,
        textures: fixture.textures,
        pending: fixture.pending.size,
      }));
      assert.equal(loading.fallbackImage, 'none');
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
      assert.deepEqual(ready.textures, [[4096, 2048]]);
      assert.equal(ready.pending, 0);
      assert.equal(ready.time, 0);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('keeps moving sand in the near foreground throughout a gust cycle', async () => {
      const page = await setup(browser);
      const changes = await page.evaluate(() => {
        const gl = document.querySelector('canvas').getContext('webgl');
        const width = gl.drawingBufferWidth, height = Math.floor(gl.drawingBufferHeight * 0.2);
        let previous = new Uint8Array(width * height * 4);
        fixture.advance(4000);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, previous);
        const fractions = [];
        for (let sample = 0; sample < 8; sample++) {
          fixture.advance(1000);
          const pixels = new Uint8Array(previous.length);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let changed = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (Math.abs(pixels[i] - previous[i]) + Math.abs(pixels[i + 1] - previous[i + 1])
              + Math.abs(pixels[i + 2] - previous[i + 2]) > 24) changed++;
          }
          fractions.push(changed / (width * height));
          previous = pixels;
        }
        return fractions;
      });
      assert.ok(changes.every(fraction => fraction > 0.08), JSON.stringify(changes));
      await page.close();
    });

    it('covers both edges with terrain after rotating to a wide viewport', async () => {
      const page = await setup(browser);
      await page.setViewportSize({ width: 1280, height: 360 });
      const result = await page.evaluate(() => {
        dispatchEvent(new Event('resize'));
        fixture.advance(100);
        return fixture.terrainEdges;
      });
      assert.equal(result.length, 2);
      assert.ok(result.every(alpha => alpha < 250), JSON.stringify(result));
      await page.close();
    });

    it('moves visibly contrasting sand across the desert', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(() => {
        const gl = document.querySelector('canvas').getContext('webgl');
        const width = gl.drawingBufferWidth, height = Math.floor(gl.drawingBufferHeight * 0.55);
        const before = new Uint8Array(width * height * 4), after = new Uint8Array(before.length);
        fixture.advance(4000);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, before);
        fixture.advance(2000);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, after);
        let changed = 0;
        for (let i = 0; i < before.length; i += 4) {
          if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1])
            + Math.abs(before[i + 2] - after[i + 2]) > 24) changed++;
        }
        return { fraction: changed / (width * height), error: gl.getError() };
      });
      assert.ok(result.fraction > 0.08, JSON.stringify(result));
      assert.equal(result.error, 0);
      await page.close();
    });

    it('fits textures and framebuffer attachments within device limits', async () => {
      const page = await setup(browser, {
        gpuLimit: 1024, viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2,
      });
      const result = await page.evaluate(() => ({
        width: document.querySelector('canvas').width,
        height: document.querySelector('canvas').height,
        textures: fixture.textures,
        error: document.querySelector('canvas').getContext('webgl').getError(),
      }));
      assert.ok(result.width <= 1024 && result.height <= 1024);
      assert.deepEqual(result.textures, [[1024, 512]]);
      assert.equal(result.error, 0);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('keeps the fallback visible when the initial framebuffer is unavailable', async () => {
      const page = await setup(browser, { failFramebufferAt: 1 });
      const ready = await page.locator('.choam-universe--ready').count();
      assert.equal(ready, 0);
      assert.equal(await page.locator('.choam-universe__still').isVisible(), true);
    assert.match(await page.locator('.choam-universe__still').evaluate(element =>
      getComputedStyle(element).backgroundImage), /arrakis-desert-still\.svg/);
      assert.equal(await page.locator('#choam-universe').evaluate(element =>
        element.classList.contains('choam-universe--loading')), false);
      assert.equal(await page.evaluate(() => fixture.pending.size), 0);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('falls back and stops when a resized framebuffer is unavailable', async () => {
      const page = await setup(browser, { failFramebufferAt: 2 });
      await page.evaluate(() => { fixture.framebufferChecks = 1; });
      await page.setViewportSize({ width: 700, height: 480 });
      await page.evaluate(() => { dispatchEvent(new Event('resize')); fixture.advance(100); });
      assert.equal(await page.locator('canvas').evaluate(canvas => getComputedStyle(canvas).opacity), '0');
      assert.equal(await page.locator('.choam-universe__still').isVisible(), true);
    assert.match(await page.locator('.choam-universe__still').evaluate(element =>
      getComputedStyle(element).backgroundImage), /arrakis-desert-still\.svg/);
      assert.equal(await page.locator('#choam-universe').evaluate(element =>
        element.classList.contains('choam-universe--loading')), false);
      assert.equal(await page.evaluate(() => fixture.pending.size), 0);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    for (const failure of ['shader', 'program']) {
      it(`releases partial resources after ${failure} compilation fails`, async () => {
        const page = await setup(browser, { compilationFailure: failure });
        const result = await page.evaluate(() => ({
          pending: fixture.pending.size,
          ready: document.getElementById('choam-universe').classList.contains('choam-universe--ready'),
          resources: Object.fromEntries(Object.entries(fixture.resources).map(([kind, values]) => [kind, values.size])),
        }));
        assert.equal(result.pending, 0);
        assert.equal(result.ready, false);
        assert.ok(Object.values(result.resources).every(count => count === 0), JSON.stringify(result.resources));
        assert.deepEqual(await errors(page), []);
        await page.close();
      });
    }

    it('keeps the static fallback if a texture cannot load', async () => {
      const page = await setup(browser, { textureFailure: true });
      assert.equal(await page.locator('canvas').evaluate(canvas => getComputedStyle(canvas).opacity), '0');
      assert.equal(await page.locator('.choam-universe__still').isVisible(), true);
      assert.match(await page.locator('.choam-universe__still').evaluate(element =>
        getComputedStyle(element).backgroundImage), /arrakis-desert-still\.svg/);
      assert.equal(await page.locator('#choam-universe').evaluate(element =>
        element.classList.contains('choam-universe--loading')), false);
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
      assert.ok(result.deltas.every((delta, index) =>
        index === 0 || delta < result.deltas[index - 1]), JSON.stringify(result));
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
      assert.ok(result.deltas.every((delta, index) =>
        index === 0 || delta > result.deltas[index - 1]), JSON.stringify(result));
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
        return {
          beforeFocus, afterFocus, focusTravel, beforeBlur, afterBlur, blurTravel,
          refocusTravel: f.time - beforeRefocus,
        };
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
      await page.evaluate(() => fixture.controller.resume());
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

    it('preserves manual pause across focus changes', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(() => {
        fixture.advance(4000);
        fixture.focus(false);
        fixture.advance(160);
        const before = fixture.time;
        fixture.controller.pause();
        fixture.focus(false);
        fixture.focus(true);
        fixture.advance(10000);
        return { pending: fixture.pending.size, before, after: fixture.time };
      });
      assert.equal(result.pending, 0);
      assert.equal(result.after, result.before);
      await page.evaluate(() => fixture.controller.resume());
      assert.equal(await page.evaluate(() => fixture.pending.size), 1);
      await page.close();
    });

    it('bounds mobile rendering resolution and survives rotation', async () => {
      const page = await setup(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
      const first = await page.locator('canvas').evaluate(c => ({ width: c.width, height: c.height }));
      assert.ok(first.width * first.height <= 1800000);
      assert.ok(first.width >= 390);
      await page.evaluate(() => {
        window.resized = new Promise(resolve => addEventListener('resize', resolve, { once: true }));
      });
      await page.setViewportSize({ width: 844, height: 390 });
      await page.evaluate(async () => { await window.resized; });
      await page.evaluate(() => fixture.advance(100));
      const rotated = await page.locator('canvas').evaluate(c => ({ width: c.width, height: c.height }));
      assert.ok(rotated.width > rotated.height);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('returns the same controller when mounting an occupied container', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(async () => {
        const { mountDesert } = await import('/scene.js');
        const mounted = mountDesert(document.getElementById('choam-universe'));
        return {
          same: mounted === fixture.controller,
          canvases: document.querySelectorAll('canvas').length,
          pending: fixture.pending.size,
        };
      });
      assert.deepEqual(result, { same: true, canvases: 1, pending: 1 });
      await page.close();
    });

    it('disposes GPU resources and listeners before mounting again', async () => {
      const page = await setup(browser);
      const result = await page.evaluate(() => {
        fixture.advance(4000);
        fixture.controller.dispose();
        const disposedDraws = fixture.draws;
        fixture.focus(false);
        fixture.focus(true);
        fixture.visible(false);
        fixture.visible(true);
        dispatchEvent(new Event('resize'));
        dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        fixture.advance(10000);
        return {
          pending: fixture.pending.size,
          children: document.getElementById('choam-universe').childElementCount,
          resources: Object.fromEntries(Object.entries(fixture.resources).map(([kind, values]) => [kind, values.size])),
          disposedDraws,
          laterDraws: fixture.draws,
        };
      });
      assert.equal(result.pending, 0);
      assert.equal(result.children, 0);
      assert.equal(result.laterDraws, result.disposedDraws);
      assert.ok(Object.values(result.resources).every(count => count === 0), JSON.stringify(result.resources));
      await page.evaluate(async () => {
        const { mountDesert } = await import('/scene.js');
        fixture.controller = mountDesert(document.getElementById('choam-universe'));
        await fixture.controller.ready;
      });
      assert.equal(await page.locator('canvas').count(), 1);
      assert.equal(await page.evaluate(() => fixture.pending.size), 1);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });

    it('does not finish mounting after disposal while textures are loading', async () => {
      const page = await setup(browser, { deferTextures: true });
      await page.evaluate(() => fixture.controller.dispose());
      page.releaseTextures();
      await page.evaluate(() => fixture.controller.ready);
      const result = await page.evaluate(() => ({
        pending: fixture.pending.size,
        children: document.getElementById('choam-universe').childElementCount,
        draws: fixture.draws,
      }));
      assert.deepEqual(result, { pending: 0, children: 0, draws: 0 });
      await page.close();
    });

    it('keeps a remounted scene ready after a disposed texture request fails late', async () => {
      const page = await setup(browser, {
        deferredTexturePath: '/assets/moon.jpg', failedTexturePath: '/assets/moon.jpg',
      });
      await page.evaluate(async () => {
        const { mountDesert } = await import('/scene.js');
        fixture.retiredController = fixture.controller;
        fixture.retiredController.dispose();
        fixture.controller = mountDesert(document.getElementById('choam-universe'), {
          assetBase: '/assets/retry/',
        });
        await fixture.controller.ready;
      });
      const mountedReady = await page.locator('#choam-universe').evaluate(root =>
        root.classList.contains('choam-universe--ready'));
      assert.equal(mountedReady, true);
      page.releaseTextures();
      const result = await page.evaluate(async () => {
        await fixture.retiredController.ready;
        return {
          retiredReadyResolved: true,
          ready: document.getElementById('choam-universe').classList.contains('choam-universe--ready'),
          canvasOpacity: getComputedStyle(document.querySelector('canvas')).opacity,
          canvases: document.querySelectorAll('canvas').length,
          pending: fixture.pending.size,
        };
      });
      assert.deepEqual(result, {
        retiredReadyResolved: true, ready: true, canvasOpacity: '1', canvases: 1, pending: 1,
      });
      assert.deepEqual(await errors(page), []);
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
        window.contextExtension = document.querySelector('canvas').getContext('webgl')
          .getExtension('WEBGL_lose_context');
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
      assert.equal(await page.locator('.choam-universe__still').isVisible(), true);
      assert.match(await page.locator('.choam-universe__still').evaluate(element =>
        getComputedStyle(element).backgroundImage), /arrakis-desert-still\.svg/);
      await page.evaluate(async () => {
        const canvas = document.querySelector('canvas');
        window.restoreFallbackVisibility = [];
        const root = document.getElementById('choam-universe');
        const prototype = WebGLRenderingContext.prototype;
        const createShader = prototype.createShader;
        prototype.createShader = function(...args) {
          window.restoreFallbackVisibility.push(
            getComputedStyle(root.querySelector('.choam-universe__still')).backgroundImage === 'none');
          return createShader.apply(this, args);
        };
        const restored = new Promise(resolve =>
          canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
        window.contextExtension.restoreContext();
        await restored;
      });
      await page.waitForSelector('.choam-universe--ready');
      const fallbackVisibility = await page.evaluate(() => restoreFallbackVisibility);
      assert.ok(fallbackVisibility.length > 0);
      assert.ok(fallbackVisibility.every(hidden => hidden), JSON.stringify(fallbackVisibility));
      assert.equal(await page.locator('#choam-universe').evaluate(root =>
        root.classList.contains('choam-universe--ready')), true);
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

    it('retains a CSS desert scene when WebGL is unavailable', async () => {
      const page = await setup(browser, {}, true);
      assert.equal(await page.locator('#choam-universe').count(), 1);
      assert.equal(await page.locator('.choam-universe__still').isVisible(), true);
      assert.match(await page.locator('.choam-universe__still').evaluate(element =>
        getComputedStyle(element).backgroundImage), /arrakis-desert-still\.svg/);
      assert.equal(await page.evaluate(() => fixture.pending.size), 0);
      const screenshot = PNG.sync.read(await page.screenshot());
      const colors = new Set();
      for (let offset = 0; offset < screenshot.data.length; offset += 4) {
        colors.add(screenshot.data.readUInt32BE(offset));
      }
      assert.ok(colors.size > 1024, `fallback renders detailed artwork: ${colors.size} colors`);
      assert.deepEqual(await errors(page), []);
      await page.close();
    });
  });
}

async function setup(browser, options = {}, noWebGL = false) {
  const {
    textureFailure = false, deferTextures = false, initialFocus = true, gpuLimit = null,
    failFramebufferAt = null, compilationFailure = null,
    deferredTexturePath = null, failedTexturePath = null, ...browserOptions
  } = options;
  const page = await browser.newPage({ viewport: { width: 480, height: 320 }, ...browserOptions });
  const texturesReady = deferTextures || deferredTexturePath
    ? new Promise(resolve => { page.releaseTextures = resolve; }) : Promise.resolve();
  page.textureRequests = [];
  page.on('request', request => {
    if (request.url().endsWith('.jpg')) page.textureRequests.push(new URL(request.url()).pathname);
  });
  page.failures = [];
  page.on('pageerror', e => page.failures.push(e.message));
  const markup = `<!doctype html><html lang="en"><body><div id="choam-universe"></div>
      <a id="dashboard-link" href="#dashboard-link"
         style="position:absolute;left:60px;top:60px;width:160px;height:80px;z-index:10">Dashboard</a>
  </body></html>`;
  await page.route('https://homepage.test/', route => route.fulfill({ contentType: 'text/html', body: markup }));
  const assetBase = '/assets/';
  const assetDirectory = path.join(sourceDirectory, 'assets');
  await page.route('https://homepage.test/**/*.js', route => route.fulfill({
    contentType: 'text/javascript',
    path: path.join(sourceDirectory, new URL(route.request().url()).pathname.slice(1)),
  }));
  await page.route('https://homepage.test/*.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    path: path.join(config, 'svg', path.basename(new URL(route.request().url()).pathname)),
  }));
  await page.route(`https://homepage.test${assetBase}**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (deferTextures || deferredTexturePath === pathname) await texturesReady;
    if (textureFailure || failedTexturePath === pathname) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: path.join(assetDirectory, path.basename(pathname)) });
  });
  await page.goto('https://homepage.test/');
  await page.addStyleTag({ content: `html,body{margin:0}
    #choam-universe{position:fixed;inset:0;width:100%;height:100%;pointer-events:none}` });
  await page.addStyleTag({ content: style });
  await page.evaluate(({ noWebGL, initialFocus, gpuLimit, failFramebufferAt, compilationFailure }) => {
    const f = window.fixture = {
      pending: new Map(), now: 0, serial: 0, focused: initialFocus, visibleState: true,
      time: 0, draws: 0, colored: false, textures: [], framebufferChecks: 0, resources: {},
    };
    Object.defineProperty(document, 'hidden', { get: () => !f.visibleState });
    Object.defineProperty(document, 'visibilityState', { get: () => f.visibleState ? 'visible' : 'hidden' });
    document.hasFocus = () => f.focused;
    window.requestAnimationFrame = callback => { const id = ++f.serial; f.pending.set(id, callback); return id; };
    window.cancelAnimationFrame = id => f.pending.delete(id);
    f.advance = (duration, frameInterval = 10) => {
      for (let left = duration; left > 0; left -= frameInterval) {
        f.now += Math.min(left, frameInterval);
        const callbacks = [...f.pending.values()];
        f.pending.clear();
        callbacks.forEach(fn => fn(f.now));
      }
    };
    f.focus = value => { f.focused = value; dispatchEvent(new Event(value ? 'focus' : 'blur')); };
    f.visible = value => { f.visibleState = value; document.dispatchEvent(new Event('visibilitychange')); };
    if (noWebGL) {
      HTMLCanvasElement.prototype.getContext = () => null;
      return;
    }
    const locations = new Map();
    const proto = WebGLRenderingContext.prototype;
    for (const kind of ['Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'Program', 'Shader']) {
      const resources = f.resources[kind] = new Set();
      const create = proto[`create${kind}`];
      const destroy = proto[`delete${kind}`];
      proto[`create${kind}`] = function(...args) {
        const resource = create.apply(this, args);
        if (resource) resources.add(resource);
        return resource;
      };
      proto[`delete${kind}`] = function(resource) {
        resources.delete(resource);
        return destroy.call(this, resource);
      };
    }
    const shaderParameter = proto.getShaderParameter;
    proto.getShaderParameter = function(shader, parameter) {
      if (compilationFailure === 'shader' && parameter === this.COMPILE_STATUS) return false;
      return shaderParameter.call(this, shader, parameter);
    };
    const programParameter = proto.getProgramParameter;
    proto.getProgramParameter = function(program, parameter) {
      if (compilationFailure === 'program' && parameter === this.LINK_STATUS) return false;
      return programParameter.call(this, program, parameter);
    };
    const parameter = proto.getParameter;
    proto.getParameter = function(name) {
      if (gpuLimit && (name === this.MAX_TEXTURE_SIZE || name === this.MAX_RENDERBUFFER_SIZE)) return gpuLimit;
      return parameter.call(this, name);
    };
    const framebuffer = proto.checkFramebufferStatus;
    proto.checkFramebufferStatus = function(target) {
      f.framebufferChecks++;
      return failFramebufferAt && f.framebufferChecks >= failFramebufferAt
        ? this.FRAMEBUFFER_UNSUPPORTED : framebuffer.call(this, target);
    };
    const upload = proto.texImage2D;
    proto.texImage2D = function(...args) {
      const source = args[args.length - 1];
      if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
        f.textures.push([source.width, source.height]);
      }
      return upload.apply(this, args);
    };
    const get = proto.getUniformLocation;
    proto.getUniformLocation = function(program, name) {
      const loc = get.call(this, program, name);
      locations.set(loc, name);
      return loc;
    };
    const uniform = proto.uniform1f;
    proto.uniform1f = function(loc, value) {
      if (locations.get(loc) === 'u_time') f.time = value;
      return uniform.call(this, loc, value);
    };
    const draw = proto.drawArrays;
    proto.drawArrays = function(...args) {
      draw.apply(this, args);
      f.draws++;
      if (f.draws === 1) {
        const pixels = new Uint8Array(this.drawingBufferWidth * this.drawingBufferHeight * 4);
        this.readPixels(0, 0, this.drawingBufferWidth, this.drawingBufferHeight, this.RGBA, this.UNSIGNED_BYTE, pixels);
        f.colored = pixels.some((value, index) => index % 4 !== 3 && value > 50);
      }
    };
    const drawElements = proto.drawElements;
    proto.drawElements = function(...args) {
      drawElements.apply(this, args);
      if (this.getParameter(this.FRAMEBUFFER_BINDING)) {
        f.terrainEdges = [1, this.drawingBufferWidth - 2].map(x => {
          const pixel = new Uint8Array(4);
          this.readPixels(x, Math.floor(this.drawingBufferHeight * 0.25), 1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
          return pixel[3];
        });
      }
    };
  }, { noWebGL, initialFocus, gpuLimit, failFramebufferAt, compilationFailure });
  await page.evaluate(async () => {
    const { mountDesert } = await import('/scene.js');
    fixture.controller = mountDesert(document.getElementById('choam-universe'));
  });
  await page.waitForFunction(() => document.getElementById('choam-universe'));
  if (!deferTextures && !deferredTexturePath) {
    await page.waitForFunction(() => {
      const root = document.getElementById('choam-universe');
      return root && !root.classList.contains('choam-universe--loading');
    });
  }
  return page;
}

async function errors(page) { return page.failures; }
