'use strict';

const petButton = document.querySelector('#petButton');
const petImage = document.querySelector('#petImage');
const speechBubble = document.querySelector('#speechBubble');
const petStage = document.querySelector('#petStage');
const pet3dCanvas = document.querySelector('#pet3dCanvas');
const petLive2dCanvas = document.querySelector('#petLive2dCanvas');
const radialMenu = document.querySelector('#radialMenu');
const clipboardBubble = document.querySelector('#clipboardBubble');
const companionId = new URLSearchParams(location.search).get('companionId') || '';
let pet3dRenderer = null;
let petLive2dRenderer = null;
let renderMode = '2d';
let lastMotion = { mode: 'idle', direction: 1, action: '' };
let threeFailed = false;
let activeModelKey = '';
let activeModelConfig = null;
let petStatus = { name: '暖暖', mood: 82, hunger: 76, affection: 20 };
let enabling3d = false;
let enablingLive2d = false;
let currentState = null;
let activeSkinSource = '';
let clipboardCandidate = null;
let clickThrough = null;
let petDragCandidate = null;
let suppressPetClick = false;
let petDropDepth = 0;
window.__quickPetRenderStats = () => pet3dRenderer?.getStats?.() || petLive2dRenderer?.getStats?.() || null;

function setClickThrough(ignore) {
  const next = Boolean(ignore);
  if (clickThrough === next) return;
  clickThrough = next;
  window.quickPet.setPetClickThrough(next);
}

function updateClickThroughAt(x, y, target = null) {
  if (petDragCandidate) return setClickThrough(false);
  const overlayOpen = petDropDepth > 0 || !radialMenu.classList.contains('hidden') || !clipboardBubble.classList.contains('hidden');
  const overPet = window.QuickPetHitRegion?.isPetPointInteractive({
    x,
    y,
    width: window.innerWidth,
    height: window.innerHeight,
    renderMode
  });
  setClickThrough(!(overlayOpen || overPet));
}

window.addEventListener('mousemove', (event) => updateClickThroughAt(event.clientX, event.clientY, event), { passive: true });
window.addEventListener('mouseleave', () => { if (!petDragCandidate) setClickThrough(true); });
requestAnimationFrame(() => setClickThrough(true));

petButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  petDragCandidate = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    active: false
  };
  try { petButton.setPointerCapture(event.pointerId); } catch {}
  window.quickPet.beginPetDrag(event.screenX, event.screenY);
  setClickThrough(false);
});

petButton.addEventListener('pointermove', (event) => {
  if (!petDragCandidate || event.pointerId !== petDragCandidate.pointerId) return;
  if (!petDragCandidate.active) {
    if (!window.QuickPetHitRegion?.shouldActivatePetDrag({
      startX: petDragCandidate.startX,
      startY: petDragCandidate.startY,
      currentX: event.screenX,
      currentY: event.screenY
    })) return;
    petDragCandidate.active = true;
    petButton.classList.add('dragging');
    window.quickPet.activatePetDrag();
  }
  window.quickPet.movePetDrag(event.screenX, event.screenY);
});

function finishPetDrag(event) {
  if (!petDragCandidate || event.pointerId !== petDragCandidate.pointerId) return;
  const wasDragging = petDragCandidate.active;
  petDragCandidate = null;
  if (petButton.hasPointerCapture(event.pointerId)) petButton.releasePointerCapture(event.pointerId);
  petButton.classList.remove('dragging');
  window.quickPet.endPetDrag();
  if (wasDragging) {
    suppressPetClick = true;
    event.preventDefault();
    event.stopPropagation();
  }
}

petButton.addEventListener('pointerup', finishPetDrag);
petButton.addEventListener('pointercancel', finishPetDrag);
petButton.addEventListener('lostpointercapture', finishPetDrag);

function hasDroppedContent(dataTransfer) {
  const types = [...(dataTransfer?.types || [])];
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
}

function resetPetDrop() {
  petDropDepth = 0;
  petButton.classList.remove('drop-ready');
}

function showPetDropFeedback(message, success = true) {
  speechBubble.textContent = message;
  speechBubble.classList.add('show');
  petButton.classList.toggle('fed', success);
  setTimeout(() => {
    petButton.classList.remove('fed');
    speechBubble.classList.remove('show');
    speechBubble.textContent = '点我打开快捷面板';
  }, 1400);
}

petButton.addEventListener('dragenter', (event) => {
  if (!hasDroppedContent(event.dataTransfer)) return;
  event.preventDefault();
  petDropDepth += 1;
  petButton.classList.add('drop-ready');
  setClickThrough(false);
});

petButton.addEventListener('dragover', (event) => {
  if (!hasDroppedContent(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

petButton.addEventListener('dragleave', (event) => {
  event.preventDefault();
  petDropDepth = Math.max(0, petDropDepth - 1);
  if (!petDropDepth) petButton.classList.remove('drop-ready');
});

petButton.addEventListener('drop', async (event) => {
  if (!hasDroppedContent(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  resetPetDrop();
  const paths = [...(event.dataTransfer.files || [])]
    .map((file) => {
      try { return window.quickPet.pathForFile(file); } catch { return ''; }
    })
    .filter(Boolean);
  const uri = String(event.dataTransfer.getData('text/uri-list') || '')
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith('#')) || '';
  const plain = String(event.dataTransfer.getData('text/plain') || '').trim();
  const target = uri || (/^(?:www\.|[a-z][a-z0-9+.-]*:)/i.test(plain) ? plain : '');
  try {
    let added = 0;
    let errors = [];
    if (paths.length) {
      const result = await window.quickPet.addPaths(paths);
      added += result.added.length;
      errors = result.errors;
    } else if (target) {
      await window.quickPet.addShortcut({ target });
      added = 1;
    }
    if (!added) throw new Error(errors[0]?.message || '没有识别到可收纳的内容');
    try { petStatus = await window.quickPet.interactWithPet('feed'); } catch {}
    const reaction = { ...lastMotion, mode: 'sit', action: 'feed' };
    pet3dRenderer?.setMotion(reaction);
    petLive2dRenderer?.setMotion(reaction);
    showPetDropFeedback(`收好啦 · ${added} 个快捷方式`);
  } catch (error) {
    const message = String(error?.message || error || '收纳失败').replace(/^Error invoking remote method '[^']+': Error: /, '');
    showPetDropFeedback(message, false);
  } finally {
    setClickThrough(true);
  }
});

async function enable3d() {
  if (pet3dRenderer || enabling3d || threeFailed || !window.QuickPet3DBundle?.mount) return;
  enabling3d = true;
  try {
    const modelBytes = await window.quickPet.getPetModel(companionId);
    if (renderMode !== '3d') return;
    pet3dRenderer = window.QuickPet3DBundle.mount(pet3dCanvas, {
      modelBytes,
      modelConfig: activeModelConfig,
      performanceMode: currentState?.settings?.performanceMode || 'efficient',
      secondary: Boolean(companionId),
      onModelError: () => {
        speechBubble.textContent = '这个 GLB 无法读取，请切换内置狐狸';
        speechBubble.classList.add('show');
        setTimeout(() => speechBubble.classList.remove('show'), 2800);
      }
    });
    pet3dRenderer.setMotion(lastMotion);
  } catch {
    threeFailed = true;
    renderMode = '2d';
    petStage.dataset.renderMode = '2d';
    pet3dCanvas.classList.add('hidden');
    petImage.classList.remove('hidden');
    speechBubble.textContent = '当前电脑无法启用 3D，已切回 2D';
    speechBubble.classList.add('show');
    setTimeout(() => speechBubble.classList.remove('show'), 2600);
  } finally {
    enabling3d = false;
  }
}

function disable3d() {
  pet3dRenderer?.dispose();
  pet3dRenderer = null;
}

async function enableLive2d() {
  if (petLive2dRenderer || enablingLive2d || !activeModelConfig || !window.QuickPetLive2DBundle?.mount) return;
  enablingLive2d = true;
  try {
    if (renderMode !== 'live2d') return;
    petLive2dRenderer = window.QuickPetLive2DBundle.mount(petLive2dCanvas, {
      modelUrl: `quickpet-model://${activeModelConfig.id}/${encodeURI(activeModelConfig.entryFile || activeModelConfig.fileName)}`,
      modelConfig: activeModelConfig,
      performanceMode: currentState?.settings?.performanceMode || 'efficient',
      secondary: Boolean(companionId),
      onModelError: () => {
        speechBubble.textContent = 'Live2D 模型文件不完整，请在模型体检中重新导入';
        speechBubble.classList.add('show');
        setTimeout(() => speechBubble.classList.remove('show'), 3000);
      }
    });
    petLive2dRenderer.setMotion(lastMotion);
  } finally {
    enablingLive2d = false;
  }
}

function disableLive2d() {
  petLive2dRenderer?.dispose();
  petLive2dRenderer = null;
}

function applyState(state) {
  currentState = state;
  const companion = state?.companions?.find((item) => item.id === companionId);
  const settings = companion ? { ...state.settings, petModelPreset: companion.modelPreset, activeModelId: companion.activeModelId, petRenderMode: companion.renderMode } : state?.settings;
  const activeModel = state?.models?.find((item) => item.id === settings?.activeModelId) || null;
  const customSkin = activeModel?.format === 'live2d' ? activeModel.thumbnailData : settings?.petImageData;
  const nextSkinSource = customSkin || '../../assets/default-pet.svg';
  if (nextSkinSource !== activeSkinSource) {
    activeSkinSource = nextSkinSource;
    petImage.src = nextSkinSource;
  }
  renderMode = activeModel?.format === 'live2d' ? 'live2d' : settings?.petRenderMode === '3d' ? '3d' : '2d';
  petStatus = state?.petStatus || petStatus;
  const nextModelKey = JSON.stringify([settings?.petModelPreset, activeModel?.id, activeModel?.format, activeModel?.transform, activeModel?.animationMap, settings?.performanceMode]);
  activeModelConfig = activeModel;
  if (nextModelKey !== activeModelKey) {
    activeModelKey = nextModelKey;
    disable3d();
    disableLive2d();
  }
  const use3d = renderMode === '3d';
  const useLive2d = renderMode === 'live2d';
  petStage.dataset.renderMode = renderMode;
  petImage.classList.toggle('hidden', use3d || useLive2d);
  pet3dCanvas.classList.toggle('hidden', !use3d);
  petLive2dCanvas.classList.toggle('hidden', !useLive2d);
  if (use3d) requestAnimationFrame(enable3d);
  else disable3d();
  if (useLive2d) requestAnimationFrame(enableLive2d);
  else disableLive2d();
}

window.quickPet.getState().then(applyState);
window.quickPet.onStateChanged(applyState);
window.quickPet.onPetMotion((motion) => {
  lastMotion = motion;
  petStage.dataset.motion = motion.mode || 'idle';
  petStage.dataset.direction = motion.direction < 0 ? 'left' : 'right';
  pet3dRenderer?.setMotion(motion);
  petLive2dRenderer?.setMotion(motion);
  if (Number.isFinite(motion.focusX)) {
    pet3dRenderer?.setPointer?.(motion.focusX, motion.focusY);
    petLive2dRenderer?.setPointer?.(motion.focusX, motion.focusY);
    const pointerX = window.innerWidth / 2 + motion.focusX * window.innerWidth * 1.4;
    const pointerY = window.innerHeight / 2 + motion.focusY * window.innerHeight * 1.4;
    updateClickThroughAt(pointerX, pointerY, document.elementFromPoint(pointerX, pointerY));
  }
  if (motion.action === 'hop' && renderMode !== '3d') {
    petButton.classList.remove('motion-hop');
    void petButton.offsetWidth;
    petButton.classList.add('motion-hop');
    setTimeout(() => petButton.classList.remove('motion-hop'), 680);
  }
});

petButton.addEventListener('click', async () => {
  if (suppressPetClick) {
    suppressPetClick = false;
    return;
  }
  petButton.classList.remove('bounce');
  void petButton.offsetWidth;
  petButton.classList.add('bounce');
  const reaction = { ...lastMotion, mode: 'look', action: 'pet' };
  pet3dRenderer?.setMotion(reaction);
  petLive2dRenderer?.setMotion(reaction);
  try { petStatus = await window.quickPet.interactWithPet('pet'); } catch {}
  speechBubble.textContent = petStatus.hunger < 24
    ? `${petStatus.name}有点饿了…`
    : petStatus.affection > 70 ? `${petStatus.name}很喜欢你！` : `摸摸${petStatus.name}～`;
  speechBubble.classList.add('show');
  await window.quickPet.togglePanel();
  setTimeout(() => {
    speechBubble.textContent = '点我打开快捷面板';
    speechBubble.classList.remove('show');
  }, 900);
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (event.shiftKey) window.quickPet.showPetMenu();
  else {
    radialMenu.classList.toggle('hidden');
    setClickThrough(radialMenu.classList.contains('hidden'));
  }
});

radialMenu.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-radial]')?.dataset.radial;
  if (!action) return;
  radialMenu.classList.add('hidden');
  setClickThrough(true);
  if (action === 'panel') await window.quickPet.togglePanel(true);
  else if (action === 'search') await window.quickPet.toggleSearch(true);
  else if (action === 'feed') await window.quickPet.interactWithPet('feed');
  else if (action === 'walk') await window.quickPet.updateSettings({ autoWalk: currentState?.settings?.autoWalk === false });
  else if (action === 'model') await window.quickPet.updateSettings({ petRenderMode: currentState?.settings?.petRenderMode === '3d' ? '2d' : '3d' });
  else if (action === 'notifications') await window.quickPet.openNotifications();
});

window.quickPet.onClipboardCandidate((candidate) => {
  if (companionId) return;
  clipboardCandidate = candidate;
  document.querySelector('#clipboardTarget').textContent = candidate.target;
  clipboardBubble.classList.remove('hidden');
  setClickThrough(false);
});
document.querySelector('#clipboardAccept').addEventListener('click', async () => {
  if (!clipboardCandidate) return;
  try { await window.quickPet.acceptClipboardCandidate(clipboardCandidate); } catch {}
  clipboardBubble.classList.add('hidden');
  clipboardCandidate = null;
  setClickThrough(true);
});
document.querySelector('#clipboardDismiss').addEventListener('click', async () => {
  if (clipboardCandidate) await window.quickPet.dismissClipboardCandidate(clipboardCandidate.target);
  clipboardBubble.classList.add('hidden');
  clipboardCandidate = null;
  setClickThrough(true);
});
