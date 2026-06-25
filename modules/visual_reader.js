export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function screenshotWorkspaceMode(enabled) {
  const host = document.getElementById("jah-floating-helper-host");
  const pageWrap = document.getElementById("jah-page-split-content");
  if (enabled) {
    if (host) {
      host.dataset.jahPreviousDisplay = host.style.display || "";
      host.style.display = "none";
    }
    if (pageWrap) {
      pageWrap.dataset.jahPreviousWidth = pageWrap.style.width || "";
      pageWrap.style.width = "100vw";
    }
    return true;
  }
  if (host) {
    host.style.display = host.dataset.jahPreviousDisplay || "";
    delete host.dataset.jahPreviousDisplay;
  }
  if (pageWrap) {
    pageWrap.style.width = pageWrap.dataset.jahPreviousWidth || "";
    delete pageWrap.dataset.jahPreviousWidth;
  }
  return true;
}

function prepareVisualCapture({ hideWorkspace = true, startAtTop = false } = {}) {
  const state = {
    x: window.scrollX || 0,
    y: window.scrollY || 0,
    hideWorkspace
  };
  if (hideWorkspace) screenshotWorkspaceMode(true);
  if (startAtTop) window.scrollTo(0, 0);
  const doc = document.documentElement;
  const body = document.body;
  return {
    ...state,
    viewportHeight: window.innerHeight || doc.clientHeight || 900,
    viewportWidth: window.innerWidth || doc.clientWidth || 1200,
    pageHeight: Math.max(
      doc.scrollHeight || 0,
      body?.scrollHeight || 0,
      doc.offsetHeight || 0,
      body?.offsetHeight || 0
    ),
    currentY: window.scrollY || 0
  };
}

function scrollForVisualCapture(y) {
  window.scrollTo(0, Math.max(0, Number(y) || 0));
  return { y: window.scrollY || 0, title: document.title || "", url: location.href };
}

function restoreVisualCapture(state = {}) {
  if (state.hideWorkspace) screenshotWorkspaceMode(false);
  window.scrollTo(Number(state.x) || 0, Number(state.y) || 0);
  return true;
}

async function execute(tabId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result?.result;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load captured screenshot."));
    image.src = dataUrl;
  });
}

async function stitchCapturedImages(captures, {
  viewportHeight,
  startY,
  pageHeight,
  maxOutputWidth = 1600,
  maxOutputHeight = 14000,
  quality = 0.86
} = {}) {
  if (!captures.length) return "";
  if (captures.length === 1) return captures[0].dataUrl;
  const loaded = [];
  for (const capture of captures) {
    loaded.push({ ...capture, image: await loadImage(capture.dataUrl) });
  }
  const first = loaded[0];
  const pixelRatio = first.image.naturalHeight / Math.max(1, viewportHeight || first.image.naturalHeight);
  const sourceWidth = first.image.naturalWidth;
  const sourceStart = Math.min(...loaded.map((capture) => capture.y));
  const sourceEnd = Math.min(
    Number(pageHeight) || Number.MAX_SAFE_INTEGER,
    Math.max(...loaded.map((capture) => capture.y + viewportHeight))
  );
  const sourceHeight = Math.max(viewportHeight, sourceEnd - sourceStart) * pixelRatio;
  const outputScale = Math.min(1, maxOutputWidth / sourceWidth, maxOutputHeight / sourceHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
  canvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const capture of loaded) {
    const targetY = Math.round((capture.y - sourceStart) * pixelRatio * outputScale);
    const targetHeight = Math.round(capture.image.naturalHeight * outputScale);
    context.drawImage(capture.image, 0, targetY, canvas.width, targetHeight);
  }
  return canvas.toDataURL("image/jpeg", quality);
}

export async function capturePageScreenshots(tab, {
  mode = "long",
  maxScreenshots = 4,
  overlap = 140,
  startAtTop = false,
  hideWorkspace = true,
  stitch = false,
  visibleFallback = true,
  onProgress = () => {}
} = {}) {
  if (!tab?.id) throw new Error("No source page tab found.");
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const shouldRestore = currentTab?.id && currentTab.id !== tab.id;
  if (shouldRestore) {
    await chrome.tabs.update(tab.id, { active: true });
    await wait(450);
  }
  let state;
  let prepareError = null;
  try {
    state = await execute(tab.id, prepareVisualCapture, [{ hideWorkspace, startAtTop }]).catch((error) => {
      prepareError = error;
      return null;
    });
    await wait(250);
    if (!state) {
      if (!visibleFallback) throw new Error(`Could not prepare this page for visual reading${prepareError?.message ? `: ${prepareError.message}` : "."}`);
      onProgress("Could not access the page for long screenshot. Capturing the visible area instead...");
      const fallback = [await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 })];
      fallback.captureMode = "visible-fallback";
      fallback.prepareError = prepareError?.message || "";
      return fallback;
    }
    const positions = [];
    const viewportHeight = Math.max(500, Number(state.viewportHeight) || 900);
    const pageHeight = Math.max(viewportHeight, Number(state.pageHeight) || viewportHeight);
    const step = Math.max(360, viewportHeight - overlap);
    const startY = Math.max(0, Number(state.currentY) || 0);
    if (mode === "visible") {
      positions.push(startY);
    } else {
      for (let y = startY; y < pageHeight && positions.length < maxScreenshots; y += step) {
        positions.push(Math.min(y, Math.max(0, pageHeight - viewportHeight)));
      }
      if (!positions.length) positions.push(startY);
      const last = positions[positions.length - 1];
      const bottom = Math.max(0, pageHeight - viewportHeight);
      if (bottom > last + 280 && positions.length < maxScreenshots) positions.push(bottom);
    }
    const captures = [];
    for (let index = 0; index < positions.length; index += 1) {
      const scrolled = await execute(tab.id, scrollForVisualCapture, [positions[index]]).catch(() => null);
      await wait(index === 0 ? 350 : 550);
      onProgress(`Captured page view ${index + 1}/${positions.length}...`);
      captures.push({
        y: Number(scrolled?.y ?? positions[index]) || 0,
        dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 })
      });
    }
    if (!stitch || captures.length === 1) return captures.map((capture) => capture.dataUrl);
    onProgress("Stitching page views into one long screenshot...");
    const stitched = await stitchCapturedImages(captures, {
      viewportHeight,
      startY,
      pageHeight
    });
    return stitched ? [stitched] : captures.map((capture) => capture.dataUrl);
  } finally {
    if (state) await execute(tab.id, restoreVisualCapture, [state]).catch(() => {});
    if (shouldRestore) await chrome.tabs.update(currentTab.id, { active: true }).catch(() => {});
  }
}
