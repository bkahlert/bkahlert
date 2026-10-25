// src/scene.css
var scene_default = ".orbit-1984 {\n  position: absolute;\n  inset: 0;\n  overflow: hidden;\n  pointer-events: none;\n  background: #020206;\n  contain: strict;\n  container-type: size;\n}\n\n.orbit-1984 canvas,\n.orbit-1984__still {\n  position: absolute;\n  inset: 0;\n  width: 100%;\n  height: 100%;\n}\n\n.orbit-1984 canvas { opacity: 0; }\n.orbit-1984--ready canvas { opacity: 1; }\n.orbit-1984--ready .orbit-1984__still { visibility: hidden; }\n.orbit-1984__still {\n  background:\n    radial-gradient(ellipse at 43% 38%, #4e0d2d80, transparent 45%),\n    linear-gradient(23deg, transparent 35%, #7b152640 53%, transparent 65%),\n    #020206;\n}\n\n.orbit-1984__still i {\n  position: absolute;\n  left: calc(21% - 53cqmin);\n  top: calc(88% - 53cqmin);\n  width: 106cqmin;\n  height: 106cqmin;\n  border-radius: 50%;\n  background: radial-gradient(circle at 76% 65%, #040306 48%, #40150c 65%, #c56b2a 84%, #ffad65);\n  box-shadow: -2px -2px 12px #f3933c50;\n}\n\n.orbit-1984__still i:nth-child(2),\n.orbit-1984__still i:nth-child(3) {\n  left: calc(75% - 12.5cqmin);\n  top: calc(24% - 12.5cqmin);\n  width: 25cqmin;\n  height: 25cqmin;\n  background: radial-gradient(circle at 25% 32%, #81d8ed, #246780 55%, #071622 88%);\n  box-shadow: 0 0 12px #3aabc61a;\n}\n\n.orbit-1984__still i:nth-child(3) {\n  left: calc(58% - 4.3cqmin);\n  top: calc(47% - 4.3cqmin);\n  width: 8.6cqmin;\n  height: 8.6cqmin;\n}\n\n@container (max-aspect-ratio: 4/5) {\n  .orbit-1984__still i:first-child { left: calc(16% - 53cqmin); }\n}\n";

// src/renderer.js
function mountOrbit(container, {
  assetBase = new URL("./assets/", import.meta.url).href,
  paused: initiallyPaused = false
} = {}) {
  const root = document.createElement("div");
  const style = document.createElement("style");
  style.textContent = scene_default;
  root.append(style);
  root.className = "orbit-1984 orbit-1984--loading";
  root.setAttribute("aria-hidden", "true");
  root.insertAdjacentHTML("beforeend", '<div class="orbit-1984__still"><i></i><i></i><i></i></div><canvas></canvas>');
  container.append(root);
  const canvas = root.querySelector("canvas");
  const events = new AbortController();
  let disposed = false;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  function listen(target, type, handler) {
    target.addEventListener(type, handler, { signal: events.signal });
  }
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const touchInput = matchMedia("(hover: none) and (pointer: coarse)");
  let paused = initiallyPaused;
  let focused = document.hasFocus() || touchInput.matches;
  let pagePresent = true;
  let contextLost = false;
  let frame = null;
  let previousTimestamp = null;
  let lastDraw = null;
  let sceneTime = 0;
  let renderedSceneTime = 0;
  let speed = 0;
  let transitionStartSpeed = 0;
  let targetSpeed = 0;
  let transitionElapsed = 0;
  let resizePending = true;
  let renderer = null;
  let loading = true;
  let generation = 0;
  let imagesPromise;
  function updateState() {
    root.classList.toggle("orbit-1984--loading", loading);
  }
  function motionAllowed() {
    if (disposed || document.hidden || paused || reducedMotion.matches || contextLost) return false;
    return pagePresent && Boolean(renderer);
  }
  function active() {
    return motionAllowed() && (focused || speed > 0);
  }
  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    previousTimestamp = null;
    sceneTime = renderedSceneTime;
    lastDraw = null;
    speed = 0;
    transitionStartSpeed = 0;
    targetSpeed = 0;
    transitionElapsed = 0;
  }
  function syncActivity() {
    if (resizePending && focused && pagePresent && !document.hidden) draw();
    if (motionAllowed()) {
      const nextSpeed = focused ? 1 : 0;
      if (nextSpeed !== targetSpeed) {
        transitionStartSpeed = speed;
        targetSpeed = nextSpeed;
        transitionElapsed = 0;
      }
    }
    if (active()) {
      if (frame === null) frame = requestAnimationFrame(tick);
    } else stop();
    updateState();
  }
  function draw() {
    if (!renderer || contextLost || disposed) return;
    if (resizePending) {
      const width = root.clientWidth;
      const height = root.clientHeight;
      const budget = width < 700 ? 11e5 : 22e5;
      const scale = Math.min(
        devicePixelRatio || 1,
        2,
        Math.sqrt(budget / (width * height)),
        renderer.maxSize / width,
        renderer.maxSize / height
      );
      canvas.width = Math.max(1, Math.floor(width * scale));
      canvas.height = Math.max(1, Math.floor(height * scale));
      resizePending = false;
    }
    renderer.draw(sceneTime);
    renderedSceneTime = sceneTime;
  }
  function tick(timestamp) {
    frame = null;
    if (!active()) return;
    if (previousTimestamp !== null) {
      const frameElapsed = (timestamp - previousTimestamp) / 1e3;
      const elapsed = Math.min(frameElapsed, 0.1);
      transitionElapsed = Math.min(0.65, transitionElapsed + frameElapsed);
      const progress = transitionElapsed / 0.65;
      const eased = progress * progress * (3 - 2 * progress);
      speed = transitionStartSpeed + (targetSpeed - transitionStartSpeed) * eased;
      sceneTime += elapsed * speed;
    }
    previousTimestamp = timestamp;
    if (lastDraw === null || timestamp - lastDraw >= 1e3 / 30 || resizePending || !active()) {
      draw();
      lastDraw = timestamp;
    }
    if (active()) frame = requestAnimationFrame(tick);
    else stop();
  }
  listen(window, "blur", () => {
    focused = false;
    syncActivity();
  });
  listen(window, "focus", () => {
    focused = true;
    syncActivity();
  });
  listen(document, "visibilitychange", () => {
    focused = document.hasFocus() || touchInput.matches && !document.hidden;
    syncActivity();
  });
  listen(window, "pagehide", () => {
    pagePresent = false;
    syncActivity();
  });
  listen(window, "pageshow", () => {
    pagePresent = true;
    focused = document.hasFocus() || touchInput.matches && !document.hidden;
    syncActivity();
  });
  listen(reducedMotion, "change", syncActivity);
  listen(window, "resize", () => {
    resizePending = true;
    if (!document.hidden && focused && !active()) draw();
  });
  listen(canvas, "webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    loading = false;
    root.classList.remove("orbit-1984--ready");
    syncActivity();
    resolveReady();
  });
  listen(canvas, "webglcontextrestored", initialize);
  async function initialize() {
    const currentGeneration = ++generation;
    contextLost = false;
    loading = true;
    renderer = null;
    stop();
    updateState();
    try {
      const gl = canvas.getContext("webgl", {
        // Paused and reduced-motion scenes retain their last frame between paints.
        preserveDrawingBuffer: true,
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "low-power"
      });
      if (!gl) {
        loading = false;
        syncActivity();
        resolveReady();
        return;
      }
      imagesPromise ||= Promise.all(["arrakis.jpg", "moon.jpg"].map((file) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Planet texture unavailable"));
        image.src = `${assetBase}${file}`;
      })));
      const images = await imagesPromise;
      if (disposed || currentGeneration !== generation || contextLost) return;
      renderer = createRenderer(canvas, gl, images);
      resizePending = true;
      draw();
      root.classList.add("orbit-1984--ready");
    } catch (error) {
      if (disposed || currentGeneration !== generation || contextLost) return;
      root.dataset.error = error.message;
      renderer = null;
      root.classList.remove("orbit-1984--ready");
    }
    loading = false;
    syncActivity();
    resolveReady();
  }
  function createRenderer(target, gl, images) {
    const vertexSource = `
      attribute vec2 a_position;
      void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
    `;
    const fragmentSource = `
      precision highp float;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform sampler2D u_arrakis;
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
        vec2 p = (uv + vec2(u_time * 0.0009, u_time * 0.00024) * depth) * scale;
        vec2 cell = floor(p), f = fract(p) - 0.5;
        float seed = hash(cell);
        vec2 delta = f - (vec2(hash(cell + 17.0), hash(cell + 37.0)) - 0.5) * 0.75;
        float size = mix(0.016, 0.048, pow(seed, 8.0));
        float point = exp(-dot(delta, delta) / (size * size));
        float halo = exp(-length(delta) * 28.0) * 0.035;
        vec3 tint = mix(vec3(0.33, 0.58, 0.79), vec3(0.88, 0.67, 0.48), hash(cell + 51.0));
        return tint * (point + halo) * step(0.925, seed);
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
        bool moon = kind > 0.5;
        vec3 atmosphere = moon ? vec3(0.16, 0.69, 0.94) : vec3(1.0, 0.30, 0.055);
        float rimLight = pow(max(dot(normalize(vec3(q, 0.04)), light), 0.0), 1.2);
        if (distance > 1.0) {
          float halo = exp(-(distance - 1.0) * 130.0) * 0.65
                     + exp(-(distance - 1.0) * 32.0) * 0.13
                     + exp(-(distance - 1.0) * 9.0) * 0.012;
          return background + atmosphere * halo * rimLight * (moon ? 0.35 : 1.0);
        }
        vec3 normal = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
        vec3 surface = normal;
        float tilt = moon ? -0.37 : 0.3;
        surface.xy = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * surface.xy;
        float angle = u_time * 0.0045 + (moon ? kind * 1.7 : 0.9);
        surface.xz = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * surface.xz;
        vec2 mapUV = sphereUV(surface);
        float daylight = max(dot(normal, light), 0.0);
        vec3 shaded;
        if (moon) {
          float rock = texture2D(u_moon, mapUV).r;
          rock = smoothstep(0.18, 0.76, rock);
          vec3 albedo = mix(vec3(0.018, 0.105, 0.18), vec3(0.42, 0.93, 1.0), rock);
          shaded = albedo * (0.12 + 1.08 * pow(daylight, 0.48));
          shaded += vec3(0.08, 0.32, 0.49) * pow(1.0 - normal.z, 4.0) * daylight * 0.35;
        } else {
          vec3 map = texture2D(u_arrakis, mapUV).rgb;
          float rock = dot(map, vec3(0.3, 0.58, 0.12));
          float relief = smoothstep(0.20, 0.85, rock);
          vec3 albedo = mix(vec3(0.16, 0.040, 0.012), vec3(1.0, 0.59, 0.25), relief);
          shaded = albedo * (0.004 + 1.35 * pow(daylight, 0.65));
          shaded += atmosphere * pow(1.0 - normal.z, 3.3) * pow(daylight, 0.6) * 0.6;
          shaded += vec3(0.045, 0.006, 0.028) * pow(max(dot(normal, normalize(vec3(0.6, -0.5, 0.2))), 0.0), 2.0);
        }
        float edge = smoothstep(1.0 - 1.6 / (u_resolution.y * radius), 1.0, distance);
        return mix(shaded, background, edge);
      }
      vec3 plume(vec2 uv, float seconds) {
        float t = seconds * 0.014;
        vec2 p = vec2(-uv.x * 0.9, uv.y + 0.08);
        float bend = fbm(vec3(p * 2.5, 3.1));
        float ribbon = p.y - p.x * 0.38 + 0.04 + (bend - 0.5) * 0.23;
        vec3 field = vec3(p.x * 2.6 + t, p.y * 4.4, 2.8);
        float broad = fbm(field);
        float detail = fbm(field * 3.1 + vec3(broad * 2.5, 0.0, 7.0));
        float narrow = exp(-pow((ribbon + (detail - 0.5) * 0.20) * 6.0, 2.0));
        float haze = exp(-pow(ribbon * 3.6, 2.0));
        float cloud = smoothstep(0.26, 0.75, broad * 0.55 + detail * 0.70);
        float wisps = pow(max(0.0, detail - 0.25), 1.6) * 3.2;
        float dust = smoothstep(0.31, 0.63, fbm(field * 1.7 + vec3(8.0, 4.0, 2.0)));
        float hot = exp(-pow((ribbon + 0.045) * 14.0, 2.0));
        vec3 outer = vec3(0.52, 0.045, 0.24);
        vec3 inner = vec3(1.0, 0.10, 0.15);
        vec3 core = vec3(1.0, 0.32, 0.12);
        vec3 gas = outer * haze * cloud * 0.72;
        gas += inner * narrow * wisps * 0.90;
        gas += core * hot * cloud * 0.67;
        gas *= 0.34 + 0.85 * dust;
        float falloff = exp(-pow((p.x - 0.2) * 0.6, 2.0));
        return gas * falloff;
      }
      void main() {
        float aspect = u_resolution.x / u_resolution.y;
        float unit = min(aspect, 1.0);
        vec2 uv = (gl_FragCoord.xy - u_resolution * 0.5) / u_resolution.y;
        vec2 drift = vec2(sin(u_time * 0.036), sin(u_time * 0.026)) * 0.006;
        vec2 sky = uv + drift;
        float cloudTime = u_time * 0.67;
        vec2 cloudDrift = vec2(sin(cloudTime * 0.036), sin(cloudTime * 0.026)) * 0.006;
        vec3 gas = plume(uv + cloudDrift, cloudTime);
        vec3 color = vec3(0.0015, 0.0020, 0.0050) + gas;
        color += (stars(sky, 58.0, 0.45) * 0.38 + stars(sky, 25.0, 1.0) * 0.68)
          * (1.0 - min(0.8, length(gas)));
        vec2 eclipse = position(aspect < 0.8 ? 0.16 : 0.21, 0.88, aspect) - drift;
        float corona = length(uv - eclipse) / (0.53 * unit);
        color += vec3(0.55, 0.10, 0.055) * exp(-abs(corona - 1.0) * 18.0) * 0.20;
        color = planet(color, uv, position(0.75, 0.24, aspect) + drift,
          0.125 * unit, 1.0, normalize(vec3(-0.68, 0.20, 0.64)));
        color = planet(color, uv, position(0.58, 0.47, aspect), 0.043 * unit, 2.0, normalize(vec3(-0.5, 0.3, 0.8)));
        color = planet(color, uv, eclipse, 0.53 * unit, 0.0, normalize(vec3(0.44, 0.74, -0.40)));
        float vignette = 1.0 - smoothstep(0.20, 0.76, length(uv / vec2(aspect, 1.0))) * 0.35;
        float grain = (hash(gl_FragCoord.xy + floor(u_time * 8.0)) - 0.5) / 255.0;
        color = max(vec3(0.0), color * vignette + grain);
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    const shaders = [];
    const textures = [];
    let program;
    let buffer;
    function disposeResources() {
      shaders.splice(0).forEach((shader) => gl.deleteShader(shader));
      textures.splice(0).forEach((texture) => gl.deleteTexture(texture));
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      buffer = null;
      program = null;
    }
    function compile(type, source) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || "Background shader unavailable");
      }
      return shader;
    }
    try {
      const vertex = compile(gl.VERTEX_SHADER, vertexSource);
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      shaders.splice(0).forEach((shader) => gl.deleteShader(shader));
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error("Background shader unavailable");
      }
      gl.useProgram(program);
      const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic");
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      images.forEach((image, index) => {
        let source = image;
        if (image.width > maxTextureSize) {
          source = document.createElement("canvas");
          source.width = maxTextureSize;
          source.height = image.height * maxTextureSize / image.width;
          source.getContext("2d").drawImage(image, 0, 0, source.width, source.height);
        }
        gl.activeTexture(gl.TEXTURE0 + index);
        const texture = gl.createTexture();
        textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        if (anisotropy) gl.texParameterf(
          gl.TEXTURE_2D,
          anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(4, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT))
        );
        gl.uniform1i(gl.getUniformLocation(program, ["u_arrakis", "u_moon"][index]), index);
      });
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const attribute = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
      const resolution = gl.getUniformLocation(program, "u_resolution");
      const time = gl.getUniformLocation(program, "u_time");
      return {
        maxSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        dispose: disposeResources,
        draw(seconds) {
          gl.viewport(0, 0, target.width, target.height);
          gl.uniform2f(resolution, target.width, target.height);
          gl.uniform1f(time, seconds);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      };
    } catch (error) {
      disposeResources();
      throw error;
    }
  }
  const observer = new ResizeObserver(() => {
    resizePending = true;
    if (!document.hidden && focused && !active()) draw();
  });
  observer.observe(container.host || container);
  void initialize();
  return {
    root,
    ready,
    /** Sets explicit pause independently of focus and reduced motion. */
    setPaused(value) {
      paused = Boolean(value);
      syncActivity();
    },
    /** Releases resources and settles ready, including pending initialization. */
    dispose() {
      if (disposed) return;
      disposed = true;
      resolveReady();
      generation++;
      stop();
      events.abort();
      observer.disconnect();
      renderer?.dispose();
      renderer = null;
      root.remove();
    }
  };
}

// src/component.js
var ArrakisOrbit1984 = class extends HTMLElement {
  static observedAttributes = ["paused"];
  #controller;
  #resolveReady;
  #ready;
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ":host { display:block; position:relative; overflow:hidden; }";
    this.shadowRoot.append(style);
    this.#resetReady();
  }
  #resetReady() {
    this.#ready = new Promise((resolve) => {
      this.#resolveReady = resolve;
    });
  }
  connectedCallback() {
    if (this.#controller) return;
    this.#controller = mountOrbit(this.shadowRoot, {
      assetBase: new URL("./assets/", import.meta.url).href,
      paused: this.paused
    });
    const resolve = this.#resolveReady;
    this.#controller.ready.then(resolve);
  }
  disconnectedCallback() {
    this.#controller?.dispose();
    this.#controller = void 0;
    this.#resolveReady();
    this.#resetReady();
  }
  attributeChangedCallback() {
    this.#controller?.setPaused(this.paused);
  }
  /** Returns a promise settled after this connection initializes, falls back, or disconnects. */
  get ready() {
    return this.#ready;
  }
  /** Returns the instance's explicit pause state. */
  get paused() {
    return this.hasAttribute("paused");
  }
  /** Sets explicit pause without affecting other instances. */
  set paused(value) {
    this.toggleAttribute("paused", Boolean(value));
  }
  /** Pauses this instance. */
  pause() {
    this.paused = true;
  }
  /** Resumes this instance unless reduced motion or page state prevents animation. */
  resume() {
    this.paused = false;
  }
};
if (!customElements.get("arrakis-orbit-1984")) customElements.define("arrakis-orbit-1984", ArrakisOrbit1984);
export {
  ArrakisOrbit1984
};
