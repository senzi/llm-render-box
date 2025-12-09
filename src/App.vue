<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Codemirror } from 'vue-codemirror';
import { html as htmlLang } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { snapdom } from '@zumer/snapdom';
import { usePageStore } from './stores/pageStore';

const store = usePageStore();
const view = ref('dashboard');
const mode = ref('edit');
const codeValue = ref('');
const titleValue = ref('');
const dropActive = ref(false);
const toast = ref('');
const iframeRef = ref(null);
const saving = ref(false);
const dropCounter = ref(0);
let saveTimer = null;
let toastTimer = null;
let heightTimer = null;
let resizeObserver = null;
let mutationObserver = null;
const previewHeight = ref('70vh');

const currentPage = computed(() => store.currentPage);
const previewSrcdoc = computed(() => buildSrcdoc(codeValue.value));

const cmExtensions = [htmlLang(), oneDark];

const formattedPages = computed(() =>
  store.pages.map((p) => ({
    ...p,
    createdText: formatDate(p.createdAt),
  })),
);

onMounted(async () => {
  await store.loadPages();
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('dragover', preventGlobalDragDefaults);
  window.addEventListener('drop', preventGlobalDragDefaults);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('dragover', preventGlobalDragDefaults);
  window.removeEventListener('drop', preventGlobalDragDefaults);
  stopHeightSync();
});

watch(
  () => currentPage.value?.id,
  (val) => {
    if (val) {
      codeValue.value = currentPage.value.code || '';
      titleValue.value = currentPage.value.title || 'Untitled Snippet';
      mode.value = 'edit';
    }
  },
  { immediate: true },
);

watch(
  [codeValue, titleValue],
  () => {
    if (!currentPage.value) return;
    queueSave();
  },
  { flush: 'post' },
);

watch(previewSrcdoc, () => {
  // 预览内容刷新后自适应高度
  if (mode.value === 'preview') {
    scheduleHeightSync();
    attachHeightObservers();
  }
});

function showToast(message) {
  if (toastTimer) clearTimeout(toastTimer);
  toast.value = message;
  toastTimer = setTimeout(() => (toast.value = ''), 2200);
}

function onKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    handleManualSave();
  }
}

function preventGlobalDragDefaults(event) {
  event.preventDefault();
}

function queueSave() {
  if (!currentPage.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => handleAutoSave(), 500);
}

async function handleAutoSave() {
  if (!currentPage.value) return;
  saving.value = true;
  await store.updatePage(currentPage.value.id, {
    code: codeValue.value,
    title: titleValue.value,
  });
  saving.value = false;
}

async function handleManualSave() {
  await handleAutoSave();
  showToast('已保存');
}

async function handleNew() {
  const page = await store.createNewPage();
  view.value = 'workspace';
  codeValue.value = page.code;
  titleValue.value = page.title;
}

function handleOpen(id) {
  store.setCurrentPage(id);
  view.value = 'workspace';
}

async function handleDelete(pageId, event) {
  event.stopPropagation();
  const confirmed = confirm('Delete this page?');
  if (!confirmed) return;
  await store.deletePage(pageId);
}

function handleBack() {
  view.value = 'dashboard';
  mode.value = 'edit';
}

function togglePreview() {
  if (!currentPage.value) return;
  mode.value = mode.value === 'edit' ? 'preview' : 'edit';
  if (mode.value === 'preview') {
    scheduleHeightSync();
    attachHeightObservers();
  } else {
    stopHeightSync();
  }
}

function handleDropEnter() {
  dropCounter.value += 1;
  dropActive.value = true;
}

function handleDropLeave() {
  dropCounter.value = Math.max(0, dropCounter.value - 1);
  if (dropCounter.value === 0) {
    dropActive.value = false;
  }
}

async function handleDrop(event) {
  event.preventDefault();
  dropCounter.value = 0;
  dropActive.value = false;
  const files = Array.from(event.dataTransfer.files || []);
  if (!files.length) return;

  for (const file of files) {
    if (file.name.endsWith('.html')) {
      const text = await file.text();
      await store.createNewPage(stripExt(file.name), text);
    } else if (file.name.endsWith('.json')) {
      try {
        const json = JSON.parse(await file.text());
        const count = await store.importJsonPayload(json);
        showToast(`已导入 ${count} 个页面`);
      } catch (err) {
        showToast('导入失败');
      }
    }
  }
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

async function exportData() {
  const payload = await store.exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'llm-runner-backup.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function handleScreenshot() {
  if (mode.value !== 'preview' || !iframeRef.value) return;
  const target = await resolvePreviewTarget();
  if (!target) {
    showToast('截图失败：未找到预览内容');
    return;
  }
  try {
    // 等待两帧，确保布局稳定
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));

    const filename = `${(titleValue.value || 'snippet').replace(/\s+/g, '_')}_${Date.now()}`;
    const snapOptions = {
      type: 'png',
      scale: 2,
      backgroundColor: '#ffffff',
      cache: 'full',
      fast: false,
      placeholders: true,
    };

    let blob = null;
    try {
      blob = await snapdom.toBlob(target, snapOptions);
    } catch (err) {
      console.warn('snapdom.toBlob 失败，尝试 canvas 兜底', err);
      try {
        const canvas = await snapdom.toCanvas(target, snapOptions);
        blob = await new Promise((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))), 'image/png'),
        );
      } catch (err2) {
        console.warn('canvas 兜底失败', err2);
      }
    }
    if (!blob || !blob.size) throw new Error('未能获取截图数据');

    triggerDownload(blob, `${filename}.png`);
    await createThumbnailFromBlob(blob);
  } catch (err) {
    console.error(err);
    showToast('截图失败');
  }
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function triggerDownloadByUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

async function createThumbnailFromBlob(blob) {
  const data = await blobToDataUrl(blob);
  const pageId = currentPage.value?.id;
  if (!pageId) return;
  await store.updatePage(pageId, { thumbnail: data });
  await store.loadPages();
  await store.setCurrentPage(pageId);
  showToast('已截图（缩略图已更新）');
}


function onPreviewLoad() {
  attachHeightObservers();
}

function buildSrcdoc(content) {
  const safe = content || '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html, body { padding: 0; margin: 0; overflow: hidden; background: #ffffff; height: auto; }
    #runner-shell { width: 100%; }
  </style>
</head>
<body>
  <div id="runner-shell">${safe}</div>
</body>
</html>`;
}

async function resolvePreviewTarget() {
  const frame = iframeRef.value;
  if (!frame) return null;
  const tryPick = () =>
    frame.contentDocument?.body ||
    frame.contentDocument?.getElementById('runner-shell') ||
    frame.contentDocument?.documentElement ||
    null;

  let target = tryPick();
  if (target) return target;

  // 等待 iframe load 事件或短暂超时后再次尝试
  await new Promise((resolve) => setTimeout(resolve, 180));
  target = tryPick();
  if (target) return target;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(tryPick()), 600);
    frame.addEventListener(
      'load',
      () => {
        clearTimeout(timer);
        resolve(tryPick());
      },
      { once: true },
    );
  });
}

function measurePreviewHeight() {
  const frame = iframeRef.value;
  if (!frame) return;
  const doc = frame.contentDocument;
  if (!doc) return;
  const body = doc.body;
  const html = doc.documentElement;
  const height = Math.max(
    body?.scrollHeight || 0,
    body?.offsetHeight || 0,
    html?.scrollHeight || 0,
    html?.offsetHeight || 0,
  );
  const finalHeight = Math.max(height, 200);
  previewHeight.value = `${finalHeight}px`;
}

function scheduleHeightSync(attempts = 16, delay = 120) {
  stopHeightSync();
  const tick = (left) => {
    measurePreviewHeight();
    if (left > 0) {
      heightTimer = setTimeout(() => tick(left - 1), delay);
    }
  };
  tick(attempts);
}

function stopHeightSync() {
  if (heightTimer) {
    clearTimeout(heightTimer);
    heightTimer = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

function attachHeightObservers() {
  stopHeightSync();
  const frame = iframeRef.value;
  if (!frame) return;
  const doc = frame.contentDocument;
  const body = doc?.body;
  const html = doc?.documentElement;
  const shell = doc?.getElementById('runner-shell');
  if (!doc || !body) return;

  resizeObserver = new ResizeObserver(() => scheduleHeightSync(6, 80));
  resizeObserver.observe(body);
  if (html) resizeObserver.observe(html);
  if (shell) resizeObserver.observe(shell);

  mutationObserver = new MutationObserver(() => scheduleHeightSync(6, 80));
  mutationObserver.observe(body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  scheduleHeightSync();
}
</script>

<template>
  <div
    class="app-shell"
    @dragover.prevent="handleDropEnter"
    @dragenter.prevent="handleDropEnter"
    @dragleave="handleDropLeave"
    @drop="handleDrop"
  >
    <div class="topbar">
      <div class="brand">
        <span class="dot"></span>
        <div>
          <div class="brand-title">以太画廊 Ether Gallery</div>
          <div class="brand-sub">每一次对话，都是一张未完成的画卷</div>
        </div>
      </div>
      <div class="top-actions">
        <button class="ghost" @click="exportData">导出数据</button>
      </div>
    </div>

    <p class="safety-note">
      本工具完全本地运行，请确保粘贴的代码来源可信，自行承担运行风险。
    </p>

    <div v-if="view === 'dashboard'" class="dashboard">
      <div class="grid">
        <div
          v-for="page in formattedPages"
          :key="page.id"
          class="card"
          @click="handleOpen(page.id)"
        >
          <button class="delete" @click="(e) => handleDelete(page.id, e)">删除</button>
          <div class="thumb">
            <img v-if="page.thumbnail" :src="page.thumbnail" alt="" />
            <div v-else class="thumb-placeholder">
              <div class="placeholder-mark">暂无缩略图</div>
            </div>
          </div>
          <div class="meta">
            <div class="title">{{ page.title }}</div>
            <div class="time">{{ page.createdText }}</div>
          </div>
        </div>

        <div class="card new-card" @click="handleNew">
          <div class="plus">+</div>
          <div class="new-label">新建页面</div>
        </div>
      </div>
      <div class="import-hint">将 .html 或备份 .json 拖入页面即可导入</div>
    </div>

    <div v-else class="workspace">
      <div class="toolbar">
        <div class="left">
          <button class="ghost" @click="handleBack">&lt; 返回</button>
        </div>
        <div class="center">
          <input
            v-model="titleValue"
            type="text"
            class="title-input"
            placeholder="输入页面标题"
          />
          <span v-if="saving" class="saving-dot"></span>
        </div>
        <div class="right">
          <template v-if="mode === 'edit'">
            <button class="primary" @click="togglePreview">预览</button>
          </template>
          <template v-else>
            <button class="ghost" @click="togglePreview">返回编辑</button>
            <button class="primary" @click="handleScreenshot">截图</button>
          </template>
        </div>
      </div>

      <div class="workspace-body" v-if="currentPage">
        <Codemirror
          v-if="mode === 'edit'"
          v-model="codeValue"
          :extensions="cmExtensions"
          :autofocus="true"
          placeholder="在此粘贴或编写 HTML 片段..."
          class="editor"
        />

        <iframe
          v-else
          ref="iframeRef"
          :key="`${currentPage?.id || 'preview'}-${mode}`"
          class="preview"
          title="Preview"
          :srcdoc="previewSrcdoc"
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
          :style="{ height: previewHeight }"
          @load="onPreviewLoad"
        ></iframe>
      </div>
    </div>

    <div v-if="dropActive" class="drop-overlay">
      <div class="drop-box">释放以上传并导入</div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <footer class="footer">
      <a href="https://github.com/senzi/llm-render-box" target="_blank" rel="noreferrer">GitHub</a>
      <span>· MIT</span>
      <span>· vibe coding</span>
    </footer>
  </div>
</template>
