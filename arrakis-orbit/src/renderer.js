import styles from './scene.css'

/** Mounts a decorative Eclipse scene in a sized container. Disposing releases its listeners and GPU resources. */
export function mountOrbit(container, {
  assetBase = new URL('assets/', document.baseURI).href,
  scene: requestedScene = 'eclipse',
  paused: initiallyPaused = false,
} = {}) {
  const sceneNames = ['conjunction', 'eclipse', 'deep-field']
  const scene = Math.max(0, sceneNames.indexOf(requestedScene))
  const style = document.createElement('style')
  style.textContent = styles
  const root = document.createElement('div')
  root.className = 'choam-universe choam-universe--loading'
  root.setAttribute('aria-hidden', 'true')
  root.innerHTML = '<div class="choam-universe__still"><i></i><i></i><i></i></div><canvas></canvas>'
  container.append(style, root)
  const canvas = root.querySelector('canvas')
  const events = new AbortController()
  let disposed = false

  function listen(target, type, handler) {
    target.addEventListener(type, handler, { signal: events.signal })
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const touchInput = matchMedia('(hover: none) and (pointer: coarse)')
  let paused = initiallyPaused
  // iOS Safari may not focus a newly navigated document until its first touch.
  let focused = document.hasFocus() || touchInput.matches
  let pagePresent = true
  let contextLost = false
  let frame = null
  let previousTimestamp = null
  let lastDraw = null
  let sceneTime = 0
  let renderedSceneTime = 0
  let speed = 0
  let transitionStartSpeed = 0
  let targetSpeed = 0
  let transitionElapsed = 0
  let resizePending = true
  let renderer = null
  let loading = true
  let generation = 0
  let imagesPromise

  function updateState() {
    root.classList.toggle('choam-universe--loading', loading)
  }

  function motionAllowed() {
    if (disposed || document.hidden || paused || reducedMotion.matches || contextLost) return false
    return pagePresent && Boolean(renderer)
  }

  function active() {
    return motionAllowed() && (focused || speed > 0)
  }

  function stop() {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    previousTimestamp = null
    sceneTime = renderedSceneTime
    lastDraw = null
    speed = 0
    transitionStartSpeed = 0
    targetSpeed = 0
    transitionElapsed = 0
  }

  function syncActivity() {
    if (resizePending && focused && pagePresent && !document.hidden) draw()
    if (motionAllowed()) {
      const nextSpeed = focused ? 1 : 0
      if (nextSpeed !== targetSpeed) {
        transitionStartSpeed = speed
        targetSpeed = nextSpeed
        transitionElapsed = 0
      }
    }
    if (active()) {
      if (frame === null) frame = requestAnimationFrame(tick)
    } else stop()
    updateState()
  }

  function draw() {
    if (!renderer || contextLost || disposed) return
    if (resizePending) {
      const width = root.clientWidth
      const height = root.clientHeight
      const budget = width < 700 ? 1800000 : 3600000
      const scale = Math.min(devicePixelRatio || 1, 2, Math.sqrt(budget / (width * height)), renderer.maxSize / width, renderer.maxSize / height)
      canvas.width = Math.max(1, Math.floor(width * scale))
      canvas.height = Math.max(1, Math.floor(height * scale))
      resizePending = false
    }
    renderer.draw(sceneTime, scene)
    renderedSceneTime = sceneTime
  }

  function tick(timestamp) {
    frame = null
    if (!active()) return
    if (previousTimestamp !== null) {
      // Discard suspended time, including an OS sleep without a visibility event.
      const frameElapsed = (timestamp - previousTimestamp) / 1000
      const elapsed = Math.min(frameElapsed, 0.1)
      transitionElapsed = Math.min(0.65, transitionElapsed + frameElapsed)
      const progress = transitionElapsed / 0.65
      const eased = progress * progress * (3 - 2 * progress)
      speed = transitionStartSpeed + (targetSpeed - transitionStartSpeed) * eased
      sceneTime += elapsed * speed
    }
    previousTimestamp = timestamp
    if (lastDraw === null || timestamp - lastDraw >= 1000 / 30 || resizePending || !active()) {
      draw()
      lastDraw = timestamp
    }
    if (active()) frame = requestAnimationFrame(tick)
    else stop()
  }

  listen(window, 'blur', () => {
    focused = false
    syncActivity()
  })
  listen(window, 'focus', () => {
    focused = true
    syncActivity()
  })
  listen(document, 'visibilitychange', () => {
    focused = document.hasFocus() || (touchInput.matches && !document.hidden)
    syncActivity()
  })
  listen(window, 'pagehide', () => {
    pagePresent = false
    syncActivity()
  })
  listen(window, 'pageshow', () => {
    pagePresent = true
    focused = document.hasFocus() || (touchInput.matches && !document.hidden)
    syncActivity()
  })
  listen(reducedMotion, 'change', syncActivity)
  listen(window, 'resize', () => {
    resizePending = true
    // A static scene still needs to fit a rotated phone; hidden pages wait until return.
    if (!document.hidden && focused && !active()) draw()
  })
  listen(canvas, 'webglcontextlost', event => {
    event.preventDefault()
    contextLost = true
    loading = false
    root.classList.remove('choam-universe--ready')
    syncActivity()
  })
  listen(canvas, 'webglcontextrestored', initialize)

  async function initialize() {
    const currentGeneration = ++generation
    contextLost = false
    loading = true
    renderer = null
    stop()
    updateState()
    try {
      const gl = canvas.getContext('webgl', {
        // Paused and reduced-motion scenes retain their last frame between paints.
        preserveDrawingBuffer: true,
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
      })
      if (!gl) {
        loading = false
        syncActivity()
        return
      }
      imagesPromise ||= Promise.all(['arrakis.jpg', 'caladan-clouds.jpg', 'moon.jpg'].map(file => new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('Planet texture unavailable'))
        image.src = `${assetBase}${file}`
      })))
      const images = await imagesPromise
      if (disposed || currentGeneration !== generation || contextLost) return
      renderer = createRenderer(canvas, gl, images)
      resizePending = true
      draw()
      root.classList.add('choam-universe--ready')
    } catch {
      renderer = null
      root.classList.remove('choam-universe--ready')
    }
    loading = false
    syncActivity()
  }

  function createRenderer(target, gl, images) {
    const vertexSource = `
      attribute vec2 a_position;
      void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
    `
    const fragmentSource = `
      precision highp float;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_scene;
      uniform sampler2D u_arrakis;
      uniform sampler2D u_clouds;
      uniform sampler2D u_moon;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        vec2 q = i.xy + vec2(37.0, 17.0) * i.z;
        float a = mix(hash(q), hash(q + vec2(1, 0)), f.x);
        float b = mix(hash(q + vec2(0, 1)), hash(q + vec2(1, 1)), f.x);
        float c = mix(hash(q + vec2(37, 17)), hash(q + vec2(38, 17)), f.x);
        float d = mix(hash(q + vec2(37, 18)), hash(q + vec2(38, 18)), f.x);
        return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
      }
      float fbm(vec3 p) {
        float value = 0.0, amplitude = 0.5;
        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p);
          p = p * 2.03 + vec3(13.2, 7.1, 5.4);
          amplitude *= 0.5;
        }
        return value;
      }
      vec3 stars(vec2 uv, float scale, float depth) {
        vec2 p = uv * scale + vec2(u_time * 0.025 * depth, u_time * 0.008 * depth);
        vec2 cell = floor(p), f = fract(p) - 0.5;
        float seed = hash(cell);
        vec2 offset = vec2(hash(cell + 17.0), hash(cell + 37.0)) - 0.5;
        vec2 delta = f - offset * 0.75;
        float size = mix(0.012, 0.06, pow(seed, 8.0));
        float dotLight = exp(-dot(delta, delta) / (size * size));
        float halo = exp(-length(delta) * 20.0) * 0.08;
        float twinkle = 0.80 + 0.20 * sin(u_time * (0.25 + seed * 0.4) + seed * 120.0);
        vec3 tint = mix(vec3(0.42, 0.65, 1.0), vec3(1.0, 0.76, 0.43), hash(cell + 51.0));
        float crossLight = 0.0;
        if (seed > 0.996) {
          crossLight = exp(-abs(delta.x) * 160.0 - abs(delta.y) * 12.0)
                     + exp(-abs(delta.y) * 160.0 - abs(delta.x) * 12.0);
        }
        return tint * (dotLight + halo + crossLight * 0.3) * twinkle * step(0.38, seed);
      }
      vec2 position(float x, float y, float aspect) {
        return vec2((x - 0.5) * aspect, 0.5 - y);
      }
      vec2 sphereUV(vec3 surface) {
        return vec2(atan(surface.z, surface.x) / 6.2831853 + 0.5, asin(clamp(surface.y, -1.0, 1.0)) / 3.1415927 + 0.5);
      }
      vec3 planet(vec3 background, vec2 uv, vec2 center, float radius, float kind, vec3 light) {
        vec2 q = (uv - center) / radius;
        float distance = length(q);
        bool ocean = kind > 0.5 && kind < 1.5;
        vec3 atmosphere = kind < 0.5 ? vec3(0.85, 0.43, 0.15) : ocean ? vec3(0.19, 0.40, 0.60) : vec3(0.0);
        float rimLight = max(dot(normalize(vec3(q, 0.04)), light), 0.0);
        if (distance > 1.0) {
          float halo = exp(-(distance - 1.0) * 100.0) * 0.32 + exp(-(distance - 1.0) * 28.0) * 0.035;
          return background + atmosphere * halo * rimLight;
        }
        vec3 normal = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
        vec3 surface = normal;
        // A tilted axis and independent cloud drift keep the motion natural at orbital scale.
        float tilt = ocean ? -0.35 : 0.24;
        surface.xy = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * surface.xy;
        float angle = u_time * (ocean ? 0.008 : 0.005) + (ocean ? 2.4 : 0.7);
        surface.xz = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * surface.xz;
        vec2 mapUV = sphereUV(surface);
        float daylight = max(dot(normal, light), 0.0);
        vec3 shaded;
        if (kind < 0.5) {
          vec3 albedo = pow(texture2D(u_arrakis, mapUV).rgb, vec3(2.2));
          shaded = albedo * (vec3(0.00035) + vec3(1.15, 0.98, 0.72) * daylight);
        } else if (ocean) {
          vec2 cloudUV = mapUV + vec2(u_time * 0.00035, 0.0);
          float cloud = texture2D(u_clouds, cloudUV).r;
          float cloudShadow = texture2D(u_clouds, cloudUV + vec2(-0.003, 0.002)).r;
          vec3 water = vec3(0.003, 0.018, 0.042) * (1.0 - cloudShadow * 0.65);
          float glint = pow(max(dot(normalize(light + vec3(0.0, 0.0, 1.0)), normal), 0.0), 100.0);
          water += vec3(0.30, 0.37, 0.40) * glint * 0.32;
          vec3 albedo = mix(water, vec3(0.22, 0.30, 0.38), pow(cloud, 1.15) * 0.92);
          shaded = albedo * (0.0006 + daylight * 0.58);
        } else {
          float rock = texture2D(u_moon, mapUV).r;
          vec3 albedo = pow(vec3(rock) * vec3(0.76, 0.72, 0.66), vec3(2.2));
          shaded = albedo * (0.0003 + daylight * 0.7);
        }
        float fresnel = pow(1.0 - normal.z, 4.0);
        shaded += pow(atmosphere, vec3(2.2)) * fresnel * pow(daylight, 0.7) * (ocean ? 0.14 : 0.28);
        // Textures are sRGB; lighting is linear and converted once for display.
        shaded = pow(max(shaded, vec3(0.0)), vec3(1.0 / 2.2));
        float edge = smoothstep(1.0 - 1.5 / (u_resolution.y * radius), 1.0, distance);
        return mix(shaded, background, edge);
      }
      void main() {
        float aspect = u_resolution.x / u_resolution.y;
        float unit = min(aspect, 1.0);
        vec2 uv = (gl_FragCoord.xy - u_resolution * 0.5) / u_resolution.y;
        vec2 drift = vec2(sin(u_time * 0.025), cos(u_time * 0.019)) * 0.005;
        vec2 sky = uv + drift;
        vec3 color = vec3(0.006, 0.009, 0.018);
        float cloud = fbm(vec3(sky * 2.6, 2.0));
        float ribbonCoordinate = (sky.y + sky.x * 0.38 + 0.06) * 3.5;
        float ribbon = exp(-ribbonCoordinate * ribbonCoordinate);
        color += mix(vec3(0.045, 0.025, 0.025), vec3(0.018, 0.052, 0.067), smoothstep(-0.5, 0.6, sky.x)) * cloud * ribbon;
        color += stars(sky, 95.0, 0.4) * 0.31;
        color += stars(sky, 47.0, 0.8) * 0.48;
        color += stars(sky, 21.0, 1.3) * 0.72;
        vec3 light = normalize(vec3(-0.65, 0.48, 0.65));
        if (u_scene < 0.5) {
          color = planet(color, uv, position(0.61, 0.12, aspect) + drift * 0.2, 0.038 * unit, 2.0, light);
          color = planet(color, uv, position(aspect < 0.8 ? 0.06 : 0.14, 0.25, aspect) + drift, 0.095 * unit, 1.0, light);
          vec2 arrakis = position(aspect < 0.8 ? 0.99 : 0.84, 0.76, aspect) - drift;
          color = planet(color, uv, arrakis, 0.31 * unit, 0.0, light);
          color = planet(color, uv, arrakis + vec2(-0.30, 0.31) * unit, 0.030 * unit, 2.0, light);
          color = planet(color, uv, arrakis + vec2(0.20, 0.37) * unit, 0.018 * unit, 2.0, light);
        } else if (u_scene < 1.5) {
          vec2 sun = position(0.17, 0.61, aspect);
          float glow = length(uv - sun) / unit;
          color += vec3(0.46, 0.18, 0.035) * exp(-glow * 5.5) * 0.48;
          color = planet(color, uv, position(0.86, 0.20, aspect) + drift, 0.043 * unit, 1.0, normalize(vec3(-0.65, 0.40, 0.25)));
          color = planet(color, uv, position(0.20, 0.84, aspect) - drift, 0.53 * unit, 0.0, normalize(vec3(-0.74, 0.40, -0.35)));
          color = planet(color, uv, position(0.64, 0.50, aspect), 0.023 * unit, 2.0, light);
        } else {
          color += vec3(0.025, 0.035, 0.07) * ribbon * cloud;
          color = planet(color, uv, position(0.12, 0.24, aspect) + drift, 0.098 * unit, 0.0, light);
          color = planet(color, uv, position(0.80, 0.65, aspect) - drift, 0.095 * unit, 1.0, light);
          color = planet(color, uv, position(0.67, 0.14, aspect), 0.047 * unit, 2.0, light);
          color = planet(color, uv, position(0.21, 0.87, aspect), 0.040 * unit, 2.0, light);
        }
        float vignette = 1.0 - smoothstep(0.30, 1.0, length(uv / vec2(aspect, 1.0))) * 0.35;
        gl_FragColor = vec4(color * vignette, 1.0);
      }
    `
    const shaders = []
    const textures = []
    let program
    let buffer

    function disposeResources() {
      shaders.splice(0).forEach(shader => gl.deleteShader(shader))
      textures.splice(0).forEach(texture => gl.deleteTexture(texture))
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
      buffer = null
      program = null
    }

    function compile(type, source) {
      const shader = gl.createShader(type)
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error('Background shader unavailable')
      }
      return shader
    }

    try {
      const vertex = compile(gl.VERTEX_SHADER, vertexSource)
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
      program = gl.createProgram()
      gl.attachShader(program, vertex)
      gl.attachShader(program, fragment)
      gl.linkProgram(program)
      shaders.splice(0).forEach(shader => gl.deleteShader(shader))
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error('Background shader unavailable')
      }
      gl.useProgram(program)
      const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
      const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic')
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      images.forEach((image, index) => {
        let source = image
        if (image.width > maxTextureSize) {
          source = document.createElement('canvas')
          source.width = maxTextureSize
          source.height = image.height * maxTextureSize / image.width
          source.getContext('2d').drawImage(image, 0, 0, source.width, source.height)
        }
        gl.activeTexture(gl.TEXTURE0 + index)
        const texture = gl.createTexture()
        textures.push(texture)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.generateMipmap(gl.TEXTURE_2D)
        if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(4, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))
        gl.uniform1i(gl.getUniformLocation(program, ['u_arrakis', 'u_clouds', 'u_moon'][index]), index)
      })
      buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
      const attribute = gl.getAttribLocation(program, 'a_position')
      gl.enableVertexAttribArray(attribute)
      gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0)
      const resolution = gl.getUniformLocation(program, 'u_resolution')
      const time = gl.getUniformLocation(program, 'u_time')
      const composition = gl.getUniformLocation(program, 'u_scene')
      return {
        maxSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        dispose: disposeResources,
        draw(seconds, variant) {
          gl.viewport(0, 0, target.width, target.height)
          gl.uniform2f(resolution, target.width, target.height)
          gl.uniform1f(time, seconds)
          gl.uniform1f(composition, variant)
          gl.drawArrays(gl.TRIANGLES, 0, 6)
        },
      }
    } catch (error) {
      disposeResources()
      throw error
    }
  }

  const observer = new ResizeObserver(() => {
    resizePending = true
    if (!document.hidden && focused && !active()) draw()
  })
  observer.observe(container.host || container)
  void initialize()
  return {
    root,
    setPaused(value) {
      paused = Boolean(value)
      syncActivity()
    },
    dispose() {
      if (disposed) return
      disposed = true
      generation++
      stop()
      events.abort()
      observer.disconnect()
      renderer?.dispose()
      renderer = null
      root.remove()
      style.remove()
    },
  }
}
