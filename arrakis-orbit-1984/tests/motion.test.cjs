const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const { PNG } = require('pngjs');
const { instrument } = require('./instrument.cjs');

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  describe(`${name} orbital motion`, () => {
    let browser;
    before(async () => { browser = await engine.launch(); });
    after(async () => { await browser.close(); });
    for (const mechanism of ['stars', 'clouds', 'rotation']) {
      it(`${mechanism} changes actual shader pixels independently and rejects frozen motion`, async () => {
        const moving = await compare(browser, mechanism, false);
        const frozen = await compare(browser, mechanism, true);
        assert.ok(moving > 20, `${mechanism}: ${moving} changed pixels`);
        assert.equal(frozen, 0, `${mechanism} negative control is static`);
      });
    }
  });
}

async function compare(browser, mechanism, frozen) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  try {
    await page.route('https://motion.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      let body = await fs.readFile(path.join(__dirname, '..', pathname));
      if (pathname.endsWith('.js')) {
        let source = body.toString();
        source = source.replace('vec2 drift = vec2(sin(u_time * 0.036), sin(u_time * 0.026)) * 0.006;', 'vec2 drift = vec2(0.0);')
          .replace('float grain = (hash(gl_FragCoord.xy + floor(u_time * 8.0)) - 0.5) / 255.0;', 'float grain = 0.0;');
        if (mechanism !== 'stars' || frozen) source = source.replace('u_time * 0.0009, u_time * 0.00024', '0.0, 0.0');
        if (mechanism !== 'clouds' || frozen) source = source.replace('float cloudTime = u_time * 0.67;', 'float cloudTime = 0.0;');
        if (mechanism !== 'rotation' || frozen) source = source.replace('float angle = u_time * 0.0045', 'float angle = 0.0');
        body = source;
      }
      await route.fulfill({ body, contentType: pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.jpg') ? 'image/jpeg' : 'text/html' });
    });
    await page.addInitScript(instrument);
    await page.addInitScript(() => {
      window.sceneSample = 0;
      const uniform = WebGLRenderingContext.prototype.uniform1f;
      WebGLRenderingContext.prototype.uniform1f = function(location) { return uniform.call(this, location, sceneSample); };
    });
    await page.goto('https://motion.test/webgl/index.html');
    await page.evaluate(() => window.orbit.ready);
    assert.equal(await page.locator('.orbit-1984--ready').count(), 1, 'the actual shader compiled');
    const first = await pixels(page);
    await page.evaluate(() => { window.sceneSample = 60; fixture.advance(100); });
    const second = await pixels(page);
    let changed = 0;
    for (let index = 0; index < first.length; index += 4) {
      if ([0, 1, 2].some(channel => Math.abs(first[index + channel] - second[index + channel]) > 3)) changed++;
    }
    return changed;
  } finally { await page.close(); }
}

async function pixels(page) {
  const encoded = await page.locator('canvas').evaluate(canvas => canvas.toDataURL().split(',')[1]);
  return PNG.sync.read(Buffer.from(encoded, 'base64')).data;
}
