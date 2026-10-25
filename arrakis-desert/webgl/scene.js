/**
 * Mounts a decorative desert inside a sized element and returns its controller.
 * The ready promise resolves after initialization, including fallback failures.
 * Disposal releases listeners and GPU resources; a disposed controller cannot resume.
 */
export function mountDesert(root, { assetBase = new URL('./assets/', import.meta.url).href } = {}) {
  const existing = mounts.get(root);
  if (existing) return existing;
  root.classList.add('choam-universe', 'choam-universe--loading');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '<div class="choam-universe__still"></div><canvas></canvas>';
  const canvas = root.querySelector('canvas');
  let disposed = false;
  const removers = [];
  function listen(target, name, listener) {
    target.addEventListener(name, listener);
    removers.push(() => target.removeEventListener(name, listener));
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const touchInput = matchMedia('(hover: none) and (pointer: coarse)');
  let paused = false;
  // iOS Safari may not focus a newly navigated document until its first touch.
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
    root.classList.toggle('choam-universe--loading', loading);
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
      const budget = width < 700 ? 1800000 : 3600000;
      const scale = Math.min(devicePixelRatio || 1, 2, Math.sqrt(budget / (width * height)),
        renderer.maxDimension / width, renderer.maxDimension / height);
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
      root.classList.remove('choam-universe--ready');
      stop();
      updateState();
    }
  }

  function tick(timestamp) {
    frame = null;
    if (!active()) return;
    if (previousTimestamp !== null) {
      // Discard suspended time, including an OS sleep without a visibility event.
      const frameElapsed = (timestamp - previousTimestamp) / 1000;
      const elapsed = Math.min(frameElapsed, 0.1);
      transitionElapsed = Math.min(0.65, transitionElapsed + frameElapsed);
      const progress = transitionElapsed / 0.65;
      const eased = progress * progress * (3 - 2 * progress);
      speed = transitionStartSpeed + (targetSpeed - transitionStartSpeed) * eased;
      sceneTime += elapsed * speed;
    }
    previousTimestamp = timestamp;
    if (lastDraw === null || timestamp - lastDraw >= 1000 / 30 || resizePending || !active()) {
      draw();
      lastDraw = timestamp;
    }
    if (active()) frame = requestAnimationFrame(tick);
    else stop();
  }

  listen(window, 'blur', () => { focused = false; syncActivity(); });
  listen(window, 'focus', () => { focused = true; syncActivity(); });
  listen(document, 'visibilitychange', () => {
    focused = document.hasFocus() || (touchInput.matches && !document.hidden);
    syncActivity();
  });
  listen(window, 'pagehide', () => { pagePresent = false; syncActivity(); });
  listen(window, 'pageshow', () => {
    pagePresent = true;
    focused = document.hasFocus() || (touchInput.matches && !document.hidden);
    syncActivity();
  });
  listen(reducedMotion, 'change', syncActivity);
  listen(window, 'resize', () => {
    resizePending = true;
    // A static scene still needs to fit a rotated phone; hidden pages wait until return.
    if (!document.hidden && focused && !active()) draw();
  });
  listen(canvas, 'webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    loading = false;
    root.classList.remove('choam-universe--ready');
    syncActivity();
  });
  listen(canvas, 'webglcontextrestored', initialize);

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
      const gl = canvas.getContext('webgl', {
        alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power',
        // Paused scenes must retain the last frame after compositing.
        preserveDrawingBuffer: true,
      });
      if (!gl) {
        loading = false;
        syncActivity();
        return;
      }
      imagesPromise ||= Promise.all(['moon.jpg'].map(file => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Planet texture unavailable'));
        image.src = `${assetBase}${file}`;
      })));
      const images = await imagesPromise;
      if (currentGeneration !== generation || contextLost || disposed) return;
      renderer = createRenderer(canvas, gl, images);
      resizePending = true;
      draw();
      if (renderer) root.classList.add('choam-universe--ready');
    } catch {
      if (currentGeneration !== generation || contextLost || disposed) return;
      renderer?.dispose();
      renderer = null;
      root.classList.remove('choam-universe--ready');
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
    pause() { if (!disposed) { paused = true; syncActivity(); } },
    resume() { if (!disposed) { paused = false; syncActivity(); } },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      stop();
      observer.disconnect();
      removers.forEach(remove => remove());
      renderer?.dispose();
      renderer = null;
      mounts.delete(root);
      root.replaceChildren();
      root.classList.remove('choam-universe--ready', 'choam-universe--loading');
    },
  };
  mounts.set(root, controller);
  return controller;
}

const mounts = new WeakMap();

/** Creates the shared GPU artwork renderer. Throws when WebGL resources cannot initialize. */
export function createRenderer(target, gl, images) {
  const resources = [];
  const create = kind => {
    const value = gl[`create${kind}`]();
    resources.push([kind, value]);
    return value;
  };
  const dispose = () => {
    for (const [kind, value] of resources.splice(0)) gl[`delete${kind}`](value);
  };
  try {
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
        for (int i=0; i<5; i++) { result += noise(p)*weight; p = mat2(1.8,1.1,-1.1,1.8)*p+13.7; weight *= 0.48; }
        return result;
      }
      vec3 skyColor(float y) {
        return mix(vec3(0.78,0.53,0.29),vec3(0.24,0.18,0.12),smoothstep(0.30,1.05,y));
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
        vec3 light=normalize(vec3(0.86,-0.20,-0.52));
        float daylight=max(0.0,dot(n,light));
        vec3 lit=vec3(1.12,0.97,0.75)*pow(rock,1.35)*(daylight*1.7+0.018);
        float extinction=0.22+0.44*(1.0-smoothstep(0.25,0.82,v_uv.y));
        vec3 result=sky*(0.94+0.06*extinction)+lit*(1.0-extinction)*1.25;
        float edge=smoothstep(1.0-1.5/(u_resolution.y*radius),1.0,r);
        return mix(result,sky,edge);
      }
      void main() {
        float aspect=u_resolution.x/u_resolution.y;
        vec2 uv=vec2((v_uv.x-0.5)*aspect,v_uv.y-0.5);
        vec3 color=skyColor(v_uv.y);
        float veil=fbm(vec2(uv.x*1.4,uv.y*3.0)+vec2(10.0,9.0));
        color+=vec3(0.10,0.065,0.025)*(veil-0.45);
        float unit=min(1.0,aspect*1.65);
        float portrait=1.0-smoothstep(0.65,0.95,aspect);
        vec2 largeCenter=mix(vec2(-0.15*aspect,0.51),vec2(-0.18*aspect,0.43),portrait);
        float largeRadius=mix(0.59,0.60*aspect,portrait);
        color=moon(color,uv,largeCenter,largeRadius,0.68);
        color=moon(color,uv,vec2(-0.39*aspect,0.35),0.13*unit,0.11);
        float horizon=exp(-abs(v_uv.y-0.38)*10.0);
        color=mix(color,vec3(0.81,0.57,0.32),horizon*0.28);
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
        gl_Position=vec4(eye.x/(0.50*aspect),vertical/0.50,depth*1.00033-0.20003,depth);
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
        float shade=0.15+0.85*v_shadow;
        float variation=sin(p.x*0.081+p.z*0.013)*0.018+sin(p.z*0.13)*0.012;
        vec3 sand=vec3(0.78,0.48,0.25)+variation;
        vec3 color=sand*(vec3(0.07,0.09,0.12)+vec3(1.55,1.22,0.88)*diffuse*shade);
        color*=1.0+ripple*0.009*detail;
        float fog=1.0-exp(-pow(v_distance*0.0045,1.35));
        color=mix(color,vec3(0.74,0.49,0.28),fog);
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
        float haze=exp(-abs(uv.y-0.50)*9.0)*0.12;
        vec3 color=mix(backdrop(uv),vec3(0.83,0.61,0.36),haze);
        float vignette=1.0-0.18*smoothstep(0.2,0.75,length((uv-0.5)*vec2(1.0,0.85)));
        color=pow(max(color,vec3(0.0)),vec3(0.92))*vignette;
        // Subtle fixed dithering prevents bands without introducing animated grain.
        color+=(hash(gl_FragCoord.xy)-0.5)/255.0;
        gl_FragColor=vec4(color,1.0);
      }
    `;
    function program(vertexSource, fragmentSource) {
      const result = create('Program');
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
    }
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
      void main() {
        float variation=fract(a_seed.z*17.31);
        float nearField=1.0-step(0.0,a_seed.w);
        float speed=5.0+variation*6.0;
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
        gl_Position=vec4(position.x/(0.50*aspect),position.y/0.50+depth*0.02,0.0,depth);
        v_uv=a_corner*0.5+0.5;
        v_depth=depth;
        v_opacity=smoothstep(nearest,mix(1.5,0.4,nearField),depth)
          *(1.0-smoothstep(mix(34.0,4.5,nearField),nearest+span,depth))*mix(0.52,0.33,nearField);
      }
    `, `
      precision highp float;
      uniform sampler2D u_dustMap;
      uniform sampler2D u_backdrop;
      uniform vec2 u_resolution;
      varying vec2 v_uv;
      varying float v_opacity;
      varying float v_depth;
      void main() {
        vec4 sand=texture2D(u_dustMap,v_uv);
        vec2 screen=gl_FragCoord.xy/u_resolution;
        float encoded=texture2D(u_backdrop,screen).a;
        float groundDistance=30.0*encoded/max(0.0001,1.0-encoded);
        vec2 ray=(screen-vec2(0.5))*vec2(u_resolution.x/u_resolution.y,1.0);
        float particleDistance=v_depth*length(vec3(ray,1.0));
        float clearance=smoothstep(0.0,1.5,groundDistance-particleDistance);
        gl_FragColor=vec4(sand.rgb,sand.a*v_opacity*clearance);
      }
    `);
    const quad = create('Buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const moonMap = create('Texture');
    gl.bindTexture(gl.TEXTURE_2D, moonMap);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const maxDimension = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    let map = images[0];
    if (map.width > maxDimension) {
      const resized = document.createElement('canvas');
      resized.width = maxDimension;
      resized.height = map.height * maxDimension / map.width;
      resized.getContext('2d').drawImage(map, 0, 0, resized.width, resized.height);
      map = resized;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, map);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);

    // An original granular sprite supplies perspective detail without a runtime noise shader.
    function random(x, y) {
      const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return value - Math.floor(value);
    }
    function cloudNoise(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const a = random(ix, iy) * (1 - u) + random(ix + 1, iy) * u;
      const b = random(ix, iy + 1) * (1 - u) + random(ix + 1, iy + 1) * u;
      return a * (1 - v) + b * v;
    }
    const dustSize = 1024;
    const dustPixels = new Uint8Array(dustSize * dustSize * 4);
    for (let y = 0; y < dustSize; y++) {
      for (let x = 0; x < dustSize; x++) {
        const nx = (x - dustSize / 2) / (dustSize / 2), ny = (y - dustSize / 2) / (dustSize / 2);
        const billow = cloudNoise(x / 180 + 4, y / 180 + 8) * 0.7 + cloudNoise(x / 56, y / 56) * 0.3;
        const envelope = Math.pow(Math.max(0, 1 - nx * nx - ny * ny), 1.5);
        const grain = Math.pow(random(x + 400, y + 700), 7);
        const density = Math.max(0, billow - 0.10) * envelope;
        const index = (y * dustSize + x) * 4;
        const tone = 1 - grain * 0.50;
        dustPixels.set([205 * tone, 155 * tone, 91 * tone, Math.min(255, density * (125 + grain * 2000))], index);
      }
    }
    const dustMap = create('Texture');
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
      const seed = [(random(i, 1) - 0.5) * (near ? 3 : 30), (random(i, 2) - 0.5) * (near ? 2.4 : 20),
        phase, near ? -(0.6 + random(i, 4) * 0.8) : 3 + random(i, 4) * 3.5];
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((corner, j) => particles.set([...corner, ...seed], (i * 4 + j) * 6));
      particleIndices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    const particleBuffer = create('Buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, particles, gl.STATIC_DRAW);
    const particleElements = create('Buffer');
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, particleElements);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, particleIndices, gl.STATIC_DRAW);

    function height(x, z) {
      const phase = 3.2 + z * 0.063 + x * 0.025 + 1.6 * Math.sin(x * 0.027) + 0.4 * Math.sin(z * 0.018 - x * 0.065);
      const cycle = ((phase / (2 * Math.PI)) % 1 + 1) % 1;
      const ridge = cycle < 0.76 ? Math.pow(cycle / 0.76, 1.65) : (1 - cycle) / 0.24;
      const smaller = Math.pow(0.5 + 0.5 * Math.sin(z * 0.14 - x * 0.048 + Math.sin(x * 0.025)), 3);
      return 2.5 + 10.0 * ridge + 1.8 * smaller + 1.2 * Math.sin(x * 0.014 + z * 0.012);
    }
    const columns = 240, rows = 220;
    const terrainBuffer = create('Buffer');
    let terrainAspect = 0;
    function buildTerrain(aspect) {
      const vertices = new Float32Array((columns + 1) * (rows + 1) * 7);
      let cursor = 0;
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
          vertices.set([x, y, z, nx / magnitude, 0.32 / magnitude, nz / magnitude, shadow], cursor);
          cursor += 7;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, terrainBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      terrainAspect = aspect;
    }
    const indices = new Uint16Array(columns * rows * 6);
    let cursor = 0;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const a = row * (columns + 1) + column, b = a + columns + 1;
        indices.set([a,b,a+1,a+1,b,b+1], cursor); cursor += 6;
      }
    }
    const elementBuffer = create('Buffer');
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    const framebuffer = create('Framebuffer');
    const depth = create('Renderbuffer');
    const backdrop = create('Texture');
    gl.bindTexture(gl.TEXTURE_2D, backdrop);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let width = 0, heightPixels = 0;
    const enabled = new Set();
    function use(selected, buffer, attributes) {
      enabled.forEach(location => gl.disableVertexAttribArray(location));
      enabled.clear();
      gl.useProgram(selected);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [name, size, stride, offset] of attributes) {
        const location = gl.getAttribLocation(selected, name);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
        enabled.add(location);
      }
      gl.uniform2f(gl.getUniformLocation(selected, 'u_resolution'), target.width, target.height);
    }
    function renderBackdrop() {
      width = target.width; heightPixels = target.height;
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
        throw new Error('Desert framebuffer unavailable');
      }
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      use(sky, quad, [['a_position', 2, 0, 0]]);
      gl.bindTexture(gl.TEXTURE_2D, moonMap);
      gl.uniform1i(gl.getUniformLocation(sky, 'u_moon'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.DEPTH_TEST);
      use(terrain, terrainBuffer, [['a_position', 3, 28, 0], ['a_normal', 3, 28, 12], ['a_shadow', 1, 28, 24]]);
      gl.uniform1f(gl.getUniformLocation(terrain, 'u_eyeHeight'), height(0, 22) + 1.7);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    return {
      maxDimension,
      dispose,
      exportAssets(width, height) {
        target.width = width;
        target.height = height;
        this.draw(0, false);
        const landscape = target.toDataURL('image/jpeg', 0.94);
        const pixels = new Uint8Array(width * height * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const mask = document.createElement('canvas');
        mask.width = width;
        mask.height = height;
        const context = mask.getContext('2d');
        const image = context.createImageData(width, height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const encoded = pixels[((height - 1 - y) * width + x) * 4 + 3] / 255;
            const distance = 30 * encoded / Math.max(0.0001, 1 - encoded);
            const t = Math.max(0, Math.min(1, (distance - 2.5) / 14));
            const shade = Math.round(t * t * (3 - 2 * t) * 255);
            image.data.set([shade, shade, shade, 255], (y * width + x) * 4);
          }
        }
        context.putImageData(image, 0, 0);
        const sprite = document.createElement('canvas');
        sprite.width = dustSize;
        sprite.height = dustSize;
        const spriteImage = new ImageData(new Uint8ClampedArray(dustPixels), dustSize, dustSize);
        sprite.getContext('2d').putImageData(spriteImage, 0, 0);
        return { landscape, mask: mask.toDataURL(), sprite: sprite.toDataURL() };
      },
      draw(seconds, particles = true) {
        gl.viewport(0, 0, target.width, target.height);
        if (width !== target.width || heightPixels !== target.height) renderBackdrop();
        use(dust, quad, [['a_position', 2, 0, 0]]);
        gl.bindTexture(gl.TEXTURE_2D, backdrop);
        gl.uniform1i(gl.getUniformLocation(dust, 'u_backdrop'), 0);
        gl.uniform1f(gl.getUniformLocation(dust, 'u_time'), seconds);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (!particles) return;
        use(airborne, particleBuffer, [['a_corner', 2, 24, 0], ['a_seed', 4, 24, 8]]);
        gl.bindTexture(gl.TEXTURE_2D, dustMap);
        gl.uniform1i(gl.getUniformLocation(airborne, 'u_dustMap'), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, backdrop);
        gl.uniform1i(gl.getUniformLocation(airborne, 'u_backdrop'), 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(gl.getUniformLocation(airborne, 'u_time'), seconds);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, particleElements);
        gl.drawElements(gl.TRIANGLES, particleIndices.length, gl.UNSIGNED_SHORT, 0);
        gl.disable(gl.BLEND);
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
