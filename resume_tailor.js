import { analyzeResumeForJob, buildTailoredResumeText, cleanJdFromPageText, extractJdFromScreenshot, refineTailorText, rewriteResumeFromOriginal } from "./modules/resume_tailor.js";
import { sponsorshipStatusLabel } from "./modules/visa_filter.js";
import { getAiSettings } from "./modules/ai_client.js";
import { capturePageScreenshots } from "./modules/visual_reader.js";

const $ = (selector) => document.querySelector(selector);
function on(selector, eventName, handler, options) {
  const element = typeof selector === "string" ? $(selector) : selector;
  if (!element || typeof element.addEventListener !== "function") {
    console.warn(`Resume Tailor: missing element for ${eventName}: ${selector}`);
    return null;
  }
  element.addEventListener(eventName, handler, options);
  return element;
}

console.info(`Resume Tailor loaded v${chrome.runtime.getManifest().version}`);
const versionLabel = $("#tailor-version");
if (versionLabel) versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

const state = {
  jd: "",
  jdMeta: {},
  profile: {},
  resumeDetails: {},
  analysis: null,
  accepted: new Map(),
  pendingSuggestions: [],
  undoStack: []
};
const TEMP_STATE_KEY = "resumeTailorTempState";
const pageParams = new URLSearchParams(location.search);
document.body.classList.toggle("floating", pageParams.get("floating") === "1");
document.body.classList.toggle("workspace-expanded", pageParams.get("workspaceMode") === "expanded");
document.body.classList.toggle("workspace-compact", pageParams.get("floating") === "1" && pageParams.get("workspaceMode") !== "expanded");

function setStatus(message) {
  $("#status").textContent = message;
}

function applyTheme(theme) {
  const resolved = theme === "dark" ? "dark" : "light";
  document.body.classList.toggle("theme-dark", resolved === "dark");
  document.documentElement.dataset.jahMode = resolved;
  const toggle = $("#theme-toggle");
  if (toggle) toggle.textContent = resolved === "dark" ? "Light mode" : "Dark mode";
  chrome.storage.local.set({ resumeTailorTheme: resolved, jahThemeMode: resolved }).catch(() => {});
}

function applyLayout(layout) {
  const value = layout || "original";
  document.body.classList.remove("layout-original", "layout-classic", "layout-compact", "layout-modern");
  document.body.classList.add(`layout-${value}`);
  chrome.storage.local.set({ resumeTailorLayout: value }).catch(() => {});
}

async function initWorkspacePreferences() {
  const stored = await chrome.storage.local.get(["jahThemeMode", "resumeTailorTheme", "resumeTailorLayout"]);
  applyTheme(stored.jahThemeMode || stored.resumeTailorTheme || "light");
  const layoutSelect = $("#layout-template");
  if (layoutSelect) layoutSelect.value = stored.resumeTailorLayout || "original";
  applyLayout(layoutSelect?.value || stored.resumeTailorLayout || "original");
}

function confirmInline(message, { title = "Confirm action", yes = "Continue", no = "Cancel" } = {}) {
  return new Promise((resolve) => {
    const modal = $("#inline-confirm");
    const titleElement = $("#inline-confirm-title");
    const messageElement = $("#inline-confirm-message");
    const yesButton = $("#inline-confirm-yes");
    const noButton = $("#inline-confirm-no");
    if (!modal || !titleElement || !messageElement || !yesButton || !noButton) {
      console.warn("Resume Tailor: inline confirmation UI is missing.");
      resolve(false);
      return;
    }
    titleElement.textContent = title;
    messageElement.textContent = message;
    yesButton.textContent = yes;
    noButton.textContent = no;
    modal.classList.remove("hidden");
    const cleanup = (value) => {
      modal.classList.add("hidden");
      yesButton.removeEventListener("click", onYes);
      noButton.removeEventListener("click", onNo);
      modal.removeEventListener("pointerdown", onBackdrop);
      resolve(value);
    };
    const onYes = () => cleanup(true);
    const onNo = () => cleanup(false);
    const onBackdrop = (event) => {
      if (event.target === modal) cleanup(false);
    };
    yesButton.addEventListener("click", onYes);
    noButton.addEventListener("click", onNo);
    modal.addEventListener("pointerdown", onBackdrop);
  });
}

function show(selector) {
  $(selector)?.classList.remove("hidden");
}

function hide(selector) {
  $(selector)?.classList.add("hidden");
}

function setDisabled(selector, disabled) {
  const element = $(selector);
  if (element) element.disabled = Boolean(disabled);
}

function updateUndoButton() {
  setDisabled("#undo-resume", !state.undoStack.length);
}

function pushResumeHistory(reason = "") {
  const text = currentResumeText();
  if (!text.trim()) return;
  const last = state.undoStack.at(-1);
  if (last?.text === text) return;
  state.undoStack.push({ text, reason, savedAt: new Date().toISOString() });
  if (state.undoStack.length > 40) state.undoStack.shift();
  updateUndoButton();
}

function setResumeText(text, { preserveHistory = false } = {}) {
  if (!preserveHistory) pushResumeHistory("resume change");
  $("#resume-editor").value = text || "";
  $("#draft-text").value = text || "";
  renderResumePreview();
  renderDraftPreview();
  enableExports(Boolean(String(text || "").trim()));
}

async function undoResumeChange() {
  const previous = state.undoStack.pop();
  if (!previous) {
    setStatus("No resume changes to undo.");
    updateUndoButton();
    return;
  }
  setResumeText(previous.text, { preserveHistory: true });
  hideResumeAiPopover();
  await saveTempState();
  updateUndoButton();
  setStatus(`Undid last resume change${previous.reason ? `: ${previous.reason}` : ""}.`);
}

function chipList(element, items = []) {
  element.replaceChildren();
  for (const item of items.filter(Boolean).slice(0, 40)) {
    const chip = document.createElement("span");
    chip.textContent = item;
    element.append(chip);
  }
}

function listItems(element, items = []) {
  element.replaceChildren();
  for (const text of items.filter(Boolean)) {
    const item = document.createElement("li");
    item.textContent = text;
    element.append(item);
  }
}

async function activeTab() {
  const params = new URLSearchParams(location.search);
  const sourceTabId = Number(params.get("sourceTabId") || 0);
  if (sourceTabId > 0) {
    try {
      const tab = await chrome.tabs.get(sourceTabId);
      if (tab?.id && /^https?:\/\//i.test(tab.url || "")) return tab;
    } catch {}
  }
  const stored = await chrome.storage.local.get(["resumeTailorSourceTabId"]);
  const storedTabId = Number(stored.resumeTailorSourceTabId || 0);
  if (storedTabId > 0) {
    try {
      const tab = await chrome.tabs.get(storedTabId);
      if (tab?.id && /^https?:\/\//i.test(tab.url || "")) return tab;
    } catch {}
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) throw new Error("Open a normal job page first.");
  return tab;
}

function extractJobPageText() {
  const normalize = (value) => String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/â€™|â€˜/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€“|â€”/g, "-")
    .replace(/â€¢/g, "•")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\r/g, "\n");
  const clean = (value) => normalize(value)
    .replace(/\b(apply now|sign in|log in|cookie|privacy policy|terms of use|share|save job|back to jobs)\b/gi, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const noiseLinePattern = /^(apply|save|share|sign in|log in|view profile|open article|status is online|messaging|write a message|promoted by|viewed|actively reviewing|easy apply|show match details|tailor my resume|your ai-powered job assessment|premium|job application helper|resume tailor|fill one page|scan page|start workspace|hide|fill|tailor)$/i;
  const stopLinePattern = /^(show less|show more|meet the hiring team|people also viewed|similar jobs|recommended jobs|jobs you may be interested|about the company|company overview|seniority level|employment type|job function|industries|set alert|report this job|your ai-powered job assessment|premium)$/i;
  const compactLines = (value) => {
    const seen = new Set();
    const lines = [];
    for (const rawLine of normalize(value).split("\n")) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (/https?:\/\/|www\.|match_token=|ziprecruiter\.com/i.test(line)) continue;
      if (noiseLinePattern.test(line)) continue;
      const key = line.toLowerCase().replace(/[^a-z0-9]+/g, " ").slice(0, 220);
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
    return lines;
  };
  const cleanJobText = (value) => compactLines(value).join("\n").trim();
  const noiseSelector = "nav, header, footer, aside, script, style, noscript, svg, button, form, input, select, textarea, [role=banner], [role=navigation], [role=contentinfo], [aria-hidden=true]";
  const anchorPattern = /\b(about the job|about this job|job description|job details|about the role|the role|responsibilities|what you(?:'|’)ll do|what you will do|requirements|qualifications|minimum qualifications|preferred qualifications|who you are)\b/i;
  const selectors = [
    ".jobs-description",
    ".jobs-box__html-content",
    ".jobs-description__content",
    ".jobs-unified-description__content",
    "[class*=jobs-description]",
    "[class*=job-details]",
    "[data-testid*=description]",
    "[data-test*=description]",
    "[class*=description]",
    "[class*=posting]",
    "[class*=job-description]",
    "[data-testid*=posting]",
    "[data-test*=posting]",
    "main",
    "article",
    "[role=main]"
  ];
  const scoreText = (text) => {
    if (!text || text.length < 250) return 0;
    const lower = text.toLowerCase();
    const keywordScore = ["responsibilities", "requirements", "qualifications", "about the role", "what you", "experience", "skills", "salary", "compensation"].reduce((sum, word) => sum + (lower.includes(word) ? 800 : 0), 0);
    const noisePenalty = (text.match(/https?:\/\/|match_token=|ziprecruiter|open article|messaging|view profile/gi) || []).length * 2500;
    return Math.min(text.length, 30000) + keywordScore - noisePenalty;
  };
  const htmlToText = (value) => {
    const holder = document.createElement("div");
    holder.innerHTML = String(value || "");
    return cleanJobText(holder.innerText || holder.textContent || value || "");
  };
  const findJobPosting = (value) => {
    if (!value) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findJobPosting(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof value !== "object") return null;
    const type = value["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((item) => String(item || "").toLowerCase() === "jobposting")) return value;
    return findJobPosting(value["@graph"]) || findJobPosting(value.mainEntity) || findJobPosting(value.itemListElement);
  };
  const structuredJob = () => {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || "{}");
        const job = findJobPosting(parsed);
        if (!job) continue;
        const location = Array.isArray(job.jobLocation) ? job.jobLocation[0] : job.jobLocation;
        const address = location?.address || {};
        const company = typeof job.hiringOrganization === "string" ? job.hiringOrganization : job.hiringOrganization?.name;
        return {
          title: clean(job.title || ""),
          company: clean(company || ""),
          location: clean([address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(", ") || location?.name || ""),
          text: htmlToText(job.description || "")
        };
      } catch {}
    }
    return null;
  };
  const selectedText = clean(String(getSelection?.()?.toString?.() || ""));
  if (selectedText.length > 300) {
    return {
      url: window.location.href,
      title: clean(document.querySelector("h1")?.innerText || document.title),
      company: "",
      location: "",
      text: cleanJobText(selectedText).slice(0, 35000)
    };
  }
  const nodeText = (node) => {
    const clone = node.cloneNode(true);
    clone.querySelectorAll?.(noiseSelector).forEach((item) => item.remove());
    return cleanJobText(clone.innerText || clone.textContent || "");
  };
  const anchoredFromLines = (rawText) => {
    const lines = compactLines(rawText);
    const start = lines.findIndex((line) => anchorPattern.test(line));
    if (start < 0) return "";
    const output = [];
    for (let index = start; index < lines.length && output.length < 140; index += 1) {
      const line = lines[index];
      if (index > start && stopLinePattern.test(line)) break;
      output.push(line);
    }
    const text = output.join("\n").trim();
    return text.length > 300 ? text : "";
  };
  const anchoredText = () => {
    const fromBody = anchoredFromLines(document.body?.innerText || "");
    if (fromBody) return fromBody;
    const candidates = [...document.querySelectorAll("h1,h2,h3,h4,strong,b,p,span,div")].filter((node) => {
      const text = clean(node.innerText || node.textContent || "");
      return text.length >= 4 && text.length <= 120 && anchorPattern.test(text);
    });
    for (const anchor of candidates) {
      const pieces = [];
      let current = anchor;
      let safety = 0;
      while (current && safety < 80) {
        const text = nodeText(current);
        if (text && text.length < 12000) pieces.push(text);
        current = current.nextElementSibling;
        safety += 1;
      }
      let parent = anchor.parentElement;
      for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
        const text = nodeText(parent);
        if (text.length > pieces.join(" ").length && text.length < 45000) pieces.push(text);
      }
      const merged = cleanJobText(pieces.join("\n"));
      if (merged.length > 500) return merged;
    }
    return "";
  };
  const candidates = [];
  const structured = structuredJob();
  if (structured?.text && structured.text.length > 500) {
    candidates.push({ source: "structured", text: structured.text, boost: 5000 });
  }
  const anchored = anchoredText();
  if (anchored) candidates.push({ source: "anchored", text: anchored, boost: 4000 });
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      const text = nodeText(node);
      if (text.length > 500) candidates.push({ source: selector, text, boost: 0 });
    }
  }
  const bestCandidate = candidates
    .map((item) => ({ ...item, score: scoreText(item.text) + item.boost }))
    .filter((item) => item.score > 800)
    .sort((a, b) => b.score - a.score)[0];
  const title = clean(document.querySelector("h1")?.innerText || document.title);
  const company = clean(document.querySelector("[data-testid*=company], [class*=company]")?.innerText || "");
  const locationText = clean(document.querySelector("[data-testid*=location], [class*=location]")?.innerText || "");
  return {
    url: window.location.href,
    title: structured?.title || title,
    company: structured?.company || company,
    location: structured?.location || locationText,
    source: bestCandidate?.source || "",
    text: (bestCandidate?.text || "").slice(0, 35000)
  };
}

function jdScore(extracted = {}) {
  const text = String(extracted.text || "");
  const lower = text.toLowerCase();
  const hits = ["about the job", "job description", "responsibilities", "requirements", "qualifications", "what you'll do", "what you will do", "salary", "compensation"].filter((term) => lower.includes(term)).length;
  const noise = (text.match(/https?:\/\/|match_token=|ziprecruiter|messaging|open article/gi) || []).length;
  return text.length + hits * 2500 - noise * 5000;
}

function bestExtractedJobText(results = []) {
  return results
    .map((item) => item.result)
    .filter((item) => item && String(item.text || "").trim())
    .sort((a, b) => jdScore(b) - jdScore(a))[0] || {};
}

function setWorkspaceScreenshotMode(enabled) {
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureJobPageScreenshot(tab) {
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const shouldRestore = currentTab?.id && currentTab.id !== tab.id;
  if (shouldRestore) {
    await chrome.tabs.update(tab.id, { active: true });
    await wait(500);
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: setWorkspaceScreenshotMode, args: [true] }).catch(() => {});
    await wait(250);
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 });
  } finally {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: setWorkspaceScreenshotMode, args: [false] }).catch(() => {});
    if (shouldRestore) await chrome.tabs.update(currentTab.id, { active: true }).catch(() => {});
  }
}

async function loadProfile() {
  const stored = await chrome.storage.local.get(["profile", "resumeDetails"]);
  state.profile = stored.profile || {};
  state.resumeDetails = stored.resumeDetails || {};
  if (!Object.values(state.profile).some((value) => String(value || "").trim()) && !Object.values(state.resumeDetails).some((value) => Array.isArray(value) && value.length)) {
    throw new Error("Your profile is empty. Open Profile Manager first.");
  }
}

function fileSafeName(value) {
  return String(value || "tailored-resume").replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 90) || "tailored-resume";
}

function download(filename, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pdfSafeText(value) {
  return String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[•·]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapPdfLine(line, maxChars, hangingIndent = 0) {
  const words = String(line || "").split(/\s+/).filter(Boolean);
  const rows = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      rows.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) rows.push(current);
  return rows.map((text, index) => ({ text, indent: index ? hangingIndent : 0 }));
}

function buildResumePdfBlob() {
  const text = currentResumeText().trim();
  const layout = $("#layout-template")?.value || "original";
  const compact = layout === "compact";
  const pageWidth = 612;
  const pageHeight = 792;
  const marginX = 54;
  const marginTop = 56;
  const marginBottom = 48;
  const usableWidth = pageWidth - marginX * 2;
  const bodySize = compact ? 10.2 : 11;
  const bodyLeading = compact ? 13.2 : 14.8;
  const sectionSize = 10.5;
  const commandsByPage = [[]];
  let pageIndex = 0;
  let y = pageHeight - marginTop;

  const page = () => commandsByPage[pageIndex];
  const newPage = () => {
    commandsByPage.push([]);
    pageIndex += 1;
    y = pageHeight - marginTop;
  };
  const ensureSpace = (space) => {
    if (y - space < marginBottom) newPage();
  };
  const addText = (value, x, size, font = "F1", align = "left") => {
    const safe = pdfSafeText(value);
    const estimateWidth = String(value || "").length * size * 0.48;
    const tx = align === "center" ? Math.max(marginX, (pageWidth - estimateWidth) / 2) : x;
    page().push(`BT /${font} ${size} Tf 1 0 0 1 ${tx.toFixed(2)} ${y.toFixed(2)} Tm (${safe}) Tj ET`);
  };
  const addRule = () => {
    page().push(`${marginX.toFixed(2)} ${(y - 4).toFixed(2)} m ${(pageWidth - marginX).toFixed(2)} ${(y - 4).toFixed(2)} l S`);
  };

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  lines.forEach((line, index) => {
    const isName = index === 0;
    const isContact = index === 1 && /@|\||\+|linkedin|github/i.test(line);
    const isSection = /^(summary|skills|experience|projects|education|certifications|languages)$/i.test(line);
    if (isName) {
      ensureSpace(28);
      addText(line, marginX, 18, "F4", "center");
      y -= 22;
      return;
    }
    if (isContact) {
      ensureSpace(18);
      addText(line, marginX, 8.8, "F3", "center");
      y -= 18;
      return;
    }
    if (isSection) {
      ensureSpace(24);
      y -= 6;
      addText(line.toUpperCase(), marginX, sectionSize, "F4");
      addRule();
      y -= 16;
      return;
    }
    const bullet = /^[-*]\s+/.test(line);
    const x = marginX + (bullet ? 8 : 0);
    const maxChars = Math.max(45, Math.floor((usableWidth - (bullet ? 12 : 0)) / (bodySize * 0.48)));
    for (const row of wrapPdfLine(line, maxChars, bullet ? 12 : 0)) {
      ensureSpace(bodyLeading);
      addText(row.text, x + row.indent, bodySize, "F1");
      y -= bodyLeading;
    }
    y -= 2;
  });

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontRegularId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>");
  const fontBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>");
  const fontSansId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontSansBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds = [];
  for (const commands of commandsByPage) {
    const content = commands.join("\n");
    const contentId = addObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R /F3 ${fontSansId} 0 R /F4 ${fontSansBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function exportResumePdf() {
  const filename = `${fileSafeName([state.analysis?.job?.company, state.analysis?.job?.title].filter(Boolean).join(" - "))}.pdf`;
  const url = URL.createObjectURL(buildResumePdfBlob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


function acceptedBullets() {
  return [...state.accepted.values()];
}

function currentResumeText() {
  const editorText = $("#resume-editor")?.value || "";
  if (editorText.trim()) return editorText;
  const preview = $("#resume-preview");
  if (preview && !preview.classList.contains("empty")) {
    const blocks = [...preview.querySelectorAll(".resume-block")].map((block) => block.innerText || "").join("\n");
    if (blocks.trim()) return blocks;
  }
  return $("#draft-text")?.value || "";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
}

function resumeBlockHtml(text) {
  const lines = String(text || "").split(/\n/);
  return lines.map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    let cls = "resume-block";
    if (index === 0) cls += " resume-name";
    else if (index === 1 && /@|\||\+|linkedin|github/i.test(trimmed)) cls += " resume-contact";
    else if (/^(summary|skills|experience|projects|education|certifications|languages)$/i.test(trimmed)) cls += " resume-section";
    return `<div class="${cls}" data-line="${index}" contenteditable="false">${escapeHtml(line)}</div>`;
  }).join("\n");
}

function enableExports(enabled = true) {
  $("#export-text").disabled = !enabled;
  $("#export-html").disabled = !enabled;
  $("#export-pdf").disabled = !enabled;
}

function suggestionTargetBlock(suggestion) {
  const blocks = [...document.querySelectorAll("#resume-preview .resume-block")];
  if (!blocks.length) return null;
  const needles = [suggestion.original, suggestion.source, suggestion.section, suggestion.jd_keyword]
    .map((item) => String(item || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter((item) => item.length >= 3);
  for (const needle of needles) {
    const target = blocks.find((block) => block.innerText.toLowerCase().replace(/[^a-z0-9]+/g, " ").includes(needle.slice(0, 80)));
    if (target) return target;
  }
  const section = String(suggestion.section || "").toLowerCase();
  if (section) {
    const sectionBlock = blocks.find((block) => block.classList.contains("resume-section") && block.innerText.toLowerCase().includes(section));
    if (sectionBlock) return sectionBlock;
  }
  return blocks.find((block) => !block.classList.contains("resume-name") && !block.classList.contains("resume-contact")) || blocks[0];
}

function applySuggestionToResume(suggestion, card) {
  const block = suggestionTargetBlock(suggestion);
  if (!block) return;
  pushResumeHistory("applied suggestion");
  if (suggestion.original && block.innerText.trim() && !block.classList.contains("resume-section")) {
    block.textContent = suggestion.suggested || block.innerText;
  } else {
    const bullet = document.createElement("div");
    bullet.className = "resume-block";
    bullet.contentEditable = "false";
    bullet.textContent = /^[-•]/.test(String(suggestion.suggested || "").trim()) ? suggestion.suggested : `- ${suggestion.suggested || ""}`;
    block.after(bullet);
  }
  state.accepted.set(suggestion.id, suggestion);
  card?.remove();
  syncPreviewToEditor();
  saveTempState();
}

function suggestionsForBlock(block) {
  if (!block) return [];
  const blockText = block.innerText.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const section = block.classList.contains("resume-section") ? block.innerText.toLowerCase() : "";
  const scored = (state.pendingSuggestions || []).filter((suggestion) => !state.accepted.has(suggestion.id)).map((suggestion) => {
    const haystack = [suggestion.original, suggestion.source, suggestion.section, suggestion.jd_keyword, suggestion.reason].join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ");
    let score = 0;
    for (const token of blockText.split(/\s+/).filter((item) => item.length > 3)) if (haystack.includes(token)) score += 1;
    if (section && haystack.includes(section)) score += 4;
    if (suggestionTargetBlock(suggestion) === block) score += 6;
    return { suggestion, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  return (scored.length ? scored : (state.pendingSuggestions || []).filter((suggestion) => !state.accepted.has(suggestion.id)).map((suggestion) => ({ suggestion, score: 0 }))).slice(0, 5).map((item) => item.suggestion);
}

function renderSuggestionDrawer(block = selectedResumeBlock()) {
  const drawer = $("#suggestion-drawer");
  const list = $("#suggestion-drawer-list");
  if (!drawer || !list || !block || !(state.pendingSuggestions || []).length) {
    drawer?.classList.add("hidden");
    return;
  }
  $("#suggestion-drawer-context").textContent = `Selected: ${String(block.innerText || "").slice(0, 90)}`;
  list.replaceChildren();
  const suggestions = suggestionsForBlock(block);
  if (!suggestions.length) {
    const empty = document.createElement("p");
    empty.className = "muted small";
    empty.textContent = "No suggestions for this block yet. Analyze the JD first.";
    list.append(empty);
  }
  for (const suggestion of suggestions) {
    const card = document.createElement("div");
    card.className = "drawer-suggestion";
    const title = document.createElement("strong");
    title.textContent = `${suggestion.section || "Resume"} suggestion`;
    const body = document.createElement("div");
    body.textContent = suggestion.suggested || "";
    const meta = document.createElement("small");
    meta.textContent = [suggestion.jd_keyword, suggestion.reason].filter(Boolean).join(" | ");
    const actions = document.createElement("div");
    actions.className = "suggestion-actions";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "Apply";
    const ask = document.createElement("button");
    ask.type = "button";
    ask.className = "secondary";
    ask.textContent = "Ask AI";
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "secondary";
    skip.textContent = "Skip";
    accept.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applySuggestionToResume(suggestion, card);
    });
    ask.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectResumeBlock(block);
      $("#resume-ai-instruction").value = `Revise this block using this suggestion if truthful: ${suggestion.suggested || ""}`;
      showResumeAiPopover(block, { focus: true });
    });
    skip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.remove();
      if (!list.children.length) drawer.classList.add("hidden");
    });
    actions.append(accept, ask, skip);
    card.append(title, body, meta, actions);
    list.append(card);
  }
  drawer.classList.remove("hidden");
}

function renderResumePreview() {
  const preview = $("#resume-preview");
  const wasHidden = preview.classList.contains("hidden");
  const text = currentResumeText();
  if (!text.trim()) {
    preview.className = "resume-preview empty";
    preview.classList.toggle("hidden", wasHidden);
    preview.textContent = "Load your current profile resume or analyze a JD to preview the final CV here.";
    return;
  }
  preview.className = "resume-preview";
  preview.classList.toggle("hidden", wasHidden);
  preview.innerHTML = resumeBlockHtml(text);
  enableExports(true);
}

function renderDraftPreview() {
  const preview = $("#draft-preview");
  if (!preview) return;
  const text = $("#draft-text")?.value || currentResumeText();
  if (!text.trim()) {
    preview.className = "resume-preview export-preview empty";
    preview.textContent = "Your export preview will appear here.";
    return;
  }
  preview.className = "resume-preview export-preview";
  preview.innerHTML = resumeBlockHtml(text);
}

function selectedResumeBlock() {
  return $("#resume-preview .resume-block.selected");
}

function hideResumeAiPopover() {
  $("#resume-ai-popover")?.classList.add("hidden");
}

function hideSuggestionDrawer() {
  $("#suggestion-drawer")?.classList.add("hidden");
}

function placeResumeAiPopover(block) {
  const popover = $("#resume-ai-popover");
  if (!popover || !block || $("#resume-preview").classList.contains("empty")) return;
  const rect = block.getBoundingClientRect();
  const width = Math.min(330, window.innerWidth - 24);
  const canRight = rect.right + 12 + width < window.innerWidth;
  const left = canRight ? rect.right + 12 : Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
  const top = Math.max(12, Math.min(window.innerHeight - 220, rect.bottom + 8));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.classList.remove("hidden");
}

function showResumeAiPopover(block = selectedResumeBlock(), { focus = true } = {}) {
  if (!block) {
    setStatus("Click one resume block first.");
    return;
  }
  $("#resume-ai-instruction").value ||= "Make this stronger but truthful for this JD.";
  placeResumeAiPopover(block);
  if (focus) $("#resume-ai-instruction").focus();
}

function selectResumeBlock(block) {
  $("#resume-preview")?.querySelectorAll(".resume-block.selected").forEach((item) => item.classList.remove("selected"));
  if (block) {
    block.classList.add("selected");
    renderSuggestionDrawer(block);
    showResumeAiPopover(block, { focus: false });
  } else {
    hideResumeAiPopover();
    hideSuggestionDrawer();
  }
}

function finishResumeBlockEdit(block) {
  if (!block) return;
  block.contentEditable = "false";
  block.classList.remove("editing");
  syncPreviewToEditor();
  clearTimeout(window.__resumeTailorSaveTimer);
  window.__resumeTailorSaveTimer = setTimeout(saveTempState, 300);
}

function beginResumeBlockEdit(block) {
  if (!block || $("#resume-preview").classList.contains("empty")) return;
  pushResumeHistory("manual edit");
  selectResumeBlock(block);
  block.contentEditable = "true";
  block.classList.add("editing");
  block.focus();
  const range = document.createRange();
  range.selectNodeContents(block);
  range.collapse(false);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function replaceResumeBlock(block, text) {
  if (!block) return;
  block.textContent = text || "";
  finishResumeBlockEdit(block);
}

function syncPreviewToEditor() {
  const preview = $("#resume-preview");
  if (!preview || preview.classList.contains("empty")) return;
  const text = [...preview.querySelectorAll(".resume-block")].map((block) => block.innerText || "").join("\n");
  $("#resume-editor").value = text;
  $("#draft-text").value = text;
  renderDraftPreview();
}

function setResumeMode(mode) {
  const editing = mode === "edit";
  $("#resume-editor").classList.toggle("hidden", !editing);
  $("#resume-preview").classList.toggle("hidden", editing);
  $("#resume-edit-mode").classList.toggle("active", editing);
  $("#resume-preview-mode").classList.toggle("active", !editing);
  if (editing) hideResumeAiPopover();
  if (!editing) renderResumePreview();
}

function refreshDraft({ preserveResumeText = false } = {}) {
  if (!state.analysis) return;
  pushResumeHistory("refreshed draft");
  const draft = buildTailoredResumeText(state.profile, state.resumeDetails, state.analysis, acceptedBullets());
  $("#draft-text").value = draft;
  if (!preserveResumeText) $("#resume-editor").value = draft;
  renderResumePreview();
  renderDraftPreview();
  enableExports(Boolean(currentResumeText().trim()));
  saveTempState();
}

async function saveTempState() {
  const payload = {
    savedAt: new Date().toISOString(),
    jd: $("#jd-text")?.value || state.jd || "",
    jdMeta: state.jdMeta,
    analysis: state.analysis,
    accepted: acceptedBullets(),
    pendingSuggestions: state.pendingSuggestions || [],
    undoStack: state.undoStack,
    resumeText: currentResumeText(),
    coverLetter: $("#cover-letter")?.value || "",
    provider: $("#provider")?.value || "",
    strategy: $("#strategy")?.value || "balanced",
    layout: $("#layout-template")?.value || "original"
  };
  await chrome.storage.local.set({ [TEMP_STATE_KEY]: payload });
}

async function restoreTempState() {
  const stored = await chrome.storage.local.get(TEMP_STATE_KEY);
  const payload = stored[TEMP_STATE_KEY];
  if (!payload) return;
  state.jd = payload.jd || "";
  state.jdMeta = payload.jdMeta || {};
  state.analysis = payload.analysis || null;
  state.accepted = new Map((payload.accepted || []).map((item) => [item.id, item]));
  state.pendingSuggestions = payload.pendingSuggestions || state.analysis?.bullet_suggestions || [];
  state.undoStack = Array.isArray(payload.undoStack) ? payload.undoStack.slice(-40) : [];
  $("#jd-text").value = state.jd;
  $("#resume-editor").value = payload.resumeText || "";
  $("#draft-text").value = payload.resumeText || "";
  $("#cover-letter").value = payload.coverLetter || "";
  $("#provider").value = payload.provider || "";
  $("#strategy").value = payload.strategy || "balanced";
  if (payload.layout) {
    $("#layout-template").value = payload.layout;
    applyLayout(payload.layout);
  }
  if (state.jd) {
    $("#jd-meta").textContent = [state.jdMeta.title, state.jdMeta.company, state.jdMeta.location].filter(Boolean).join(" | ");
    show("#jd-card");
    setDisabled("#analyze-jd", false);
  }
  if (state.analysis) renderAnalysis({ preserveAccepted: true });
  renderResumePreview();
  renderDraftPreview();
  enableExports(Boolean(currentResumeText().trim()));
  updateUndoButton();
  setResumeMode("preview");
  setStatus(`Restored temporary workspace from ${payload.savedAt ? new Date(payload.savedAt).toLocaleString() : "last session"}.`);
}

function renderSuggestionCard(suggestion) {
  const card = document.createElement("div");
  card.className = "suggestion";
  card.dataset.id = suggestion.id;
  const title = document.createElement("strong");
  title.textContent = `${suggestion.source || suggestion.section || "Resume"} -> ${suggestion.jd_keyword || "JD fit"}`;
  const meta = document.createElement("small");
  meta.textContent = `Evidence: ${suggestion.evidence || "review manually"} | Risk: ${suggestion.risk || "medium"} | ${suggestion.reason || ""}`;
  const original = document.createElement("small");
  original.textContent = suggestion.original ? `Original: ${suggestion.original}` : "";
  const text = document.createElement("div");
  text.className = "text";
  text.textContent = suggestion.suggested || "";
  const actions = document.createElement("div");
  actions.className = "actions";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.textContent = "Accept";
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "secondary";
  reject.textContent = "Reject";
  const ask = document.createElement("button");
  ask.type = "button";
  ask.className = "secondary";
  ask.textContent = "Ask AI";
  accept.addEventListener("click", () => {
    state.accepted.set(suggestion.id, suggestion);
    card.classList.add("accepted");
    card.classList.remove("rejected");
    refreshDraft();
  });
  reject.addEventListener("click", () => {
    state.accepted.delete(suggestion.id);
    card.classList.add("rejected");
    card.classList.remove("accepted");
    refreshDraft();
  });
  ask.addEventListener("click", () => {
    $("#resume-ai-instruction").value = `Revise this suggestion and keep it truthful: ${suggestion.suggested || ""}`;
    const block = suggestionTargetBlock(suggestion) || selectedResumeBlock();
    if (block) selectResumeBlock(block);
    showResumeAiPopover(block);
  });
  actions.append(accept, reject, ask);
  card.append(title, meta, original, text, actions);
  return card;
}

function renderAnalysis({ preserveAccepted = false } = {}) {
  const analysis = state.analysis;
  if (!analysis) return;
  show("#match-card");
  show("#keywords-card");
  show("#extras-card");
  $("#match-score").textContent = Math.round(analysis.match?.score || 0);
  $("#match-recommendation").textContent = analysis.match?.recommendation || "Review";
  $("#match-summary").textContent = analysis.match?.summary || "";
  const visaRisk = String(analysis.match?.visa_risk || "review");
  $("#visa-risk").textContent = `Visa risk: ${visaRisk.length > 18 ? "Review" : visaRisk}`;
  $("#visa-risk").title = visaRisk;
  const filter = analysis.sponsorship_filter;
  const filterBox = $("#sponsorship-filter");
  if (filterBox && filter) {
    filterBox.className = `sponsorship-filter ${filter.risk || "unknown"}`;
    const details = [
      filter.summary,
      (filter.concerns || []).length ? `Concerns: ${(filter.concerns || []).join("; ")}` : "",
      (filter.positive_signals || []).length ? `Positive signals: ${(filter.positive_signals || []).join("; ")}` : "",
      filter.action ? `Action: ${filter.action}` : ""
    ].filter(Boolean);
    filterBox.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = `Sponsorship filter: ${sponsorshipStatusLabel(filter)}`;
    const body = document.createElement("div");
    body.textContent = details.join(" ");
    filterBox.append(title, body);
    filterBox.classList.remove("hidden");
  } else {
    filterBox?.classList.add("hidden");
  }
  listItems($("#strengths"), analysis.match?.strengths || []);
  listItems($("#gaps"), analysis.match?.gaps || []);
  chipList($("#jd-keywords"), analysis.jd_keywords || []);
  chipList($("#covered-keywords"), analysis.ats_keywords_covered || []);
  chipList($("#consider-keywords"), analysis.ats_keywords_to_consider || []);
  chipList($("#missing-keywords"), analysis.missing_do_not_claim || []);

  if (!preserveAccepted) state.accepted.clear();
  state.pendingSuggestions = (analysis.bullet_suggestions || []).map((suggestion) => ({ ...suggestion, id: suggestion.id || `suggestion-${Math.random().toString(36).slice(2, 8)}` }));
  $("#cover-letter").value = analysis.cover_letter_draft || "";
  listItems($("#talking-points"), analysis.interview_talking_points || []);
  listItems($("#checklist"), analysis.final_checklist || []);
  if (!currentResumeText().trim()) {
    const base = buildTailoredResumeText(state.profile, state.resumeDetails, {}, []);
    $("#resume-editor").value = base;
    $("#draft-text").value = base;
  }
  renderResumePreview();
  enableExports(Boolean(currentResumeText().trim()));
}

on("#extract-jd", "click", async () => {
  try {
    setStatus("Reading the current page...");
    const tab = await activeTab();
    let frameResults;
    try {
      frameResults = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: extractJobPageText });
    } catch (frameError) {
      try {
        frameResults = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJobPageText });
      } catch (mainError) {
        throw new Error(`Could not read this page: ${mainError.message || frameError.message}`);
      }
    }
    const extracted = bestExtractedJobText(frameResults);
    let cleaned = null;
    const provider = $("#provider").value;
    if (extracted.text && extracted.text.length > 300) {
      try {
        const settings = await getAiSettings();
        const willUseCloud = provider === "cloud" || (!provider && settings.aiProvider === "cloud");
        if (!willUseCloud || !settings.confirmCloudAi || (await confirmInline("Clean JD with AI? This sends the extracted page text to OpenAI because cloud AI is selected.", { title: "Cloud AI confirmation" }))) {
          setStatus("Cleaning extracted JD with AI...");
          cleaned = await cleanJdFromPageText({
            rawText: extracted.text,
            pageUrl: tab.url || "",
            pageTitle: tab.title || "",
            title: extracted.title || "",
            company: extracted.company || "",
            location: extracted.location || "",
            provider
          });
        }
      } catch (cleanError) {
        setStatus(`AI clean failed, using raw page read: ${cleanError.message}`);
      }
    }
    state.jdMeta = cleaned ? {
      url: tab.url || "",
      title: cleaned.title || extracted.title || "",
      company: cleaned.company || extracted.company || "",
      location: cleaned.location || extracted.location || "",
      salary: cleaned.salary || "",
      source: "page + ai clean",
      confidence: cleaned.confidence,
      removedNoise: cleaned.removed_noise_summary || ""
    } : extracted;
    state.jd = String(cleaned?.jd_text || extracted.text || "").trim();
    $("#jd-text").value = state.jd;
    $("#jd-meta").textContent = [state.jdMeta.title, state.jdMeta.company, state.jdMeta.location, state.jdMeta.salary].filter(Boolean).join(" | ") || tab.url;
    show("#jd-card");
    setDisabled("#analyze-jd", !state.jd);
    await saveTempState();
    const confidence = Number.isFinite(state.jdMeta.confidence) ? `, ${Math.round(state.jdMeta.confidence)}% confidence` : "";
    setStatus(state.jd ? `JD loaded from ${state.jdMeta.source || extracted.source || "page"} (${frameResults.length} frame(s)${confidence}). Review it, then analyze fit.` : "Could not find a clean JD automatically. Paste the JD into the box below, select JD text and click Read JD again, or use Read visually.");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#extract-jd-visual", "click", async () => {
  try {
    const tab = await activeTab();
    const provider = $("#provider").value;
    const settings = await getAiSettings();
    const willUseCloud = provider === "cloud" || (!provider && settings.aiProvider === "cloud");
    if (willUseCloud && settings.confirmCloudAi && !(await confirmInline("Visual read sends a screenshot of this job page to OpenAI. Continue?", { title: "Cloud AI confirmation" }))) return;
    setStatus("Capturing the job page for AI vision...");
    setDisabled("#extract-jd-visual", true);
    const imageDataUrls = await capturePageScreenshots(tab, {
      mode: "long",
      maxScreenshots: 8,
      startAtTop: true,
      stitch: true,
      onProgress: (message) => setStatus(message)
    });
    const visibleFallback = imageDataUrls.captureMode === "visible-fallback";
    setStatus(visibleFallback ? "Reading the visible screenshot with AI vision because this page blocked long screenshot access..." : "Reading the long page screenshot with AI vision...");
    const result = await extractJdFromScreenshot({
      imageDataUrls,
      pageUrl: tab.url || "",
      pageTitle: tab.title || "",
      provider
    });
    const jdText = String(result.jd_text || "").trim();
    state.jdMeta = {
      url: tab.url || "",
      title: result.title || tab.title || "",
      company: result.company || "",
      location: result.location || "",
      salary: result.salary || "",
      source: "visual"
    };
    state.jd = jdText;
    $("#jd-text").value = state.jd;
    $("#jd-meta").textContent = [state.jdMeta.title, state.jdMeta.company, state.jdMeta.location, state.jdMeta.salary].filter(Boolean).join(" | ") || tab.url;
    show("#jd-card");
    setDisabled("#analyze-jd", !state.jd);
    await saveTempState();
    const confidence = Number.isFinite(result.confidence) ? Math.round(result.confidence) : "";
    const limitText = (result.limitations || []).slice(0, 2).join(" ");
    setStatus(state.jd ? `Visual JD loaded from ${visibleFallback ? "the visible screenshot" : "one long screenshot"}${confidence ? ` (${confidence}% confidence)` : ""}. ${limitText}` : `AI vision could not see a clean JD. ${visibleFallback ? "This page blocked long screenshot access, so scroll the JD into view and try again." : "Scroll the JD into view, then try Read visually again."}`);
  } catch (error) {
    setStatus(`Visual read failed: ${error.message}`);
  } finally {
    setDisabled("#extract-jd-visual", false);
  }
});

on("#open-tailor-tab", "click", async () => {
  await saveTempState();
  const tab = await activeTab().catch(() => null);
  const source = tab?.id ? `?sourceTabId=${tab.id}` : "";
  chrome.tabs.create({ url: chrome.runtime.getURL(`resume_tailor.html${source}`) });
});

on("#open-tailor-tab-inline", "click", async () => {
  await saveTempState();
  const tab = await activeTab().catch(() => null);
  const source = tab?.id ? `?sourceTabId=${tab.id}` : "";
  chrome.tabs.create({ url: chrome.runtime.getURL(`resume_tailor.html${source}`) });
});

on("#jd-text", "input", async () => {
  state.jd = $("#jd-text").value.trim();
  setDisabled("#analyze-jd", !state.jd);
  await saveTempState();
});

const analyzeJdButton = $("#analyze-jd");
on(analyzeJdButton, "click", async () => {
  try {
    await loadProfile();
    state.jd = $("#jd-text").value.trim();
    if (!state.jd) throw new Error("JD text is empty.");
    const provider = $("#provider").value;
    const settings = await getAiSettings();
    const willUseCloud = provider === "cloud" || (!provider && settings.aiProvider === "cloud");
    if (willUseCloud && settings.confirmCloudAi && !(await confirmInline("Cloud AI will send this JD and your processed profile/resume data to OpenAI. Continue?", { title: "Cloud AI confirmation" }))) return;
    setDisabled("#analyze-jd", true);
    setStatus("Analyzing JD and resume fit...");
    state.analysis = await analyzeResumeForJob({
      jd: state.jd,
      profile: state.profile,
      resumeDetails: state.resumeDetails,
      strategy: $("#strategy").value,
      provider
    });
    renderAnalysis();
    await saveTempState();
    setStatus("Analysis ready. Suggestions are embedded inside the resume workspace.");
  } catch (error) {
    setStatus(`Could not analyze: ${error.message}`);
  } finally {
    setDisabled("#analyze-jd", false);
  }
});

on("#rewrite-resume-ai", "click", async () => {
  try {
    await loadProfile();
    state.jd = $("#jd-text").value.trim();
    if (!state.jd) throw new Error("Read or paste a JD first.");
    let originalResume = currentResumeText().trim();
    if (!originalResume) {
      originalResume = buildTailoredResumeText(state.profile, state.resumeDetails, {}, []);
      $("#resume-editor").value = originalResume;
      $("#draft-text").value = originalResume;
      renderResumePreview();
    }
    if (!originalResume) throw new Error("Load your current resume first.");
    const provider = $("#provider").value;
    const settings = await getAiSettings();
    const willUseCloud = provider === "cloud" || (!provider && settings.aiProvider === "cloud");
    if (willUseCloud && settings.confirmCloudAi && !(await confirmInline("Cloud AI will send this JD and your current resume text to OpenAI. Continue?", { title: "Cloud AI confirmation" }))) return;
    $("#rewrite-resume-ai").disabled = true;
    setStatus("AI is rewriting your current resume, preserving facts and structure...");
    pushResumeHistory("AI rewrite");
    const result = await rewriteResumeFromOriginal({
      jd: state.jd,
      profile: state.profile,
      resumeDetails: state.resumeDetails,
      originalResume,
      strategy: $("#strategy").value,
      layout: $("#layout-template").value,
      provider
    });
    $("#resume-editor").value = String(result.resume_text || "").trim();
    $("#draft-text").value = $("#resume-editor").value;
    state.pendingSuggestions = [];
    renderResumePreview();
    enableExports(Boolean(currentResumeText().trim()));
    await saveTempState();
    const summary = (result.change_summary || []).slice(0, 2).join(" ");
    const warnings = (result.warnings || []).slice(0, 2).join(" ");
    setStatus(`AI rewrite ready. ${summary}${warnings ? ` Review: ${warnings}` : ""}`);
  } catch (error) {
    setStatus(`Could not rewrite resume: ${error.message}`);
  } finally {
    $("#rewrite-resume-ai").disabled = false;
  }
});

on("#refresh-resume", "click", async () => {
  try {
    await loadProfile();
    const text = buildTailoredResumeText(state.profile, state.resumeDetails, {}, []);
    setResumeText(text);
    await saveTempState();
    setStatus("Loaded current profile resume into the workspace.");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#copy-resume", "click", async () => {
  await navigator.clipboard.writeText(currentResumeText());
  setStatus("Copied resume workspace.");
});

on("#resume-editor", "input", () => {
  $("#draft-text").value = $("#resume-editor").value;
  renderResumePreview();
  renderDraftPreview();
  clearTimeout(window.__resumeTailorSaveTimer);
  window.__resumeTailorSaveTimer = setTimeout(saveTempState, 500);
});

on("#resume-editor", "focus", () => {
  pushResumeHistory("raw edit");
});

on("#resume-preview", "input", () => {
  syncPreviewToEditor();
  clearTimeout(window.__resumeTailorSaveTimer);
  window.__resumeTailorSaveTimer = setTimeout(saveTempState, 500);
});

on("#resume-preview", "click", (event) => {
  const block = event.target.closest(".resume-block");
  if (block) selectResumeBlock(block);
});

on(document, "pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("#resume-ai-popover") || target.closest("#suggestion-drawer") || target.closest("#resume-preview")) return;
  hideResumeAiPopover();
  hideSuggestionDrawer();
}, true);

on("#resume-preview", "dblclick", (event) => {
  const block = event.target.closest(".resume-block");
  if (block) beginResumeBlockEdit(block);
});

on("#resume-preview", "keydown", (event) => {
  const block = event.target.closest(".resume-block.editing");
  if (!block) return;
  if (event.key === "Escape") {
    event.preventDefault();
    finishResumeBlockEdit(block);
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    finishResumeBlockEdit(block);
  }
});

on("#resume-preview", "blur", (event) => {
  const block = event.target.closest?.(".resume-block.editing");
  if (block) finishResumeBlockEdit(block);
}, true);

async function reviseSelectedResumeText(instruction) {
  const selection = getSelection();
  const block = selectedResumeBlock();
  const selected = String(block?.innerText || selection?.toString() || "").trim();
  if (!selected) {
    setStatus("Click one resume block first, or select text in the resume preview.");
    return;
  }
  if (!instruction) return;
  try {
    $("#resume-ai-apply").disabled = true;
    setStatus("Revising selected resume text...");
    pushResumeHistory("AI block revision");
    const revised = await refineTailorText({
      jd: state.jd,
      profile: state.profile,
      resumeDetails: state.resumeDetails,
      original: selected,
      instruction,
      provider: $("#provider").value
    });
    if (block) {
      replaceResumeBlock(block, revised.revised);
      await saveTempState();
    } else if (selection.rangeCount) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(revised.revised));
      selection.removeAllRanges();
      syncPreviewToEditor();
      await saveTempState();
    }
    setStatus(`Selected text revised. Risk: ${revised.risk || "review"}.`);
    hideResumeAiPopover();
  } catch (error) {
    setStatus(`Could not revise selected text: ${error.message}`);
  } finally {
    $("#resume-ai-apply").disabled = false;
  }
}

on("#undo-resume", "click", undoResumeChange);

on(document, "keydown", async (event) => {
  const target = event.target;
  const inTypingField = target instanceof Element && target.closest("textarea,input,select,[contenteditable=true]");
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && !inTypingField) {
    event.preventDefault();
    await undoResumeChange();
  }
});

on("#resume-ai-apply", "click", async () => {
  await reviseSelectedResumeText($("#resume-ai-instruction").value.trim());
});

on("#resume-ai-close", "click", () => {
  hideResumeAiPopover();
});
on("#suggestion-drawer-close", "click", () => {
  $("#suggestion-drawer").classList.add("hidden");
});

on("#resume-preview-mode", "click", () => setResumeMode("preview"));
on("#resume-edit-mode", "click", () => setResumeMode("edit"));
on("#layout-template", "change", async () => {
  applyLayout($("#layout-template").value);
  renderResumePreview();
  await saveTempState();
});
on("#provider", "change", saveTempState);
on("#strategy", "change", saveTempState);

on("#save-draft", "click", async () => {
  const stored = await chrome.storage.local.get("tailoredResumeDrafts");
  const drafts = Array.isArray(stored.tailoredResumeDrafts) ? stored.tailoredResumeDrafts : [];
  drafts.unshift({
    id: `tailored-${Date.now()}`,
    name: [state.analysis?.job?.company, state.analysis?.job?.title].filter(Boolean).join(" - ") || "Tailored resume",
    savedAt: new Date().toISOString(),
    text: currentResumeText(),
    analysis: state.analysis
  });
  await chrome.storage.local.set({ tailoredResumeDrafts: drafts.slice(0, 25) });
  setStatus("Saved tailored resume version locally.");
});

on("#export-text", "click", () => {
  const filename = `${fileSafeName([state.analysis?.job?.company, state.analysis?.job?.title].filter(Boolean).join(" - "))}.txt`;
  download(filename, "text/plain;charset=utf-8", currentResumeText());
});

on("#export-html", "click", () => {
  const escaped = currentResumeText().replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tailored Resume</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:32px auto;line-height:1.35;color:#111}pre{white-space:pre-wrap;font-family:inherit}</style></head><body><pre>${escaped}</pre></body></html>`;
  const filename = `${fileSafeName([state.analysis?.job?.company, state.analysis?.job?.title].filter(Boolean).join(" - "))}.html`;
  download(filename, "text/html;charset=utf-8", html);
});

on("#export-pdf", "click", () => {
  if (!currentResumeText().trim()) {
    setStatus("Load or generate a resume first.");
    return;
  }
  exportResumePdf();
  setStatus("Exported resume PDF without Chrome page headers or URL footer.");
});

await initWorkspacePreferences();
await restoreTempState();
renderResumePreview();
renderDraftPreview();
