const fs = require('node:fs/promises');
const path = require('node:path');
const { createServer } = require('node:http');
const { createRequire } = require('node:module');
const localRequire = createRequire(path.join(process.cwd(), 'package.json'));
const { webkit } = localRequire('playwright');
const { PNG } = localRequire('pngjs');
const root = process.cwd();
const output = process.env.ORBIT_DIAGNOSTIC_OUTPUT || path.join(root, 'test-results/orbit-diagnostic');
const results = [];
const ready = '        draw();\n        root.classList.add("choam-universe--ready");';
const media = '@media (prefers-reduced-motion:reduce) { #arrakis-motion,#caladan-motion,#stars { animation:none; } }';
const modifications = {
  original: body => body,
  readback: body => body,
  'ready-before-draw': body => replaceOnce(body, ready, '        root.classList.add("choam-universe--ready");\n        draw();'),
  'always-visible': body => replaceOnce(body, '.choam-universe canvas {\\n  opacity: 0;', '.choam-universe canvas {\\n  opacity: 1;'),
  preserve: body => replaceOnce(body, 'alpha: false,', 'preserveDrawingBuffer: true,\n        alpha: false,'),
  'alpha-true': body => replaceOnce(body, 'alpha: false,', 'alpha: true,'),
  'antialias-true': body => replaceOnce(body, 'antialias: false,', 'antialias: true,'),
  animated: body => body,
  'svg-original': body => body,
  'svg-no-preload': body => body,
  'svg-no-media': body => replaceOnce(body, media, ''),
};

(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = createServer(async (req, res) => {
    try {
      const parts = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
      const variant = parts.shift();
      if (!Object.hasOwn(modifications, variant) || parts.includes('..')) throw new Error('Unknown route');
      const filename = path.join(root, ...parts);
      let body = await fs.readFile(filename);
      if (filename.endsWith('/webgl/scene.js') || filename.endsWith('/svg/arrakis-orbit.svg')) {
        body = Buffer.from(modifications[variant](body.toString()));
      }
      const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' }[path.extname(filename)];
      res.writeHead(200, { 'Content-Type': contentType || 'application/octet-stream' });
      res.end(body);
    } catch (error) {
      console.error('SERVER ERROR', req.url, error.message);
      res.writeHead(500).end(error.message);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const headless of [true, false]) {
      if (process.env.ORBIT_DIAGNOSTIC_HEADLESS_ONLY && !headless) continue;
      const browser = await webkit.launch({ headless });
      try {
        console.log(JSON.stringify({ browser: browser.version(), headless, platform: process.platform }));
        for (const variant of ['original', 'readback', 'ready-before-draw', 'always-visible', 'preserve', 'alpha-true', 'antialias-true', 'animated']) {
          const page = await browser.newPage({ viewport: { width: 960, height: 600 }, reducedMotion: variant === 'animated' ? 'no-preference' : 'reduce' });
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
          await page.addInitScript(readback => {
            window.probe = { draws: 0, readback: null, raf: 0 };
            const getContext = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (...args) {
              const context = getContext.apply(this, args);
              if (args[0] === 'webgl' && context && !context.__probe) {
                context.__probe = true;
                const drawArrays = context.drawArrays.bind(context);
                context.drawArrays = (...drawArgs) => {
                  drawArrays(...drawArgs);
                  window.probe.draws++;
                  if (readback && !window.probe.readback) {
                    const pixels = new Uint8Array(context.drawingBufferWidth * context.drawingBufferHeight * 4);
                    context.readPixels(0, 0, context.drawingBufferWidth, context.drawingBufferHeight, context.RGBA, context.UNSIGNED_BYTE, pixels);
                    let colored = 0;
                    for (let index = 0; index < pixels.length; index += 4) if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 50) colored++;
                    window.probe.readback = { colored, error: context.getError() };
                  }
                };
              }
              return context;
            };
            const requestFrame = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = callback => requestFrame(time => {
              window.probe.raf++;
              callback(time);
            });
          }, variant === 'readback');
          try {
            await page.goto(`${base}/${variant}/webgl/index.html`);
            await page.waitForSelector('.choam-universe--ready', { state: 'attached', timeout: 10000 });
            await page.waitForTimeout(150);
            await capture(page, headless, variant, 'ready', errors);
            if (variant === 'original') {
              await page.setViewportSize({ width: 961, height: 601 });
              await page.waitForTimeout(150);
              await capture(page, headless, variant, 'resized', errors);
            }
          } catch (error) {
            record({ headless, variant, error: error.message, errors });
          } finally { await page.close(); }
        }
        for (const variant of ['svg-original', 'svg-no-preload', 'svg-no-media']) {
          const page = await browser.newPage({ viewport: { width: 960, height: 600 }, reducedMotion: 'no-preference' });
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          try {
            await page.goto(`${base}/${variant}/svg/index.html`);
            if (variant !== 'svg-no-preload') await page.evaluate(async () => {
              const image = new Image();
              image.src = getComputedStyle(document.body).backgroundImage.slice(5, -2);
              await image.decode();
            });
            const first = await capture(page, headless, variant, 'first', errors);
            await page.waitForTimeout(1200);
            const second = await capture(page, headless, variant, 'second', errors);
            record({ headless, variant, changedPixels: changedPixels(first, second) });
            await page.goto(`${base}/${variant}/svg/arrakis-orbit.svg`);
            const directFirst = await capture(page, headless, variant, 'direct-first', errors);
            await page.waitForTimeout(1200);
            const directSecond = await capture(page, headless, variant, 'direct-second', errors);
            record({ headless, variant, directChangedPixels: changedPixels(directFirst, directSecond), animations: await page.evaluate(() => document.getAnimations().map(animation => ({ playState: animation.playState, currentTime: animation.currentTime }))) });
          } catch (error) { record({ headless, variant, error: error.message, errors }); }
          finally { await page.close(); }
        }
      } finally { await browser.close(); }
    }
  } finally {
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

function replaceOnce(body, search, replacement) {
  if (!body.includes(search) || body.indexOf(search) !== body.lastIndexOf(search)) throw new Error(`Expected exactly one diagnostic mutation: ${search}`);
  return body.replace(search, replacement);
}

async function capture(page, headless, variant, phase, errors) {
  const screenshot = await page.screenshot({ path: path.join(output, `${headless ? 'headless' : 'headed'}-${variant}-${phase}.png`) });
  const png = PNG.sync.read(screenshot);
  let colored = 0;
  let warm = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const [red, green, blue] = png.data.subarray(index, index + 3);
    if (Math.max(red, green, blue) > 50) colored++;
    if (red > 40 && red > green * 1.2 && green > blue * 1.2) warm++;
  }
  const state = await page.evaluate(() => ({
    probe: window.probe,
    hidden: document.hidden,
    focus: document.hasFocus(),
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    background: getComputedStyle(document.body || document.documentElement).backgroundImage,
    opacity: document.querySelector('canvas') && getComputedStyle(document.querySelector('canvas')).opacity,
  }));
  record({ headless, variant, phase, colored, warm, state, errors });
  return png;
}

function changedPixels(first, second) {
  if (first.width !== second.width || first.height !== second.height) throw new Error('Screenshot dimensions differ');
  let changed = 0;
  for (let index = 0; index < first.data.length; index += 4) if ([0, 1, 2].some(channel => first.data[index + channel] !== second.data[index + channel])) changed++;
  return changed;
}

function record(result) {
  results.push(result);
  console.log(JSON.stringify(result));
}
