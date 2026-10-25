const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { chromium, webkit } = require('playwright')
const { instrument } = require('./instrument.cjs')

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  describe(`${name} component`, () => {
    let browser
    before(async () => {
      browser = await engine.launch()
    })
    after(async () => {
      await browser.close()
    })

    it('isolates sized instances, pause state, and shadow styles', async () => {
      const page = await setup(browser)
      const result = await page.evaluate(() => {
        const [first, second] = document.querySelectorAll('arrakis-orbit')
        fixture.advance(100)
        return {
          sizes: [first, second].map(element => {
            const canvas = element.shadowRoot.querySelector('canvas')
            return [canvas.width, canvas.height]
          }),
          canvases: document.querySelectorAll('canvas').length,
          controls: document.querySelectorAll('button,a').length,
          pending: fixture.pending.size,
          colors: [first, second].map(element => getComputedStyle(element.shadowRoot.querySelector('canvas')).backgroundColor),
        }
      })
      assert.deepEqual(result.sizes, [[320, 240], [200, 300]])
      assert.equal(result.canvases, 0)
      assert.equal(result.controls, 0)
      assert.equal(result.pending, 2)
      assert.deepEqual(result.colors, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'])
      const paused = await page.evaluate(() => {
        const [first, second] = document.querySelectorAll('arrakis-orbit')
        first.paused = true
        fixture.focus(false)
        fixture.focus(true)
        return { first: first.paused, second: second.paused, pending: fixture.pending.size }
      })
      assert.deepEqual(paused, { first: true, second: false, pending: 1 })
      await page.close()
    })

    it('resizes a paused instance from its container', async () => {
      const page = await setup(browser);
      await page.evaluate(async () => {
        const element = document.querySelector('arrakis-orbit');
        const resized = new Promise(resolve => {
          const observer = new ResizeObserver(() => {
            if (element.clientWidth === 180 && element.clientHeight === 270) {
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(element);
        });
        element.paused = true;
        element.style.width = '180px';
        element.style.height = '270px';
        await resized;
      });
      const size = await page.locator('arrakis-orbit').first().locator('canvas')
        .evaluate(canvas => [canvas.width, canvas.height]);
      assert.deepEqual(size, [180, 270]);
      await page.close();
    });

    it('disposes resources and reconnects without duplicate loops', async () => {
      const page = await setup(browser)
      const removed = await page.evaluate(() => {
        window.saved = [...document.querySelectorAll('arrakis-orbit')]
        saved.forEach(element => element.remove())
        fixture.advance(1000)
        dispatchEvent(new Event('focus'))
        return {
          pending: fixture.pending.size,
          deleted: window.deleted,
          canvases: saved.map(element => element.shadowRoot.querySelectorAll('canvas').length),
        }
      })
      assert.equal(removed.pending, 0)
      assert.deepEqual(removed.canvases, [0, 0])
      assert.deepEqual(removed.deleted, { textures: 6, programs: 2, buffers: 2 })
      await page.evaluate(() => document.body.append(...saved))
      await page.waitForFunction(() => [...document.querySelectorAll('arrakis-orbit')].every(element => element.shadowRoot.querySelector('.choam-universe--ready')))
      const connected = await page.evaluate(() => ({
        pending: fixture.pending.size,
        canvases: saved.map(element => element.shadowRoot.querySelectorAll('canvas').length),
      }))
      assert.deepEqual(connected, { pending: 2, canvases: [1, 1] })
      await page.close()
    })

    it('cancels delayed initialization after removal', async () => {
      let release
      const deferred = new Promise(resolve => {
        release = resolve
      })
      const page = await setup(browser, deferred, false)
      await page.evaluate(() => {
        window.saved = [...document.querySelectorAll('arrakis-orbit')]
        saved.forEach(element => element.remove())
      })
      release()
      await page.waitForLoadState('networkidle')
      const result = await page.evaluate(() => ({
        pending: fixture.pending.size,
        draws: fixture.draws,
        canvases: saved.map(element => element.shadowRoot.querySelectorAll('canvas').length),
      }))
      assert.deepEqual(result, { pending: 0, draws: 0, canvases: [0, 0] })
      await page.close()
    })

    it('selects each retained composition at connection', async () => {
      const page = await setup(browser)
      await page.evaluate(() => document.querySelectorAll('arrakis-orbit')[1].remove())
      const captures = []
      for (const scene of ['conjunction', 'eclipse', 'deep-field']) {
        await page.evaluate(scene => {
          const element = document.querySelector('arrakis-orbit')
          element.remove()
          element.setAttribute('scene', scene)
          element.paused = true
          document.body.append(element)
        }, scene)
        await page.locator('.choam-universe--ready').waitFor()
        captures.push(await page.locator('arrakis-orbit').screenshot())
      }
      assert.equal(captures[0].equals(captures[1]), false)
      assert.equal(captures[1].equals(captures[2]), false)
      assert.equal(captures[0].equals(captures[2]), false)
      await page.close()
    })

    it('releases compiled shaders when fragment compilation fails', async () => {
      const page = await setup(browser, null, false, null, 'fragment')
      await page.waitForFunction(() => [...document.querySelectorAll('arrakis-orbit')].every(element =>
        !element.shadowRoot.querySelector('.choam-universe--loading')), null, { polling: 25 })
      const result = await page.evaluate(() => {
        document.querySelectorAll('arrakis-orbit').forEach(element => element.remove())
        return { resources: shaderResources, pending: fixture.pending.size }
      })
      assert.deepEqual(result.resources, { created: 4, deleted: 4 })
      assert.equal(result.pending, 0)
      await page.close()
    })

    for (const failure of ['link', 'texture']) {
      it(`releases partial resources on ${failure} failure`, async () => {
        const page = await setup(browser, null, false, null, failure)
        await page.waitForFunction(() => [...document.querySelectorAll('arrakis-orbit')].every(element =>
          !element.shadowRoot.querySelector('.choam-universe--loading')), null, { polling: 25 })
        const result = await page.evaluate(() => {
          const ready = document.querySelector('arrakis-orbit').shadowRoot.querySelector('.choam-universe--ready')
          document.querySelectorAll('arrakis-orbit').forEach(element => element.remove())
          return { ready: Boolean(ready), shaders: shaderResources, deleted, pending: fixture.pending.size }
        })
        assert.equal(result.ready, false)
        assert.deepEqual(result.shaders, { created: 4, deleted: 4 })
        assert.deepEqual(result.deleted, { textures: failure === 'texture' ? 2 : 0, programs: 2, buffers: 0 })
        assert.equal(result.pending, 0)
        await page.close()
      })
    }

    it('bounds textures and drawing buffers to device limits', async () => {
      const page = await setup(browser, null, true, 128)
      const result = await page.evaluate(() => [...document.querySelectorAll('arrakis-orbit')].map(element => {
        const canvas = element.shadowRoot.querySelector('canvas')
        return { width: canvas.width, height: canvas.height, error: canvas.getContext('webgl').getError() }
      }))
      assert.ok(result.every(size => size.width <= 128 && size.height <= 128), JSON.stringify(result))
      assert.ok(result.every(size => size.error === 0))
      const textures = await page.evaluate(() => fixture.textures)
      assert.ok(textures.every(([width, height]) => width <= 128 && height <= 128))
      await page.close()
    })
  })
}

async function setup(browser, deferred = null, waitReady = true, gpuLimit = null, failFragment = 'none') {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  await page.route('http://orbit.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/') return route.fulfill({
      contentType: 'text/html',
      body: '<html lang="en"><head><style>canvas{background:red !important}</style></head><body><arrakis-orbit style="width:320px;height:240px"></arrakis-orbit><arrakis-orbit style="width:200px;height:300px"></arrakis-orbit><script type="module" src="webcomponent/arrakis-orbit.js"></script></body></html>',
    })
    if (pathname.endsWith('.jpg') && deferred) await deferred
    const file = path.join(__dirname, '..', pathname)
    const body = await readFile(file)
    return route.fulfill({ body, contentType: pathname.endsWith('.js') ? 'text/javascript' : 'image/jpeg' })
  })
  await page.addInitScript(instrument, { gpuLimit })
  await page.addInitScript(failFragment => {
    window.shaderResources = { created: 0, deleted: 0 }
    const prototype = WebGLRenderingContext.prototype
    const create = prototype.createShader
    prototype.createShader = function (type) {
      shaderResources.created++
      return create.call(this, type)
    }
    const dispose = prototype.deleteShader
    prototype.deleteShader = function (shader) {
      shaderResources.deleted++
      return dispose.call(this, shader)
    }
    const parameter = prototype.getShaderParameter
    prototype.getShaderParameter = function (shader, name) {
      if (failFragment === 'fragment' && name === this.COMPILE_STATUS && parameter.call(this, shader, this.SHADER_TYPE) === this.FRAGMENT_SHADER) return false
      return parameter.call(this, shader, name)
    }
    if (failFragment === 'texture') {
      prototype.texImage2D = function () {
        throw new Error('Texture upload failed')
      }
    }
    if (failFragment === 'link') {
      const parameter = prototype.getProgramParameter
      prototype.getProgramParameter = function (program, name) {
        return name === this.LINK_STATUS ? false : parameter.call(this, program, name)
      }
    }
    window.deleted = { textures: 0, programs: 0, buffers: 0 }
    for (const [method, key] of [['deleteTexture', 'textures'], ['deleteProgram', 'programs'], ['deleteBuffer', 'buffers']]) {
      const original = WebGLRenderingContext.prototype[method]
      WebGLRenderingContext.prototype[method] = function (value) {
        deleted[key]++
        return original.call(this, value)
      }
    }
  }, failFragment)
  await page.goto('http://orbit.test/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => [...document.querySelectorAll('arrakis-orbit')].every(element => element.shadowRoot?.querySelector('canvas')))
  if (waitReady) await page.waitForFunction(() => [...document.querySelectorAll('arrakis-orbit')].every(element => element.shadowRoot.querySelector('.choam-universe--ready')))
  return page
}
