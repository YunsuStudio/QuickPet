import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import performancePolicy from '../shared/performance-policy.js';

const { targetFps, pixelRatioLimit } = performancePolicy;

const GROUND_Y = -0.72;

function animationByName(clips, pattern) {
  return clips.find((clip) => pattern.test(clip.name || '')) || null;
}

function prepareImportedModel(object, config = {}) {
  object.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(object);
  let size = box.getSize(new THREE.Vector3());
  if (size.z > size.x * 1.15) {
    object.rotation.y = Math.PI / 2;
    object.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(object);
    size = box.getSize(new THREE.Vector3());
  }

  const automaticScale = Math.min(2.85 / Math.max(0.01, size.x), 1.62 / Math.max(0.01, size.y));
  const customScale = THREE.MathUtils.clamp(Number(config.transform?.scale) || 1, 0.25, 3);
  object.scale.setScalar(automaticScale * customScale);
  object.rotation.y += THREE.MathUtils.degToRad(Number(config.transform?.rotationY) || 0)
    + (config.transform?.flip ? Math.PI : 0);
  object.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y += GROUND_Y - box.min.y
    + THREE.MathUtils.clamp(Number(config.transform?.verticalOffset) || 0, -1.5, 1.5);

  object.traverse((child) => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      if ('metalness' in material) material.metalness = Math.min(material.metalness || 0, 0.08);
      if ('roughness' in material) material.roughness = Math.max(material.roughness || 0, 0.58);
      material.needsUpdate = true;
    }
  });
}

export function mount(canvas, options = {}) {
  const performanceMode = options.performanceMode || 'efficient';
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: performanceMode !== 'efficient', powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.setPixelRatio(Math.min(pixelRatioLimit(performanceMode), window.devicePixelRatio || 1));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0.12, 0.34, 5.8);
  camera.lookAt(0, -0.03, 0);

  scene.add(new THREE.HemisphereLight(0xfff4e2, 0x555b70, 1.35));
  const keyLight = new THREE.DirectionalLight(0xfff9ef, 1.8);
  keyLight.position.set(3.6, 5.1, 5.2);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xe99867, 0.55);
  rimLight.position.set(-4.2, 2.3, -2.4);
  scene.add(rimLight);
  const fillLight = new THREE.DirectionalLight(0x929bd3, 0.3);
  fillLight.position.set(-2, 1.2, 5);
  scene.add(fillLight);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({ color: 0x11131b, transparent: true, opacity: 0.22, depthWrite: false })
  );
  shadow.position.set(-0.05, GROUND_Y - 0.025, 0);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.42, 0.38, 1);
  scene.add(shadow);

  const modelPivot = new THREE.Group();
  scene.add(modelPivot);
  let model = null;
  let mixer = null;
  let currentAction = null;
  let actions = {};
  let motion = { mode: 'idle', direction: 1, action: '' };
  let hopStartedAt = 0;
  let pointerX = 0;
  let pointerY = 0;
  let disposed = false;
  let renderedFrames = 0;
  const mountedAt = performance.now();
  const clock = new THREE.Clock();
  let previousElapsed = 0;
  let renderTimer = null;
  let lastRenderBudgetAt = 0;
  let pointerActiveUntil = 0;

  function playAction(action, speed = 1) {
    if (!action) return;
    if (action === currentAction) {
      action.setEffectiveTimeScale(speed);
      return;
    }
    action.enabled = true;
    action.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1).play();
    if (currentAction) currentAction.crossFadeTo(action, 0.38, false);
    currentAction = action;
  }

  function syncMotion() {
    if (!model) return;
    const selected = actions[motion.mode]
      || (motion.mode === 'look' ? actions.idle : null)
      || (motion.mode === 'run' ? actions.walk : null)
      || actions.idle
      || actions.walk;
    playAction(selected, motion.mode === 'run' ? 1.18 : 1);
  }

  function installModel(gltf) {
    model = gltf.scene || gltf.scenes?.[0];
    if (!model) throw new Error('GLB 中没有可显示的场景');
    prepareImportedModel(model, options.modelConfig || {});
    modelPivot.add(model);
    mixer = new THREE.AnimationMixer(model);
    const clips = gltf.animations || [];
    const mappedClip = (key, fallback) => {
      const mappedName = options.modelConfig?.animationMap?.[key];
      return clips.find((clip) => clip.name === mappedName) || fallback;
    };
    const idleClip = mappedClip('idle', animationByName(clips, /idle|breath|stand(?!up)|rest/i) || clips[0] || null);
    const walkClip = mappedClip('walk', animationByName(clips, /walk|trot/i) || animationByName(clips, /run/i) || clips[1] || idleClip);
    const actionFor = (key, pattern, fallback = idleClip) => {
      const clip = mappedClip(key, animationByName(clips, pattern) || fallback);
      return clip ? mixer.clipAction(clip) : null;
    };
    actions = {
      idle: idleClip ? mixer.clipAction(idleClip) : null,
      walk: walkClip ? mixer.clipAction(walkClip) : null,
      run: actionFor('run', /run|sprint|gallop/i, walkClip),
      sit: actionFor('sit', /sit|seat/i),
      sleep: actionFor('sleep', /sleep|lay|lie|nap/i),
      stretch: actionFor('stretch', /stretch/i),
      look: idleClip ? mixer.clipAction(idleClip) : null
    };
    syncMotion();
  }

  if (options.modelBytes) {
    const bytes = options.modelBytes;
    const arrayBuffer = bytes instanceof ArrayBuffer
      ? bytes
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
      try { installModel(gltf); } catch (error) { options.onModelError?.(error); }
    }, (error) => options.onModelError?.(error));
  } else {
    options.onModelError?.(new Error('没有可显示的 3D 模型'));
  }

  function resize() {
    const width = Math.max(2, canvas.clientWidth);
    const height = Math.max(2, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function setMotion(nextMotion) {
    motion = { ...motion, ...(nextMotion || {}) };
    if (['hop', 'pet', 'play'].includes(nextMotion?.action)) hopStartedAt = performance.now();
    if (Number.isFinite(nextMotion?.focusX)) {
      pointerX = THREE.MathUtils.clamp(nextMotion.focusX, -1, 1);
      pointerY = THREE.MathUtils.clamp(nextMotion.focusY, -1, 1);
      pointerActiveUntil = performance.now() + 900;
    }
    syncMotion();
  }

  function setPointer(x, y) {
    pointerX = THREE.MathUtils.clamp(Number(x) || 0, -1, 1);
    pointerY = THREE.MathUtils.clamp(Number(y) || 0, -1, 1);
    pointerActiveUntil = performance.now() + 900;
  }

  function onPointerMove(event) {
    const bounds = canvas.getBoundingClientRect();
    pointerX = ((event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5) * 2;
    pointerY = ((event.clientY - bounds.top) / Math.max(1, bounds.height) - 0.5) * 2;
    pointerActiveUntil = performance.now() + 900;
  }
  canvas.addEventListener('pointermove', onPointerMove);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  function scheduleRender() {
    if (disposed || document.hidden) return;
    renderTimer = requestAnimationFrame(render);
  }

  function render(frameTime) {
    if (disposed) return;
    const fps = targetFps(performanceMode, motion.mode, performance.now() < pointerActiveUntil || Boolean(hopStartedAt), Boolean(options.secondary));
    const frameInterval = 1000 / fps;
    const budgetElapsed = frameTime - lastRenderBudgetAt;
    if (lastRenderBudgetAt && budgetElapsed < frameInterval - 0.5) {
      scheduleRender();
      return;
    }
    lastRenderBudgetAt = lastRenderBudgetAt && budgetElapsed >= frameInterval
      ? frameTime - (budgetElapsed % frameInterval)
      : frameTime;
    const elapsed = clock.getElapsedTime();
    const delta = Math.min(0.05, Math.max(0, elapsed - previousElapsed));
    previousElapsed = elapsed;
    let hopHeight = 0;
    let crouch = 0;
    if (hopStartedAt) {
      const progress = (performance.now() - hopStartedAt) / 760;
      if (progress < 0.18) crouch = Math.sin((progress / 0.18) * Math.PI) * 0.11;
      else if (progress < 1) hopHeight = Math.sin(((progress - 0.18) / 0.82) * Math.PI) * 0.45;
      else hopStartedAt = 0;
    }
    const walking = motion.mode === 'walk' || motion.mode === 'run';
    modelPivot.position.y = hopHeight - crouch + (walking ? 0 : Math.sin(elapsed * 2.05) * 0.002);
    const follow = 1 - Math.exp(-delta * 5.5);
    modelPivot.rotation.y += (pointerX * 0.08 - modelPivot.rotation.y) * follow;
    modelPivot.rotation.x += (-pointerY * 0.035 - modelPivot.rotation.x) * follow;
    mixer?.update(delta);
    shadow.material.opacity = 0.22 - hopHeight * 0.2;
    shadow.scale.x = 1.42 - hopHeight * 0.35;
    renderer.render(scene, camera);
    renderedFrames += 1;
    scheduleRender();
  }
  function onVisibilityChange() {
    if (document.hidden) cancelAnimationFrame(renderTimer);
    else {
      lastRenderBudgetAt = 0;
      scheduleRender();
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  scheduleRender();

  function dispose() {
    disposed = true;
    cancelAnimationFrame(renderTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    observer.disconnect();
    canvas.removeEventListener('pointermove', onPointerMove);
    scene.traverse((object) => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose?.();
      }
      object.skeleton?.dispose?.();
    });
    mixer?.stopAllAction();
    mixer?.uncacheRoot(model);
    renderer.renderLists?.dispose?.();
    renderer.dispose();
  }

  function getStats() {
    const seconds = Math.max(0.001, (performance.now() - mountedAt) / 1000);
    return { renderedFrames, averageFps: renderedFrames / seconds, mode: motion.mode };
  }

  return { setMotion, setPointer, resize, dispose, getStats };
}
