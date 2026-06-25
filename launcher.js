const $ = (selector) => document.querySelector(selector);
function on(selector, eventName, handler, options) {
  const element = typeof selector === "string" ? $(selector) : selector;
  if (!element) {
    console.warn(`Launcher: missing element for ${eventName}: ${selector}`);
    return null;
  }
  element.addEventListener(eventName, handler, options);
  return element;
}

const status = $("#launcher-status");

function setStatus(message) {
  if (status) status.textContent = message;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  if (!/^https?:\/\//i.test(tab.url || "")) throw new Error("Open a normal website tab first.");
  return tab;
}

function injectFloatingHelper(helperUrl, tailorUrl, iconUrl) {
  const existing = document.getElementById("jah-floating-helper-host");
  if (existing) {
    window.__jahFloatingHelperCleanup?.();
    existing.remove();
  }
  window.__jahFloatingHelperCleanup?.();

  const host = document.createElement("div");
  host.id = "jah-floating-helper-host";
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.right = "0";
  host.style.height = "100vh";
  host.style.width = "460px";
  host.style.zIndex = "2147483647";
  host.style.filter = "drop-shadow(-10px 0 26px rgba(21, 34, 29, .18))";
  const compactWidthPx = () => Math.min(420, Math.max(340, Math.round(window.innerWidth * 0.30)));
  const expandedWidthPx = () => Math.min(980, Math.max(720, Math.round(window.innerWidth * 0.62)));
  let workspaceMode = localStorage.getItem("jahWorkspaceMode") === "expanded" ? "expanded" : "compact";
  let activeBaseUrl = helperUrl;
  const widthNumberForMode = () => workspaceMode === "expanded" ? expandedWidthPx() : compactWidthPx();
  const widthForMode = () => `${widthNumberForMode()}px`;
  const urlForMode = (url) => `${url}${url.includes("?") ? "&" : "?"}workspaceMode=${workspaceMode}`;
  host.style.width = widthForMode();
  const previousHtmlStyle = document.documentElement.getAttribute("style") || "";
  const previousBodyStyle = document.body.getAttribute("style") || "";
  const previousHtmlClass = document.documentElement.className || "";
  const previousBodyClass = document.body.className || "";
  const splitStyle = document.createElement("style");
  splitStyle.id = "jah-floating-helper-layout-style";
  splitStyle.textContent = `
    html.jah-split-active {
      overflow-x: auto !important;
    }
    html.jah-split-active body {
      width: 100vw !important;
      max-width: 100vw !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
      padding-right: var(--jah-reserved-width) !important;
      transition: padding-right .18s ease;
    }
    html.jah-split-active body > *:not(#jah-floating-helper-host) {
      max-width: var(--jah-page-width) !important;
      box-sizing: border-box !important;
    }
    html.jah-split-active #global-nav,
    html.jah-split-active .global-nav,
    html.jah-split-active [role="banner"] {
      left: 0 !important;
      right: var(--jah-reserved-width) !important;
      width: auto !important;
      max-width: var(--jah-page-width) !important;
      box-sizing: border-box !important;
    }
    html.jah-split-active .global-nav__content {
      width: 100% !important;
      max-width: min(1128px, calc(var(--jah-page-width) - 24px)) !important;
      margin-left: auto !important;
      margin-right: auto !important;
      padding-left: 12px !important;
      padding-right: 12px !important;
      box-sizing: border-box !important;
    }
    html.jah-split-active #global-nav-search,
    html.jah-split-active .global-nav__search,
    html.jah-split-active .jobs-search-box,
    html.jah-split-active .jobs-search-box__container {
      min-width: 0 !important;
      max-width: clamp(220px, calc(var(--jah-page-width) - 360px), 560px) !important;
      box-sizing: border-box !important;
    }
    html.jah-split-active .application-outlet,
    html.jah-split-active .authentication-outlet,
    html.jah-split-active .scaffold-layout,
    html.jah-split-active .scaffold-layout__content {
      width: auto !important;
      max-width: var(--jah-page-width) !important;
      box-sizing: border-box !important;
    }
    html.jah-split-active .jobs-search-results-list,
    html.jah-split-active .jobs-search__left-rail,
    html.jah-split-active .jobs-search__job-details,
    html.jah-split-active .jobs-search__job-details--wrapper {
      max-width: var(--jah-page-width) !important;
      box-sizing: border-box !important;
    }
    html.jah-split-active .scaffold-layout__content {
      margin-left: 0 !important;
      margin-right: 0 !important;
    }
  `;
  document.documentElement.append(splitStyle);
  document.body.append(host);

  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; font-family: Inter, Arial, sans-serif; }
      .panel { position: fixed; inset: 0 0 0 auto; width: ${widthForMode()}; height: 100vh; border-left: 2px solid #9fb8ad; border-radius: 18px 0 0 18px; overflow: hidden; background: #fff; box-shadow: -12px 0 36px rgba(0,0,0,.18); display: none; transition: width .16s ease, border-color .16s ease; }
      .panel.open { display: block; }
      .bar { height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 10px 0 14px; background: #f5f3ed; border-bottom: 1px solid #e1e7e4; border-radius: 16px 0 0 0; color: #31443e; font: 700 12px Arial, sans-serif; }
      .bar-actions { display: flex; align-items: center; gap: 6px; }
      .bar button { border: 0; border-radius: 8px; padding: 5px 8px; background: #fff; color: #264f43; cursor: pointer; font: 700 11px Arial, sans-serif; }
      .bar button.active { background: #264f43; color: #fff; }
      .bar button.mode { min-width: 68px; }
      iframe { width: 100%; height: calc(100% - 42px); border: 0; background: #f5f3ed; }
      @media (max-width: 900px) { .panel { width: min(100vw, 560px) !important; } }
    </style>
    <section class="panel open">
      <div class="bar">
        <span>Job Workspace</span>
        <div class="bar-actions">
          <button class="nav active" data-url="${helperUrl}" type="button">Fill</button>
          <button class="nav" data-url="${tailorUrl}" type="button">Tailor</button>
          <button class="mode" type="button">${workspaceMode === "expanded" ? "Compact" : "Expand"}</button>
          <button class="minimize" type="button">Hide</button>
        </div>
      </div>
      <iframe src="${urlForMode(helperUrl)}" title="Job Application Helper"></iframe>
    </section>
  `;

  const panel = root.querySelector(".panel");
  const minimize = root.querySelector(".minimize");
  const modeButton = root.querySelector(".mode");
  const iframe = root.querySelector("iframe");
  const navButtons = [...root.querySelectorAll(".nav")];
  const splitGap = 8;
  let resizeNotifyTimer = null;
  const notifyPageResize = () => {
    window.clearTimeout(resizeNotifyTimer);
    resizeNotifyTimer = window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 40);
  };
  const applyDockLayout = ({ notify = true } = {}) => {
    const widthNumber = panel?.classList.contains("open") ? widthNumberForMode() : 0;
    const isOpen = widthNumber > 0;
    const reserved = isOpen ? widthNumber + splitGap : 0;
    document.documentElement.classList.toggle("jah-split-active", isOpen);
    document.body.classList.toggle("jah-split-active", isOpen);
    const available = Math.max(320, window.innerWidth - reserved);
    document.documentElement.style.setProperty("--jah-dock-width", `${widthNumber}px`);
    document.documentElement.style.setProperty("--jah-reserved-width", `${reserved}px`);
    document.documentElement.style.setProperty("--jah-page-width", `${available}px`);
    document.documentElement.style.setProperty("--jah-split-gap", `${isOpen ? splitGap : 0}px`);
    if (notify) notifyPageResize();
  };
  const applyMode = () => {
    const width = widthForMode();
    const isOpen = panel?.classList.contains("open");
    host.style.width = isOpen ? width : "0";
    panel.style.width = isOpen ? width : "0";
    applyDockLayout();
    modeButton.textContent = workspaceMode === "expanded" ? "Compact" : "Expand";
    iframe.src = urlForMode(activeBaseUrl);
    localStorage.setItem("jahWorkspaceMode", workspaceMode);
  };
  minimize?.addEventListener("click", () => {
    panel.classList.remove("open");
    host.style.width = "0";
    panel.style.width = "0";
    applyDockLayout();
  });
  modeButton?.addEventListener("click", () => {
    workspaceMode = workspaceMode === "expanded" ? "compact" : "expanded";
    applyMode();
  });
  for (const button of navButtons) {
    button.addEventListener("click", () => {
      activeBaseUrl = button.dataset.url;
      iframe.src = urlForMode(activeBaseUrl);
      navButtons.forEach((item) => item.classList.toggle("active", item === button));
      panel.classList.add("open");
      const width = widthForMode();
      host.style.width = width;
      panel.style.width = width;
      applyDockLayout();
    });
  }
  host.addEventListener("jah-open-helper", () => {
    panel.classList.add("open");
    const width = widthForMode();
    host.style.width = width;
    panel.style.width = width;
    applyDockLayout();
  });
  applyDockLayout();
  const handleResize = () => {
    window.clearTimeout(resizeNotifyTimer);
    const width = widthForMode();
    const isOpen = panel?.classList.contains("open");
    host.style.width = isOpen ? width : "0";
    panel.style.width = isOpen ? width : "0";
    applyDockLayout({ notify: false });
  };
  window.addEventListener("resize", handleResize);
  window.__jahFloatingHelperCleanup = () => {
    window.removeEventListener("resize", handleResize);
    window.clearTimeout(resizeNotifyTimer);
    splitStyle.remove();
    document.documentElement.className = previousHtmlClass;
    document.body.className = previousBodyClass;
    document.documentElement.setAttribute("style", previousHtmlStyle);
    document.body.setAttribute("style", previousBodyStyle);
    delete window.__jahFloatingHelperCleanup;
  };

  return "started";
}

function removeFloatingHelper() {
  window.__jahFloatingHelperCleanup?.();
  document.getElementById("jah-floating-helper-host")?.remove();
  return "stopped";
}

on("#start-helper", "click", async () => {
  try {
    const tab = await activeTab();
    await chrome.storage.local.set({ resumeTailorSourceTabId: tab.id, resumeTailorSourceUrl: tab.url || "" });
    const helperUrl = chrome.runtime.getURL("popup.html?floating=1");
    const tailorUrl = chrome.runtime.getURL(`resume_tailor.html?floating=1&sourceTabId=${tab.id}`);
    const iconUrl = chrome.runtime.getURL("icons/icon48.png");
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: injectFloatingHelper, args: [helperUrl, tailorUrl, iconUrl] });
    setStatus(result?.result === "already-running" ? "Workspace is already open on this page." : "Right-side workspace opened on this page.");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#stop-helper", "click", async () => {
  try {
    const tab = await activeTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: removeFloatingHelper });
    setStatus("Workspace stopped on this page.");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#open-profile", "click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("profile.html") });
});

on("#open-job-finder", "click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("job_finder.html") });
});

on("#open-tailor", "click", () => {
  activeTab()
    .then((tab) => {
      chrome.storage.local.set({ resumeTailorSourceTabId: tab.id, resumeTailorSourceUrl: tab.url || "" });
      chrome.tabs.create({ url: chrome.runtime.getURL(`resume_tailor.html?sourceTabId=${tab.id}`) });
    })
    .catch(() => chrome.tabs.create({ url: chrome.runtime.getURL("resume_tailor.html") }));
});

on("#open-settings", "click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
});

on("#open-full-helper", "click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
});
