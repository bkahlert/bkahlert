// src/scene.js
function mountDesert(root, { assetBase = new URL("./assets/", import.meta.url).href } = {}) {
  const existing = mounts.get(root);
  if (existing) return existing;
  root.classList.add("choam-universe", "choam-universe--loading");
  root.setAttribute("aria-hidden", "true");
  const fallback = new URL("./arrakis-desert-1984-still.svg", import.meta.url).href;
  root.style.setProperty("--still-image", `url("${fallback}")`);
  root.innerHTML = '<div class="choam-universe__still"></div><canvas></canvas>';
  const canvas = root.querySelector("canvas");
  let disposed = false;
  const removers = [];
  function listen(target, name, listener) {
    target.addEventListener(name, listener);
    removers.push(() => target.removeEventListener(name, listener));
  }
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const touchInput = matchMedia("(hover: none) and (pointer: coarse)");
  let paused = false;
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
    root.classList.toggle("choam-universe--loading", loading);
  }
  function motionAllowed() {
    if (document.hidden || paused || reducedMotion.matches || contextLost) return false;
    return !disposed && pagePresent && Boolean(renderer);
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
    if (!renderer || contextLost) return;
    if (resizePending) {
      const width = Math.max(1, root.clientWidth);
      const height = Math.max(1, root.clientHeight);
      const budget = width < 700 ? 18e5 : 36e5;
      const scale = Math.min(
        devicePixelRatio || 1,
        2,
        Math.sqrt(budget / (width * height)),
        renderer.maxDimension / width,
        renderer.maxDimension / height
      );
      canvas.width = Math.max(1, Math.floor(width * scale));
      canvas.height = Math.max(1, Math.floor(height * scale));
      resizePending = false;
    }
    try {
      renderer.draw(sceneTime);
      renderedSceneTime = sceneTime;
    } catch {
      renderer?.dispose();
      renderer = null;
      root.classList.remove("choam-universe--ready");
      stop();
      updateState();
    }
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
    root.classList.remove("choam-universe--ready");
    syncActivity();
  });
  listen(canvas, "webglcontextrestored", initialize);
  async function initialize() {
    if (disposed) return;
    renderer?.dispose();
    const currentGeneration = ++generation;
    contextLost = false;
    loading = true;
    renderer = null;
    stop();
    updateState();
    try {
      const gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "low-power",
        // Paused scenes must retain the last frame after compositing.
        preserveDrawingBuffer: true
      });
      if (!gl) {
        loading = false;
        syncActivity();
        return;
      }
      imagesPromise ||= Promise.all(["moon.jpg"].map((file) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Planet texture unavailable"));
        image.src = `${assetBase}${file}`;
      })));
      const images = await imagesPromise;
      if (currentGeneration !== generation || contextLost || disposed) return;
      renderer = createRenderer(canvas, gl, images);
      resizePending = true;
      draw();
      if (renderer) root.classList.add("choam-universe--ready");
    } catch {
      if (currentGeneration !== generation || contextLost || disposed) return;
      renderer?.dispose();
      renderer = null;
      root.classList.remove("choam-universe--ready");
    }
    loading = false;
    syncActivity();
  }
  const observer = new ResizeObserver(() => {
    resizePending = true;
    if (!document.hidden && pagePresent) draw();
  });
  observer.observe(root);
  const controller = {
    ready: initialize(),
    pause() {
      if (!disposed) {
        paused = true;
        syncActivity();
      }
    },
    resume() {
      if (!disposed) {
        paused = false;
        syncActivity();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      stop();
      observer.disconnect();
      removers.forEach((remove) => remove());
      renderer?.dispose();
      renderer = null;
      mounts.delete(root);
      root.replaceChildren();
      root.classList.remove("choam-universe--ready", "choam-universe--loading");
    }
  };
  mounts.set(root, controller);
  return controller;
}
var mounts = /* @__PURE__ */ new WeakMap();
function createRenderer(target, gl, images) {
  const resources = [];
  const create = (kind) => {
    const value = gl[`create${kind}`]();
    resources.push([kind, value]);
    return value;
  };
  const dispose = () => {
    for (const [kind, value] of resources.splice(0)) gl[`delete${kind}`](value);
  };
  try {
    let program = function(vertexSource, fragmentSource) {
      const result = create("Program");
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const message = gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw new Error(message);
        }
        gl.attachShader(result, shader);
        gl.deleteShader(shader);
      }
      gl.linkProgram(result);
      if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
      return result;
    }, random = function(x, y) {
      const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return value - Math.floor(value);
    }, cloudNoise = function(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const a = random(ix, iy) * (1 - u) + random(ix + 1, iy) * u;
      const b = random(ix, iy + 1) * (1 - u) + random(ix + 1, iy + 1) * u;
      return a * (1 - v) + b * v;
    }, height = function(x, z) {
      const phase = 3.2 + z * 0.063 + x * 0.025 + 1.6 * Math.sin(x * 0.027) + 0.4 * Math.sin(z * 0.018 - x * 0.065);
      const cycle = (phase / (2 * Math.PI) % 1 + 1) % 1;
      const ridge = cycle < 0.76 ? Math.pow(cycle / 0.76, 1.65) : (1 - cycle) / 0.24;
      const smaller = Math.pow(0.5 + 0.5 * Math.sin(z * 0.14 - x * 0.048 + Math.sin(x * 0.025)), 3);
      return 2.5 + 10 * ridge + 1.8 * smaller + 1.2 * Math.sin(x * 0.014 + z * 0.012);
    }, buildTerrain = function(aspect) {
      const vertices = new Float32Array((columns + 1) * (rows + 1) * 7);
      let cursor2 = 0;
      for (let row = 0; row <= rows; row++) {
        const distance = Math.pow(row / rows, 1.65) * 620;
        const z = 21.8 - distance;
        for (let column = 0; column <= columns; column++) {
          const x = (column / columns - 0.5) * (8 + distance * Math.max(2.5, aspect * 1.15));
          const y = height(x, z);
          const nx = height(x - 0.16, z) - height(x + 0.16, z);
          const nz = height(x, z - 0.16) - height(x, z + 0.16);
          const magnitude = Math.hypot(nx, 0.32, nz);
          let shadow = 1;
          for (let sample = 1; sample <= 12; sample++) {
            const step = sample * 2.2;
            const clearance = y + 0.08 + step * 0.38 - height(x + step * 0.72, z - step * 0.58);
            shadow = Math.min(shadow, Math.max(0, Math.min(1, clearance * 5 / step)));
          }
          vertices.set([x, y, z, nx / magnitude, 0.32 / magnitude, nz / magnitude, shadow], cursor2);
          cursor2 += 7;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, terrainBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      terrainAspect = aspect;
    }, use = function(selected, buffer, attributes) {
      enabled.forEach((location) => gl.disableVertexAttribArray(location));
      enabled.clear();
      gl.useProgram(selected);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [name, size, stride, offset] of attributes) {
        const location = gl.getAttribLocation(selected, name);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
        enabled.add(location);
      }
      gl.uniform2f(gl.getUniformLocation(selected, "u_resolution"), target.width, target.height);
    }, renderBackdrop = function() {
      width = target.width;
      heightPixels = target.height;
      const aspect = width / heightPixels;
      if (aspect !== terrainAspect) buildTerrain(aspect);
      gl.bindTexture(gl.TEXTURE_2D, backdrop);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, heightPixels, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, heightPixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, backdrop, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("Desert framebuffer unavailable");
      }
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      use(sky, quad, [["a_position", 2, 0, 0]]);
      gl.bindTexture(gl.TEXTURE_2D, moonMap);
      gl.uniform1i(gl.getUniformLocation(sky, "u_moon"), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.DEPTH_TEST);
      use(terrain, terrainBuffer, [["a_position", 3, 28, 0], ["a_normal", 3, 28, 12], ["a_shadow", 1, 28, 24]]);
      gl.uniform1f(gl.getUniformLocation(terrain, "u_eyeHeight"), height(0, 22) + 3.2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    const quadSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() { v_uv = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0.0, 1.0); }
    `;
    const atmosphere = `
      precision highp float;
      uniform vec2 u_resolution;
      varying vec2 v_uv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      float fbm(vec2 p) {
        float result = 0.0, weight = 0.5;
        for (int i=0; i<7; i++) { result += noise(p)*weight; p = mat2(1.8,1.1,-1.1,1.8)*p+13.7; weight *= 0.48; }
        return result;
      }
      vec3 skyColor(float y) {
        vec3 low=vec3(0.045,0.005,0.013);
        return mix(low,vec3(0.0015,0.002,0.004),smoothstep(0.08,0.52,y));
      }
    `;
    const skySource = atmosphere + `
      uniform sampler2D u_moon;
      vec3 moon(vec3 sky, vec2 uv, vec2 center, float radius, float turn) {
        vec2 q = (uv-center)/radius;
        float r = length(q);
        if (r>=1.0) return sky;
        vec3 n = vec3(q,sqrt(max(0.0,1.0-dot(q,q))));
        vec3 surface=n;
        surface.xy=mat2(0.96,0.28,-0.28,0.96)*surface.xy;
        vec2 mapUV=vec2(atan(surface.z,surface.x)/6.2831853+turn,asin(surface.y)/3.1415927+0.5);
        float rock=texture2D(u_moon,mapUV).r;
        float mineral=fbm(surface.xy*6.5+vec2(turn*20.0,8.0));
        float albedo=clamp(pow(rock,1.4)*2.1,0.0,1.0);
        albedo*=0.62+0.55*smoothstep(0.28,0.64,mineral);
        vec3 light=normalize(vec3(-0.64,0.28,0.66));
        float daylight=max(0.0,dot(n,light));
        vec3 ice=mix(vec3(0.12,0.34,0.55),vec3(0.45,0.90,1.0),albedo);
        vec3 lit=ice*(0.07+0.93*pow(daylight,0.65))*albedo;
        float rim=pow(1.0-n.z,4.0)*max(0.0,dot(n,light));
        lit+=vec3(0.10,0.42,0.50)*rim;
        float edge=smoothstep(1.0-1.5/(u_resolution.y*radius),1.0,r);
        return mix(lit,sky,edge);
      }
      void main() {
        float aspect=u_resolution.x/u_resolution.y;
        vec2 uv=vec2((v_uv.x-0.5)*aspect,v_uv.y-0.5);
        vec2 p=v_uv;
        float portrait=1.0-smoothstep(0.7,1.1,aspect);
        float moonScale=mix(1.0,0.78,portrait);
        vec3 color=skyColor(p.y);
        vec2 highCenter=vec2(0.26*aspect,0.20);
        vec2 lowCenter=vec2(-0.23*aspect,-0.345);
        color=moon(color,uv,highCenter,0.142*moonScale,0.68);
        color=moon(color,uv,lowCenter,0.145*moonScale,0.16);
        vec3 celestial=color;

        float drift=mix(p.x,1.0-p.x,0.26);
        vec2 wind=vec2(drift*4.0,p.y*8.0);
        vec2 curl=vec2(fbm(wind+vec2(17.2,5.6)),fbm(wind+vec2(4.1,19.3)));
        float broad=fbm(wind+curl*2.0);
        float fine=fbm(wind*4.0+curl*3.0);
        float filaments=fbm(vec2(drift*7.0,p.y*46.0)+curl*2.5);
        float edge=0.035+0.56*pow(max(drift,0.0),0.88);
        edge+=0.09*(broad-0.5)+0.05*(fine-0.5);
        float below=edge-p.y;
        float envelope=smoothstep(-0.025,0.06,below)*(1.0-smoothstep(0.16,0.43,below));
        envelope*=smoothstep(0.12,0.54,drift);
        float body=smoothstep(0.22,0.72,broad*0.6+fine*0.25+filaments*0.3);
        float cloud=envelope*body;
        float brightEdge=exp(-pow((below-0.085)/0.10,2.0));
        vec3 crimson=mix(vec3(0.30,0.035,0.22),vec3(0.96,0.11,0.055),brightEdge);
        crimson=mix(crimson,vec3(0.78,0.09,0.36),smoothstep(0.45,0.90,drift)*(1.0-brightEdge*0.65));
        color=mix(color,crimson*(0.43+0.90*body),cloud*0.90);
        color+=celestial*cloud*0.55;
        float wisp=pow(max(0.0,filaments-0.36),2.0)*2.1;
        wisp*=exp(-pow((below+0.025)/0.075,2.0))*smoothstep(0.22,0.80,drift);
        color+=vec3(0.48,0.07,0.08)*wisp;

        float horizon=exp(-pow((p.y-0.112)/0.052,2.0));
        float strata=fbm(vec2(p.x*10.0,p.y*85.0));
        vec3 ember=vec3(0.78,0.13,0.035);
        color=mix(color,ember,horizon*smoothstep(0.16,0.9,p.x)*0.45*(0.35+strata));
        color*=1.0-0.44*(1.0-smoothstep(0.08,0.125,p.y));
        gl_FragColor=vec4(color,1.0);
      }
    `;
    const terrainVertex = `
      attribute vec3 a_position;
      attribute vec3 a_normal;
      attribute float a_shadow;
      uniform vec2 u_resolution;
      uniform float u_eyeHeight;
      varying vec3 v_position;
      varying vec3 v_normal;
      varying float v_shadow;
      varying float v_distance;
      void main() {
        v_position=a_position; v_normal=a_normal; v_shadow=a_shadow;
        vec3 eye=a_position-vec3(0.0,u_eyeHeight,22.0);
        float depth=dot(eye,vec3(0.0,-0.055,-0.998486));
        float vertical=dot(eye,vec3(0.0,0.998486,-0.055));
        float aspect=u_resolution.x/u_resolution.y;
        gl_Position=vec4(eye.x/(0.50*aspect),(vertical/0.50)-depth*0.87,depth*1.00033-0.20003,depth);
        v_distance=length(eye);
      }
    `;
    const terrainSource = `
      precision highp float;
      varying vec3 v_position;
      varying vec3 v_normal;
      varying float v_shadow;
      varying float v_distance;
      void main() {
        vec3 p=v_position;
        float phase=p.z*24.0+p.x*3.0+sin(p.x*0.7+p.z*0.2)*1.7+sin(p.x*2.2-p.z*0.3)*0.4;
        float ripple=sin(phase)+0.32*sin(phase*2.0);
        float detail=exp(-v_distance*0.036);
        vec3 n=normalize(v_normal+vec3(cos(phase)*0.006,0.0,cos(phase)*0.034)*detail);
        float diffuse=max(dot(n,normalize(vec3(0.72,0.38,-0.58))),0.0);
        float shade=0.02+0.98*v_shadow;
        vec3 dark=vec3(0.008,0.005,0.007);
        vec3 sand=vec3(0.80,0.45,0.40);
        vec3 color=dark+sand*pow(diffuse,0.85)*shade;
        float edge=pow(max(0.0,1.0-n.y),0.8)*pow(diffuse,2.5)*v_shadow;
        color+=vec3(0.52,0.26,0.29)*edge;
        color*=1.0+ripple*0.022*detail;
        float fog=1.0-exp(-pow(v_distance*0.003,1.6));
        color=mix(color,vec3(0.075,0.025,0.028),fog);
        gl_FragColor=vec4(color,v_distance/(v_distance+30.0));
      }
    `;
    const dustSource = atmosphere + `
      uniform sampler2D u_backdrop;
      uniform float u_time;
      vec3 backdrop(vec2 uv) {
        vec2 pixel=1.0/u_resolution;
        vec3 center=texture2D(u_backdrop,uv).rgb;
        vec3 nw=texture2D(u_backdrop,uv+vec2(-1,1)*pixel).rgb;
        vec3 ne=texture2D(u_backdrop,uv+vec2(1,1)*pixel).rgb;
        vec3 sw=texture2D(u_backdrop,uv+vec2(-1,-1)*pixel).rgb;
        vec3 se=texture2D(u_backdrop,uv+vec2(1,-1)*pixel).rgb;
        vec3 luma=vec3(0.299,0.587,0.114);
        float a=dot(nw,luma), b=dot(ne,luma), c=dot(sw,luma), d=dot(se,luma), m=dot(center,luma);
        float low=min(m,min(min(a,b),min(c,d))), high=max(m,max(max(a,b),max(c,d)));
        if (high-low<0.018) return center;
        vec2 direction=vec2(c+d-a-b,a+c-b-d);
        float reduce=max((a+b+c+d)*0.03125,0.0078125);
        direction=clamp(direction/(min(abs(direction.x),abs(direction.y))+reduce),-8.0,8.0)*pixel;
        vec3 inner=0.5*(texture2D(u_backdrop,uv-direction/6.0).rgb+texture2D(u_backdrop,uv+direction/6.0).rgb);
        vec3 outer=inner*0.5+0.25*(texture2D(u_backdrop,uv-direction*0.5).rgb
          +texture2D(u_backdrop,uv+direction*0.5).rgb);
        float brightness=dot(outer,luma);
        return brightness<low || brightness>high ? inner : outer;
      }
      void main() {
        float aspect=u_resolution.x/u_resolution.y;
        vec2 uv=v_uv;
        vec2 p=vec2(uv.x*aspect,uv.y);
        float encoded=texture2D(u_backdrop,uv).a;
        float groundDistance=30.0*encoded/max(0.0001,1.0-encoded);
        float rayLength=length(vec3((uv-vec2(0.5,0.065))*vec2(aspect,1.0),1.0));
        vec2 wind=vec2(p.x*2.0-u_time*0.12,p.y*6.0);
        float billow=noise(wind+vec2(5.0,17.0))*0.55
          +noise(wind*2.3+vec2(u_time*0.04,3.0))*0.30+noise(wind*5.1)*0.15;
        float nearGust=smoothstep(0.24,0.73,billow)*exp(-pow((uv.y-0.30)/0.42,2.0));
        nearGust*=smoothstep(0.0,8.0,groundDistance-9.0*rayLength);
        vec2 farWind=vec2(p.x*3.3-u_time*0.055,p.y*22.0+billow*0.9);
        float farBillow=noise(farWind)*0.65+noise(farWind*2.7)*0.35;
        float farGust=smoothstep(0.25,0.70,farBillow)*exp(-pow((uv.y-0.18)/0.18,2.0));
        farGust*=smoothstep(0.0,18.0,groundDistance-85.0*rayLength);
        vec3 color=backdrop(uv);
        color=mix(color,vec3(0.50,0.19,0.12),farGust*0.36);
        color=mix(color,vec3(0.61,0.29,0.19),nearGust*0.24);
        float vignette=1.0-0.18*smoothstep(0.2,0.75,length((uv-0.5)*vec2(1.0,0.85)));
        color=pow(max(color,vec3(0.0)),vec3(0.98))*vignette;
        // Subtle fixed dithering prevents bands without introducing animated grain.
        color+=(hash(gl_FragCoord.xy)-0.5)/255.0;
        gl_FragColor=vec4(color,1.0);
      }
    `;
    const sky = program(quadSource, skySource);
    const terrain = program(terrainVertex, terrainSource);
    const dust = program(quadSource, dustSource);
    const airborne = program(`
      attribute vec2 a_corner;
      attribute vec4 a_seed;
      uniform vec2 u_resolution;
      uniform float u_time;
      varying vec2 v_uv;
      varying float v_opacity;
      varying float v_depth;
      varying float v_nearField;
      void main() {
        float variation=fract(a_seed.z*17.31);
        float nearField=1.0-step(0.0,a_seed.w);
        float speed=2.0+variation*3.0;
        float travel=u_time*speed+3.0*sin(u_time*0.8)+1.1*sin(u_time*1.9+a_seed.z*12.0);
        float span=mix(42.0,5.85,nearField);
        float nearest=mix(0.35,0.15,nearField);
        float depth=nearest+mod(a_seed.z*span-travel*mix(1.0,0.35,nearField),span);
        float curl=u_time*(0.4+variation*0.35)+a_seed.z*19.0;
        vec2 eddy=vec2(sin(curl),cos(curl*0.83))*(1.5+variation*2.0)*mix(1.0,0.16,nearField);
        float angle=a_seed.z*6.2831853+u_time*(0.12+variation*0.24)+0.35*sin(u_time*0.9+a_seed.z*11.0);
        vec2 corner=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*a_corner;
        vec2 position=a_seed.xy+eddy+corner*abs(a_seed.w);
        float aspect=u_resolution.x/u_resolution.y;
        float elevation=mix(-0.50,0.0,nearField);
        float verticalScale=mix(0.85,1.5,nearField);
        gl_Position=vec4(position.x/(0.50*aspect),position.y*verticalScale+depth*elevation,0.0,depth);
        v_uv=a_corner*0.5+0.5;
        v_depth=depth;
        v_nearField=nearField;
        v_opacity=smoothstep(nearest,mix(1.5,0.4,nearField),depth)
          *(1.0-smoothstep(mix(34.0,4.5,nearField),nearest+span,depth))*mix(0.32,0.16,nearField);
      }
    `, `
      precision highp float;
      uniform sampler2D u_dustMap;
      uniform sampler2D u_backdrop;
      uniform vec2 u_resolution;
      varying vec2 v_uv;
      varying float v_opacity;
      varying float v_depth;
      varying float v_nearField;
      void main() {
        vec4 sand=texture2D(u_dustMap,v_uv);
        vec2 screen=gl_FragCoord.xy/u_resolution;
        float encoded=texture2D(u_backdrop,screen).a;
        float groundDistance=30.0*encoded/max(0.0001,1.0-encoded);
        vec2 ray=(screen-vec2(0.5,0.065))*vec2(u_resolution.x/u_resolution.y,1.0);
        float particleDistance=v_depth*length(vec3(ray,1.0));
        float clearance=smoothstep(0.0,1.5,groundDistance-particleDistance);
        float altitude=mix(1.0-smoothstep(0.32,0.82,screen.y),
          1.0-smoothstep(0.72,1.25,screen.y),v_nearField);
        float gust=0.72+0.28*sin(v_depth*0.7+screen.x*5.0);
        gl_FragColor=vec4(sand.rgb,sand.a*v_opacity*clearance*altitude*gust);
      }
    `);
    const quad = create("Buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const moonMap = create("Texture");
    gl.bindTexture(gl.TEXTURE_2D, moonMap);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const maxDimension = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    let map = images[0];
    if (map.width > maxDimension) {
      const resized = document.createElement("canvas");
      resized.width = maxDimension;
      resized.height = map.height * maxDimension / map.width;
      resized.getContext("2d").drawImage(map, 0, 0, resized.width, resized.height);
      map = resized;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, map);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    const dustSize = 1024;
    const dustPixels = new Uint8Array(dustSize * dustSize * 4);
    for (let y = 0; y < dustSize; y++) {
      for (let x = 0; x < dustSize; x++) {
        const nx = (x - dustSize / 2) / (dustSize / 2), ny = (y - dustSize / 2) / (dustSize / 2);
        const billow = cloudNoise(x / 180 + 4, y / 180 + 8) * 0.7 + cloudNoise(x / 56, y / 56) * 0.3;
        const envelope = Math.pow(Math.max(0, 1 - nx * nx - ny * ny), 1.5);
        const grain = Math.pow(random(x + 400, y + 700), 7);
        const density = Math.max(0, billow - 0.1) * envelope;
        const index = (y * dustSize + x) * 4;
        const tone = 1 - grain * 0.5;
        dustPixels.set([182 * tone, 88 * tone, 56 * tone, Math.min(255, density * (125 + grain * 2e3))], index);
      }
    }
    const dustMap = create("Texture");
    gl.bindTexture(gl.TEXTURE_2D, dustMap);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, dustSize, dustSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, dustPixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    const farCount = 144, nearCount = 64;
    const particleCount = farCount + nearCount;
    const particles = new Float32Array(particleCount * 4 * 6);
    const particleIndices = new Uint16Array(particleCount * 6);
    for (let i = 0; i < particleCount; i++) {
      const near = i >= farCount;
      const phase = ((near ? i - farCount : i) + random(i, 3) * 0.8) / (near ? nearCount : farCount);
      const seed = [
        (random(i, 1) - 0.5) * (near ? 3 : 30),
        (random(i, 2) - 0.5) * (near ? 2.4 : 20),
        phase,
        near ? -(0.6 + random(i, 4) * 0.8) : 3 + random(i, 4) * 3.5
      ];
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((corner, j) => particles.set([...corner, ...seed], (i * 4 + j) * 6));
      particleIndices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    const particleBuffer = create("Buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, particles, gl.STATIC_DRAW);
    const particleElements = create("Buffer");
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, particleElements);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, particleIndices, gl.STATIC_DRAW);
    const columns = 240, rows = 220;
    const terrainBuffer = create("Buffer");
    let terrainAspect = 0;
    const indices = new Uint16Array(columns * rows * 6);
    let cursor = 0;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const a = row * (columns + 1) + column, b = a + columns + 1;
        indices.set([a, b, a + 1, a + 1, b, b + 1], cursor);
        cursor += 6;
      }
    }
    const elementBuffer = create("Buffer");
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    const framebuffer = create("Framebuffer");
    const depth = create("Renderbuffer");
    const backdrop = create("Texture");
    gl.bindTexture(gl.TEXTURE_2D, backdrop);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let width = 0, heightPixels = 0;
    const enabled = /* @__PURE__ */ new Set();
    return {
      maxDimension,
      dispose,
      exportAssets(width2, height2) {
        target.width = width2;
        target.height = height2;
        this.draw(0, false);
        const landscape = target.toDataURL("image/jpeg", 0.94);
        const pixels = new Uint8Array(width2 * height2 * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.readPixels(0, 0, width2, height2, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const masks = {};
        for (const depth2 of [0.5, 2, 5, 12, 28, 42]) {
          const mask = document.createElement("canvas");
          mask.width = width2;
          mask.height = height2;
          const context = mask.getContext("2d");
          const image = context.createImageData(width2, height2);
          for (let y = 0; y < height2; y++) {
            for (let x = 0; x < width2; x++) {
              const encoded = pixels[((height2 - 1 - y) * width2 + x) * 4 + 3] / 255;
              const distance = 30 * encoded / Math.max(1e-4, 1 - encoded);
              const ray = Math.hypot(
                (x / width2 - 0.5) * width2 / height2,
                1 - y / height2 - 0.065,
                1
              );
              const t = Math.max(0, Math.min(1, (distance - depth2 * ray) / 1.5));
              const shade = Math.round(t * t * (3 - 2 * t) * 255);
              image.data.set([shade, shade, shade, 255], (y * width2 + x) * 4);
            }
          }
          context.putImageData(image, 0, 0);
          masks[depth2] = mask.toDataURL();
        }
        const sprite = document.createElement("canvas");
        sprite.width = dustSize;
        sprite.height = dustSize;
        const spriteImage = new ImageData(new Uint8ClampedArray(dustPixels), dustSize, dustSize);
        sprite.getContext("2d").putImageData(spriteImage, 0, 0);
        return { landscape, masks, sprite: sprite.toDataURL() };
      },
      draw(seconds, particles2 = true) {
        gl.viewport(0, 0, target.width, target.height);
        if (width !== target.width || heightPixels !== target.height) renderBackdrop();
        use(dust, quad, [["a_position", 2, 0, 0]]);
        gl.bindTexture(gl.TEXTURE_2D, backdrop);
        gl.uniform1i(gl.getUniformLocation(dust, "u_backdrop"), 0);
        gl.uniform1f(gl.getUniformLocation(dust, "u_time"), seconds);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (!particles2) return;
        use(airborne, particleBuffer, [["a_corner", 2, 24, 0], ["a_seed", 4, 24, 8]]);
        gl.bindTexture(gl.TEXTURE_2D, dustMap);
        gl.uniform1i(gl.getUniformLocation(airborne, "u_dustMap"), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, backdrop);
        gl.uniform1i(gl.getUniformLocation(airborne, "u_backdrop"), 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(gl.getUniformLocation(airborne, "u_time"), seconds);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, particleElements);
        gl.drawElements(gl.TRIANGLES, particleIndices.length, gl.UNSIGNED_SHORT, 0);
        gl.disable(gl.BLEND);
      }
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

// src/scene.css
var scene_default = ".choam-universe {\n  position: absolute;\n  inset: 0;\n  overflow: hidden;\n  pointer-events: none;\n  background: #030205;\n  contain: strict;\n}\n.choam-universe canvas,\n.choam-universe__still {\n  position: absolute;\n  inset: 0;\n  width: 100%;\n  height: 100%;\n}\n.choam-universe canvas { opacity: 0; }\n.choam-universe--ready canvas { opacity: 1; }\n.choam-universe--loading .choam-universe__still { background-image: none; }\n.choam-universe__still {\n  background: #030205 var(--still-image) center / cover;\n}\n";

// src/component.js
var ArrakisDesert1984 = class extends HTMLElement {
  /** Attributes that update the current renderer without remounting. */
  static observedAttributes = ["paused"];
  #controller;
  #root;
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ":host{display:block;position:relative;overflow:hidden;contain:layout paint}" + scene_default;
    this.#root = document.createElement("div");
    shadow.append(style, this.#root);
  }
  /** Mounts the artwork when the element enters a document. */
  connectedCallback() {
    this.#controller = mountDesert(this.#root);
    const fallback = this.#root.querySelector(".choam-universe__still");
    const fallbackUrl = new URL("./arrakis-desert-1984-still.svg", import.meta.url).href;
    fallback.style.setProperty("--still-image", `url("${fallbackUrl}")`);
    if (this.hasAttribute("paused")) this.#controller.pause();
  }
  /** Releases rendering resources when the element leaves its document. */
  disconnectedCallback() {
    this.#controller?.dispose();
    this.#controller = void 0;
  }
  /** Synchronizes the paused attribute with the current connection. */
  attributeChangedCallback() {
    if (this.hasAttribute("paused")) this.#controller?.pause();
    else this.#controller?.resume();
  }
  /** Resolves after this connection initializes, including fallback failures. */
  get ready() {
    return this.#controller?.ready ?? Promise.resolve();
  }
  /** Returns whether explicit pause is enabled. */
  get paused() {
    return this.hasAttribute("paused");
  }
  /** Sets explicit pause and reflects it to the Boolean attribute. */
  set paused(value) {
    this.toggleAttribute("paused", Boolean(value));
  }
  /** Pauses motion until resume is called; the still frame remains visible. */
  pause() {
    this.setAttribute("paused", "");
  }
  /** Resumes motion when focus, visibility, and reduced-motion preferences allow it. */
  resume() {
    this.removeAttribute("paused");
  }
};
if (!customElements.get("arrakis-desert-1984")) customElements.define("arrakis-desert-1984", ArrakisDesert1984);
export {
  ArrakisDesert1984
};
