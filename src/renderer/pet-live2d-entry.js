import { Application, extensions } from 'pixi.js';
import { Live2DModel, Live2DPlugin, configureCubismSDK } from 'untitled-pixi-live2d-engine/cubism';
import performancePolicy from '../shared/performance-policy.js';

const { targetFps, pixelRatioLimit } = performancePolicy;
let registered = false;

function registerRuntime() {
  if (registered) return;
  extensions.add(Live2DPlugin);
  configureCubismSDK({ memorySizeMB: 16 });
  registered = true;
}

export function mount(canvas, options = {}) {
  registerRuntime();
  const performanceMode = options.performanceMode || 'efficient';
  let app = null;
  let model = null;
  let disposed = false;
  let currentMotion = { mode: 'idle', action: '' };
  let lastMotionGroup = '';
  let renderedFrames = 0;
  const mountedAt = performance.now();

  function motionGroupFor(mode) {
    const groups = options.modelConfig?.animationNames || [];
    const patterns = {
      idle: /idle|breath|stand|home/i,
      walk: /walk|move|run/i,
      run: /run|dash|walk/i,
      sleep: /sleep|nap|rest/i,
      sit: /sit|seat/i,
      stretch: /stretch/i,
      look: /look|tap|touch/i
    };
    return groups.find((name) => patterns[mode]?.test(name)) || groups.find((name) => /idle/i.test(name)) || groups[0] || '';
  }

  function fitModel() {
    if (!app || !model || !model.width || !model.height) return;
    const width = Math.max(2, canvas.clientWidth);
    const height = Math.max(2, canvas.clientHeight);
    app.renderer.resize(width, height);
    const scale = Math.min(width / model.width, height / model.height) * 0.94 * (Number(options.modelConfig?.transform?.scale) || 1);
    model.scale.set(scale);
    model.position.set(width / 2, height * (0.52 + (Number(options.modelConfig?.transform?.verticalOffset) || 0) * 0.12));
  }

  async function syncMotion() {
    if (!model) return;
    const group = motionGroupFor(currentMotion.mode);
    if (group && group !== lastMotionGroup) {
      lastMotionGroup = group;
      try { await model.motion(group, undefined, undefined, { loop: ['idle', 'walk', 'run', 'sleep'].includes(currentMotion.mode) }); } catch {}
    }
    if (currentMotion.action === 'hop' || currentMotion.action === 'stretch') {
      try { await model.expression(); } catch {}
    }
    if (app) app.ticker.maxFPS = targetFps(performanceMode, currentMotion.mode, Boolean(currentMotion.action), Boolean(options.secondary));
  }

  async function initialize() {
    try {
      app = new Application();
      await app.init({
        canvas,
        width: Math.max(2, canvas.clientWidth),
        height: Math.max(2, canvas.clientHeight),
        backgroundAlpha: 0,
        antialias: performanceMode === 'quality',
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, pixelRatioLimit(performanceMode)),
        preference: 'webgl',
        powerPreference: 'low-power'
      });
      if (disposed) return app.destroy(true);
      app.ticker.maxFPS = targetFps(performanceMode, currentMotion.mode, false, Boolean(options.secondary));
      app.ticker.add(() => { renderedFrames += 1; });
      model = await Live2DModel.from(options.modelUrl, {
        ticker: app.ticker,
        autoUpdate: true,
        autoFocus: true,
        autoHitTest: true,
        autoInteract: true,
        textureOptions: { lod: performanceMode === 'quality' ? 'full' : 'single-auto' }
      });
      if (disposed) return model.destroy();
      model.anchor.set(0.5, 0.5);
      model.eventMode = 'static';
      model.on('pointertap', async () => {
        try { await model.expression(); } catch {}
        const group = motionGroupFor('look');
        if (group) try { await model.motion(group); } catch {}
      });
      app.stage.addChild(model);
      fitModel();
      await syncMotion();
      options.onReady?.();
    } catch (error) {
      options.onModelError?.(error);
    }
  }

  const observer = new ResizeObserver(fitModel);
  observer.observe(canvas);
  const onVisibility = () => {
    if (!app) return;
    if (document.hidden) app.stop();
    else app.start();
  };
  document.addEventListener('visibilitychange', onVisibility);
  initialize();

  function setMotion(motion) {
    currentMotion = { ...currentMotion, ...(motion || {}) };
    if (model && Number.isFinite(motion?.focusX)) {
      try { model.focus?.(motion.focusX, motion.focusY); } catch {}
    }
    syncMotion();
  }

  function setPointer(x, y) {
    try { model?.focus?.(Math.max(-1, Math.min(1, Number(x) || 0)), Math.max(-1, Math.min(1, Number(y) || 0))); } catch {}
  }

  function dispose() {
    disposed = true;
    observer.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    try { model?.destroy?.(); } catch {}
    try { app?.destroy?.(true, { children: true, texture: true }); } catch {}
    model = null;
    app = null;
  }

  function getStats() {
    const seconds = Math.max(0.001, (performance.now() - mountedAt) / 1000);
    return { renderedFrames, averageFps: renderedFrames / seconds, mode: currentMotion.mode, live2d: true };
  }

  return { setMotion, setPointer, resize: fitModel, dispose, getStats };
}
