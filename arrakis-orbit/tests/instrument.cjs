function instrument({ noWebGL = false, initialFocus = true, gpuLimit = null, failFramebufferAt = null } = {}) {
    const f = window.fixture = {
      pending: new Map(), now: 0, serial: 0, focused: initialFocus, visibleState: true,
      time: 0, draws: 0, colored: false, textures: [], framebufferChecks: 0,
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
    const parameter = proto.getParameter;
    proto.getParameter = function(name) {
      if (gpuLimit && (name === this.MAX_TEXTURE_SIZE || name === this.MAX_RENDERBUFFER_SIZE)) return gpuLimit;
      return parameter.call(this, name);
    };
    const framebuffer = proto.checkFramebufferStatus;
    proto.checkFramebufferStatus = function(target) {
      f.framebufferChecks++;
      return failFramebufferAt && f.framebufferChecks >= failFramebufferAt ? this.FRAMEBUFFER_UNSUPPORTED : framebuffer.call(this, target);
    };
    const upload = proto.texImage2D;
    proto.texImage2D = function(...args) {
      const source = args[args.length - 1];
      if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) f.textures.push([source.width, source.height]);
      return upload.apply(this, args);
    };
    const get = proto.getUniformLocation;
    proto.getUniformLocation = function(program, name) { const loc = get.call(this, program, name); locations.set(loc, name); return loc; };
    const uniform = proto.uniform1f;
    proto.uniform1f = function(loc, value) { if (locations.get(loc) === 'u_time') f.time = value; return uniform.call(this, loc, value); };
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

}
module.exports = { instrument };
