import * as pdfjsLib from "./vendor/pdf.min.mjs";

const $ = (selector) => document.querySelector(selector);
function on(selector, eventName, handler, options) {
  const element = typeof selector === "string" ? $(selector) : selector;
  if (!element) {
    console.warn(`Profile Manager: missing element for ${eventName}: ${selector}`);
    return null;
  }
  element.addEventListener(eventName, handler, options);
  return element;
}
const form = $("#profile-form");
const status = $("#status");
const ollamaModel = $("#ollama-model");
const classifyButton = $("#ollama-classify");
const aiStatus = $("#ai-status");
const profileCheckResults = $("#profile-check-results");
let resumeDetails = { skillsAndTools: [], educationEntries: [], experienceEntries: [], projectEntries: [], certificationEntries: [], languageEntries: [] };
const moduleHints = {
  resume: "Start here: import a resume, classify it with local AI, then review each module.",
  contact: "Basic identity, links, phone, and address fields used on most applications.",
  professional: "Career summary, target role, skills, tools, salary, and work preferences.",
  experience: "Paid work, internships, and role descriptions. Keep each job as its own card.",
  education: "Schools, degrees, majors, and graduation dates.",
  projects: "Project experience only. Keep work experience separate from projects.",
  extras: "Certifications and languages.",
  preferences: "Application preferences, work authorization, import/export, and notes."
};

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");

function showProfileModule(moduleName) {
  const selected = moduleHints[moduleName] ? moduleName : "resume";
  for (const section of document.querySelectorAll("[data-profile-module]")) {
    const active = section.dataset.profileModule === selected;
    section.hidden = !active;
    if (active && section.tagName.toLowerCase() === "details") section.open = true;
  }
  for (const tab of document.querySelectorAll("[data-module-target]")) {
    tab.classList.toggle("active", tab.dataset.moduleTarget === selected);
  }
  const hint = $("#module-hint");
  if (hint) hint.textContent = moduleHints[selected];
  chrome.storage?.local?.set?.({ profileManagerModule: selected });
}

function setStatus(message) {
  status.textContent = message;
}

function setAiStatus(message) {
  aiStatus.textContent = message;
  setStatus(message);
}

function hasValue(value) {
  return String(value || "").trim().length > 0;
}

function validYearish(value) {
  return !hasValue(value) || /\b(?:19|20)\d{2}\b/.test(String(value));
}

function profileQualityIssues(profile = profileFromForm(), details = resumeDetails) {
  const issues = [];
  const add = (severity, section, message, module = section) => issues.push({ severity, section, message, module });
  if (!hasValue(profile.firstName) || !hasValue(profile.lastName)) add("warn", "contact", "Name looks incomplete.", "contact");
  if (!hasValue(profile.email)) add("warn", "contact", "Email is missing.", "contact");
  if (!hasValue(profile.phone)) add("warn", "contact", "Phone number is missing.", "contact");
  if (!hasValue(profile.city) || !hasValue(profile.state) || !hasValue(profile.country)) add("info", "contact", "Address is incomplete. Some applications require city, state, and country.", "contact");
  if (/^(?:usa|united states|us)$/i.test(profile.state || "")) add("warn", "contact", "State appears to contain a country. Put country in Country and state as a state/region.", "contact");
  if (!hasValue(profile.school) || !hasValue(profile.degree) || !hasValue(profile.major)) add("warn", "education", "Most recent education is missing school, degree, or field of study.", "education");
  if (profile.degree && !/^(?:Associate's|Bachelor's|Master's|MBA|Doctorate|Certificate)$/i.test(profile.degree)) add("info", "education", "Degree is not a standard value such as Bachelor's or Master's.", "education");
  if (!validYearish(profile.graduationYear)) add("warn", "education", "Graduation year does not look like a year.", "education");
  for (const [index, entry] of (details.educationEntries || []).entries()) {
    if (!entry.school || !entry.degree || !entry.major) add("info", "education", `Education ${index + 1} is missing school, degree, or major.`, "education");
    if (!validYearish(`${entry.startDate} ${entry.endDate}`)) add("info", "education", `Education ${index + 1} has unusual dates.`, "education");
  }
  for (const [index, entry] of (details.experienceEntries || []).entries()) {
    if (!entry.company || !entry.title) add("warn", "experience", `Work ${index + 1} is missing company or title.`, "experience");
    if (!entry.startDate && !entry.endDate && !entry.isCurrent) add("info", "experience", `Work ${index + 1} is missing dates.`, "experience");
  }
  if (!(details.skillsAndTools || []).length && !hasValue(profile.skills)) add("warn", "professional", "Skills & Tools are empty.", "professional");
  if ((details.skillsAndTools || []).length > 0 && (details.skillsAndTools || []).length < 5) add("info", "professional", "Skills list is short. Add tools, platforms, and professional skills if available.", "professional");
  if (!hasValue(profile.workAuthorization) || !hasValue(profile.sponsorship) || !hasValue(profile.visaStatus)) add("info", "preferences", "Work authorization, sponsorship, or visa status should be manually confirmed.", "preferences");
  return issues;
}

function renderProfileCheck({ reviewMode = false } = {}) {
  if (!profileCheckResults) return;
  const details = orderedResumeDetails(detailsFromCards());
  const profile = profileFromForm();
  const issues = profileQualityIssues(profile, details);
  profileCheckResults.replaceChildren();
  const summary = document.createElement("div");
  summary.className = issues.length ? "check-summary warn" : "check-summary ok";
  summary.textContent = issues.length ? `${issues.length} item(s) to review before filling.` : "Profile looks ready for normal applications.";
  profileCheckResults.append(summary);
  const groups = issues.reduce((map, issue) => {
    if (!map.has(issue.module)) map.set(issue.module, []);
    map.get(issue.module).push(issue);
    return map;
  }, new Map());
  for (const [module, moduleIssues] of groups) {
    const card = document.createElement("div");
    card.className = "check-card";
    const title = document.createElement("strong");
    title.textContent = `${module[0].toUpperCase()}${module.slice(1)} (${moduleIssues.length})`;
    const list = document.createElement("ul");
    for (const issue of moduleIssues) {
      const item = document.createElement("li");
      item.textContent = issue.message;
      list.append(item);
    }
    const jump = document.createElement("button");
    jump.className = "secondary compact";
    jump.type = "button";
    jump.textContent = `Review ${module}`;
    jump.addEventListener("click", () => showProfileModule(module));
    card.append(title, list, jump);
    profileCheckResults.append(card);
  }
  if (reviewMode) setStatus(issues.length ? "Review mode started. Work through the sections listed in Profile Check, then save." : "Review mode complete. Save when ready.");
}

function profileFromForm() {
  const profile = Object.fromEntries(new FormData(form).entries());
  profile.fullName ||= [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ");
  profile.phoneCountryCode ||= String(profile.phone || "").match(/^\s*(\+\d{1,3})\b/)?.[1] || (/^(?:usa|united states|us)$/i.test(profile.country || "") ? "+1" : "");
  profile.phoneCountryName ||= /^(?:usa|united states|us)$/i.test(profile.country || "") ? "United States" : profile.country || "";
  return normalizeTopLevelDetails(profile);
}

function populateForm(profile = {}) {
  for (const element of form.elements) {
    if (element.name) element.value = element.name === "state" && /^(?:usa|united states|us)$/i.test(profile[element.name] || "") ? "" : profile[element.name] || "";
  }
}

const emptyResumeDetails = () => ({ skillsAndTools: [], educationEntries: [], experienceEntries: [], projectEntries: [], certificationEntries: [], languageEntries: [] });

function cloneData(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function profileSlotName(profile = {}, fallback = "") {
  return fallback || profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.email || "Untitled profile";
}

async function getProfileSlotState() {
  const stored = await chrome.storage.local.get(["profileSlots", "activeProfileSlotId"]);
  return { profileSlots: Array.isArray(stored.profileSlots) ? stored.profileSlots : [], activeProfileSlotId: stored.activeProfileSlotId || "" };
}

async function setProfileSlotState(profileSlots, activeProfileSlotId = "") {
  await chrome.storage.local.set({ profileSlots, activeProfileSlotId });
}

function bundleFromCurrentProfile(name = "", id = "") {
  resumeDetails = orderedResumeDetails(detailsFromCards());
  syncCardsToProfile(resumeDetails);
  const profile = profileFromForm();
  return {
    id: id || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: profileSlotName(profile, cleanResumeText(name)),
    updatedAt: new Date().toISOString(),
    profile: cloneData(profile),
    resumeDetails: cloneData(resumeDetails)
  };
}

async function renderProfileSlots() {
  const select = $("#profile-slot-select");
  const label = $("#active-profile-label");
  if (!select || !label) return;
  const { profileSlots, activeProfileSlotId } = await getProfileSlotState();
  select.replaceChildren();
  if (!profileSlots.length) {
    select.append(new Option("No saved profiles yet", ""));
  } else {
    for (const slot of profileSlots) {
      const marker = slot.id === activeProfileSlotId ? "Active - " : "";
      select.append(new Option(`${marker}${slot.name || "Untitled profile"}`, slot.id));
    }
    select.value = activeProfileSlotId || profileSlots[0]?.id || "";
  }
  const active = profileSlots.find((slot) => slot.id === activeProfileSlotId);
  label.textContent = active ? `Active profile: ${active.name}` : "Current browser profile is active. Save it as a named profile for quick switching.";
}

async function applyProfileSlot(slot) {
  resumeDetails = orderedResumeDetails(slot.resumeDetails || emptyResumeDetails());
  populateForm(slot.profile || {});
  renderEntryCards(resumeDetails);
  syncCardsToProfile(resumeDetails);
  await chrome.storage.local.set({ profile: profileFromForm(), resumeDetails, activeProfileSlotId: slot.id });
  showClassificationReport(resumeDetails);
  renderProfileCheck();
  await renderProfileSlots();
}

async function updateActiveProfileSlotFromCurrent() {
  const { profileSlots, activeProfileSlotId } = await getProfileSlotState();
  if (!activeProfileSlotId) return false;
  const index = profileSlots.findIndex((slot) => slot.id === activeProfileSlotId);
  if (index < 0) return false;
  profileSlots[index] = bundleFromCurrentProfile(profileSlots[index].name, activeProfileSlotId);
  await setProfileSlotState(profileSlots, activeProfileSlotId);
  await renderProfileSlots();
  return true;
}

async function getProfile() {
  return (await chrome.storage.local.get("profile")).profile || {};
}

async function ollamaRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let response;
  try {
    response = await fetch(`http://localhost:11434/api/${path}`, { signal: AbortSignal.timeout(300000), ...options, headers });
  } catch {
    throw new Error("Could not connect to Ollama or the request timed out after 5 minutes. Make sure the Ollama desktop app is running.");
  }
  if (response.status === 403) throw new Error("Ollama blocked this browser extension. Restart the Ollama desktop app after setting OLLAMA_ORIGINS=chrome-extension://*.");
  if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);
  return response.json();
}

async function refreshOllamaModels() {
  const { models = [] } = await ollamaRequest("tags");
  const saved = (await chrome.storage.local.get("ollamaModel")).ollamaModel;
  ollamaModel.replaceChildren();
  if (!models.length) {
    ollamaModel.append(new Option("No local models installed", ""));
    setAiStatus("Ollama is running, but no local model is installed. Run: ollama pull qwen3:14b");
    return;
  }
  for (const item of models) ollamaModel.append(new Option(item.name, item.model));
  if (saved && models.some((item) => item.model === saved)) ollamaModel.value = saved;
  setAiStatus(`Detected ${models.length} local Ollama model(s).`);
}

const resumeSchema = {
  type: "object",
  properties: {
    firstName: { type: "string" },
    fullName: { type: "string" },
    preferredName: { type: "string" },
    middleName: { type: "string" },
    lastName: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    phoneCountryCode: { type: "string" },
    phoneCountryName: { type: "string" },
    city: { type: "string" },
    addressLine2: { type: "string" },
    state: { type: "string" },
    country: { type: "string" },
    linkedin: { type: "string" },
    portfolio: { type: "string" },
    github: { type: "string" },
    professionalSummary: { type: "string" },
    desiredTitle: { type: "string" },
    employmentType: { type: "string" },
    desiredSalary: { type: "string" },
    noticePeriod: { type: "string" },
    remotePreference: { type: "string" },
    travel: { type: "string" },
    workStatus: { type: "string" },
    visaStatus: { type: "string" },
    source: { type: "string" },
    coverLetterNotes: { type: "string" },
    skillsAndTools: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          category: { type: "string" }
        },
        required: ["name", "category"]
      }
    },
    educationEntries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          school: { type: "string" },
          degree: { type: "string" },
          major: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          isCurrent: { type: "boolean" }
        },
        required: ["school", "degree", "major", "startDate", "endDate", "isCurrent"]
      }
    },
    experienceEntries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          title: { type: "string" },
          location: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          isCurrent: { type: "boolean" },
          description: { type: "string" }
        },
        required: ["company", "title", "location", "startDate", "endDate", "isCurrent", "description"]
      }
    },
    projectEntries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          technologies: { type: "array", items: { type: "string" } },
          startDate: { type: "string" },
          endDate: { type: "string" },
          description: { type: "string" }
        },
        required: ["name", "technologies", "startDate", "endDate", "description"]
      }
    },
    certificationEntries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          issuer: { type: "string" },
          date: { type: "string" },
          expirationDate: { type: "string" },
          credentialId: { type: "string" }
        },
        required: ["name", "issuer", "date", "expirationDate", "credentialId"]
      }
    },
    languageEntries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          language: { type: "string" },
          fluent: { type: "boolean" },
          overall: { type: "string" },
          reading: { type: "string" },
          speaking: { type: "string" },
          writing: { type: "string" }
        },
        required: ["language", "fluent", "overall", "reading", "speaking", "writing"]
      }
    }
  },
  required: ["firstName", "fullName", "preferredName", "middleName", "lastName", "email", "phone", "phoneCountryCode", "phoneCountryName", "city", "state", "country", "linkedin", "portfolio", "github", "professionalSummary", "skillsAndTools", "educationEntries", "experienceEntries", "projectEntries", "certificationEntries", "languageEntries"]
};

const entrySchema = {
  type: "object",
  properties: {
    skillsAndTools: resumeSchema.properties.skillsAndTools,
    educationEntries: resumeSchema.properties.educationEntries,
    experienceEntries: resumeSchema.properties.experienceEntries,
    projectEntries: resumeSchema.properties.projectEntries,
    certificationEntries: resumeSchema.properties.certificationEntries,
    languageEntries: resumeSchema.properties.languageEntries
  },
  required: ["skillsAndTools", "educationEntries", "experienceEntries", "projectEntries", "certificationEntries", "languageEntries"]
};

function formatEducation(entries = []) {
  return entries.map((item) => [item.school, item.degree, item.major, [item.startDate, item.isCurrent ? "Present" : item.endDate].filter(Boolean).join(" - ")].filter(Boolean).join(" | ")).join("\n");
}

function formatProjects(entries = []) {
  return entries.map((item) => {
    const heading = [item.name, [item.startDate, item.endDate].filter(Boolean).join(" - ")].filter(Boolean).join(" | ");
    return [heading, (item.technologies || []).join(", "), item.description].filter(Boolean).join("\n");
  }).join("\n\n");
}

function formatExperience(entries = []) {
  return entries.map((item) => {
    const heading = [item.company, item.title, [item.startDate, item.isCurrent ? "Present" : item.endDate].filter(Boolean).join(" - ")].filter(Boolean).join(" | ");
    return [heading, item.description].filter(Boolean).join("\n");
  }).join("\n\n");
}

function dateScore(value, isCurrent = false) {
  if (isCurrent) return Number.MAX_SAFE_INTEGER;
  const match = String(value || "").match(/\b((?:19|20)\d{2})(?:[-/](\d{1,2}))?/);
  return match ? Number(match[1]) * 12 + Number(match[2] || 12) : 0;
}

function educationDateScore(entry = {}) {
  return dateScore(entry.endDate) || dateScore(entry.startDate, entry.isCurrent);
}

function cleanResumeText(value = "") {
  return String(value || "").replace(/[•●▪]/g, " ").replace(/\s+/g, " ").trim();
}

function isMostlyUppercase(value = "") {
  const letters = String(value || "").replace(/[^A-Za-z]/g, "");
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.78;
}

const preservedUppercase = new Set(["AI", "API", "ATS", "BA", "BS", "CPT", "CRM", "CSS", "F-1", "GPA", "HR", "HTML", "ID", "IT", "JSON", "KPI", "LLC", "MBA", "MS", "NY", "NYC", "NYU", "OPT", "PDF", "PM", "SQL", "STEM", "UI", "URL", "US", "USA", "UX"]);
const lowercaseNameWords = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

function formatTokenCase(token = "", index = 0) {
  if (!token) return "";
  const edge = token.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
  const prefix = edge?.[1] || "";
  const core = edge?.[2] || token;
  const suffix = edge?.[3] || "";
  if (!core) return token;
  const normalizedCore = core.replace(/\./g, "").toUpperCase();
  if (preservedUppercase.has(core.toUpperCase()) || preservedUppercase.has(normalizedCore)) return `${prefix}${normalizedCore}${suffix}`;
  if (/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(core)) return `${prefix}${core.toUpperCase()}${suffix}`;
  if (/^\d/.test(core) || /https?:|www\.|@/i.test(core)) return token;
  if (core.includes("/")) return `${prefix}${core.split("/").map((part) => formatTokenCase(part, index)).join("/")}${suffix}`;
  if (core.includes("-")) return `${prefix}${core.split("-").map((part, partIndex) => formatTokenCase(part, index + partIndex)).join("-")}${suffix}`;
  const lower = core.toLowerCase();
  if (index > 0 && lowercaseNameWords.has(lower)) return `${prefix}${lower}${suffix}`;
  if (/^(?:inc|corp|co|ltd)$/i.test(core)) return `${prefix}${lower[0].toUpperCase()}${lower.slice(1)}.${suffix}`;
  return `${prefix}${lower[0].toUpperCase()}${lower.slice(1)}${suffix}`;
}

function smartTitleCase(value = "") {
  const text = cleanResumeText(value);
  if (!text || !isMostlyUppercase(text)) return text;
  return text.split(/\s+/).map(formatTokenCase).join(" ")
    .replace(/\bUsa\b/g, "USA")
    .replace(/\bUnited States Of America\b/g, "United States of America");
}

function smartSentenceCase(value = "") {
  const text = cleanResumeText(value);
  if (!text || !isMostlyUppercase(text) || text.length < 24) return text;
  const restored = text.toLowerCase().replace(/\b(?:ai|api|ats|cpt|crm|css|f-1|gpa|hr|html|it|json|kpi|llc|mba|nyu|opt|pdf|sql|stem|ui|url|us|usa|ux)\b/g, (match) => match.toUpperCase());
  return restored.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead, letter) => `${lead}${letter.toUpperCase()}`);
}

function formatResumeValue(value = "", mode = "title") {
  return mode === "sentence" ? smartSentenceCase(value) : smartTitleCase(value);
}

function stripTrailingLocation(value = "") {
  let text = cleanResumeText(value);
  text = text.replace(/\s*[-|]\s*(?:[A-Z][A-Za-z .'-]+,\s*)?(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY|USA|United States)\b\.?$/i, "");
  text = text.replace(/\s*[-|]\s*(?:Remote|Hybrid|On-site|New York|New Jersey|Jersey City|Bay Area)\b.*$/i, "");
  return text.trim();
}

function looksLikeCompany(value = "") {
  return /\b(?:inc\.?|llc|ltd\.?|corp\.?|corporation|company|co\.?|group|technolog(?:y|ies)|solutions|systems|services|university|bank|labs?|agency|partners|holdings|realty|properties)\b/i.test(value);
}

function looksLikeTitle(value = "") {
  return /\b(?:assistant|associate|agent|analyst|coordinator|intern|manager|specialist|support|operations|recruiter|consultant|representative|administrator|officer|lead|director|engineer|developer|designer|project|program|business|risk|real estate)\b/i.test(value);
}

function splitTitleCompanyLine(value = "") {
  const text = cleanResumeText(value);
  const parts = text.split(/\s+(?:[-–—|])\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const left = parts[0];
  const right = parts.slice(1).join(" - ");
  if (looksLikeTitle(left) && looksLikeCompany(right)) return { title: left, company: right };
  if (looksLikeCompany(left) && looksLikeTitle(right)) return { title: right, company: left };
  return null;
}

function normalizeDateText(value = "") {
  const text = cleanResumeText(value);
  if (!text) return "";
  const present = /\b(?:present|current|now)\b/i.test(text);
  const monthMap = { jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03", apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07", aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12" };
  const named = text.toLowerCase().match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+((?:19|20)\d{2})\b/);
  if (named) return `${named[2]}-${monthMap[named[1]]}`;
  const numeric = text.match(/\b((?:19|20)\d{2})[-/](\d{1,2})\b/);
  if (numeric) return `${numeric[1]}-${String(numeric[2]).padStart(2, "0")}`;
  const year = text.match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
  return present ? "" : year;
}

function normalizeEntryDates(entry = {}) {
  const startDate = normalizeDateText(entry.startDate);
  const endDate = normalizeDateText(entry.endDate);
  const isCurrent = Boolean(entry.isCurrent) || /\b(?:present|current|now|expected)\b/i.test(`${entry.startDate} ${entry.endDate}`);
  return { ...entry, startDate, endDate: isCurrent && /\b(?:present|current|now)\b/i.test(`${entry.endDate}`) ? "" : endDate, isCurrent };
}

function normalizeDegreeAndMajor(degreeValue = "", majorValue = "") {
  const combined = cleanResumeText([degreeValue, majorValue].filter(Boolean).join(" "));
  let degree = cleanResumeText(degreeValue).replace(/\s*[-|]\s*.*$/, "").trim();
  let major = cleanResumeText(majorValue).replace(/\s*[-|]\s*(?:New York|NY|NJ|USA|United States).*$/i, "").trim();
  const fieldMatch = combined.match(/\b(?:in|of)\s+([A-Za-z][A-Za-z &/.,'-]{2,80})/i);
  if (!major && fieldMatch) major = fieldMatch[1].replace(/\b(?:minor|concentration|expected|graduated|gpa)\b.*$/i, "").trim();
  if (/\b(?:m\.?\s*s\.?|master(?:'s)?|masters|master of science|master of arts)\b/i.test(combined)) degree = "Master's";
  else if (/\b(?:m\.?\s*b\.?\s*a\.?|master of business administration)\b/i.test(combined)) degree = "MBA";
  else if (/\b(?:b\.?\s*s\.?|b\.?\s*a\.?|bachelor(?:'s)?|bachelors|bachelor of science|bachelor of arts)\b/i.test(combined)) degree = "Bachelor's";
  else if (/\b(?:a\.?\s*s\.?|a\.?\s*a\.?|associate(?:'s)?|associates)\b/i.test(combined)) degree = "Associate's";
  else if (/\b(?:ph\.?\s*d\.?|doctor(?:ate)?|doctoral)\b/i.test(combined)) degree = "Doctorate";
  else if (/\b(?:certificate|certification|license)\b/i.test(combined)) degree = "Certificate";
  degree = degree.replace(/\s+in\s+.*$/i, "").trim();
  if (/^(?:m\.?\s*s\.?|m\.?\s*a\.?)$/i.test(degree)) degree = "Master's";
  if (/^(?:b\.?\s*s\.?|b\.?\s*a\.?)$/i.test(degree)) degree = "Bachelor's";
  return { degree, major };
}

function normalizeEducationEntry(entry = {}) {
  const school = formatResumeValue(stripTrailingLocation(entry.school).replace(/\s*\(([^)]{2,12})\)\s*$/, " ($1)").trim());
  const { degree, major } = normalizeDegreeAndMajor(entry.degree, entry.major);
  return normalizeEntryDates({ ...entry, school, degree, major: formatResumeValue(major) });
}

function normalizeExperienceEntry(entry = {}) {
  let company = cleanResumeText(entry.company);
  let title = cleanResumeText(entry.title);
  const titleSplit = splitTitleCompanyLine(title);
  const companySplit = splitTitleCompanyLine(company);
  if (titleSplit) {
    title = titleSplit.title;
    if (!company || !looksLikeCompany(company) || company === entry.title) company = titleSplit.company;
  } else if (companySplit) {
    company = companySplit.company;
    if (!title || !looksLikeTitle(title) || title === entry.company) title = companySplit.title;
  } else if (looksLikeCompany(title) && looksLikeTitle(company)) {
    [company, title] = [title, company];
  }
  company = formatResumeValue(stripTrailingLocation(company));
  title = formatResumeValue(stripTrailingLocation(title));
  return normalizeEntryDates({ ...entry, company, title, location: formatResumeValue(entry.location), description: formatResumeValue(entry.description, "sentence") });
}

function normalizeTopLevelDetails(details = {}) {
  const titleFields = ["firstName", "fullName", "preferredName", "middleName", "lastName", "city", "state", "country", "phoneCountryName", "desiredTitle", "employmentType", "noticePeriod", "remotePreference", "travel", "workStatus", "visaStatus", "source"];
  const sentenceFields = ["professionalSummary", "coverLetterNotes"];
  const normalized = { ...details };
  for (const field of titleFields) normalized[field] = formatResumeValue(normalized[field]);
  for (const field of sentenceFields) normalized[field] = formatResumeValue(normalized[field], "sentence");
  return normalized;
}

function normalizeResumeDetails(details = {}) {
  const normalizedTopLevel = normalizeTopLevelDetails(details);
  const educationEntries = (details.educationEntries || []).map(normalizeEducationEntry).filter((entry) => entry.school || entry.degree || entry.major);
  const experienceEntries = (details.experienceEntries || []).map(normalizeExperienceEntry).filter((entry) => entry.company || entry.title || entry.description);
  const projectEntries = (details.projectEntries || []).map((entry) => normalizeEntryDates({ ...entry, name: formatResumeValue(entry.name), technologies: (entry.technologies || []).map((item) => formatResumeValue(item)), description: formatResumeValue(entry.description, "sentence") })).filter((entry) => entry.name || entry.description);
  const skillsAndTools = (details.skillsAndTools || []).map((item) => ({ name: formatResumeValue(item.name), category: formatResumeValue(item.category) })).filter((item, index, items) => item.name && items.findIndex((other) => other.name.toLowerCase() === item.name.toLowerCase()) === index);
  const certificationEntries = (details.certificationEntries || []).map((entry) => normalizeEntryDates({ ...entry, name: formatResumeValue(entry.name), issuer: formatResumeValue(entry.issuer), credentialId: cleanResumeText(entry.credentialId) })).filter((entry) => entry.name || entry.issuer || entry.credentialId);
  const languageEntries = (details.languageEntries || []).map((entry) => ({ ...entry, language: formatResumeValue(entry.language), overall: formatResumeValue(entry.overall), reading: formatResumeValue(entry.reading), speaking: formatResumeValue(entry.speaking), writing: formatResumeValue(entry.writing) })).filter((entry) => entry.language || entry.overall || entry.reading || entry.speaking || entry.writing);
  return { ...normalizedTopLevel, skillsAndTools, educationEntries, experienceEntries, projectEntries, certificationEntries, languageEntries };
}

function calculateYearsExperience(entries = []) {
  const now = new Date();
  let months = 0;
  for (const entry of entries) {
    const start = String(entry.startDate || "").match(/\b((?:19|20)\d{2})(?:[-/](\d{1,2}))?/);
    const end = String(entry.endDate || "").match(/\b((?:19|20)\d{2})(?:[-/](\d{1,2}))?/);
    if (!start) continue;
    const startMonth = Number(start[1]) * 12 + Number(start[2] || 1);
    const endMonth = entry.isCurrent ? now.getFullYear() * 12 + now.getMonth() + 1 : end ? Number(end[1]) * 12 + Number(end[2] || 12) : startMonth;
    months += Math.max(0, endMonth - startMonth);
  }
  return months ? (months / 12).toFixed(1).replace(/\.0$/, "") : "";
}

function sortExperienceEntries(entries = []) {
  return [...entries].sort((a, b) => {
    const endDifference = dateScore(b.endDate, b.isCurrent) - dateScore(a.endDate, a.isCurrent);
    return endDifference || dateScore(b.startDate) - dateScore(a.startDate);
  });
}

function sortEducationEntries(entries = []) {
  return [...entries].sort((a, b) => {
    const endDifference = educationDateScore(b) - educationDateScore(a);
    return endDifference || dateScore(b.startDate, b.isCurrent) - dateScore(a.startDate, a.isCurrent);
  });
}

function orderedResumeDetails(details = {}) {
  const normalizedDetails = normalizeResumeDetails(details);
  return {
    ...normalizedDetails,
    skillsAndTools: normalizedDetails.skillsAndTools || [],
    educationEntries: sortEducationEntries(normalizedDetails.educationEntries || []),
    experienceEntries: sortExperienceEntries(normalizedDetails.experienceEntries || []),
    projectEntries: [...(normalizedDetails.projectEntries || [])].sort((a, b) => dateScore(b.endDate, b.isCurrent) - dateScore(a.endDate, a.isCurrent) || dateScore(b.startDate) - dateScore(a.startDate)),
    certificationEntries: normalizedDetails.certificationEntries || [],
    languageEntries: normalizedDetails.languageEntries || []
  };
}

function applyOllamaDetails(details) {
  const normalizedDetails = orderedResumeDetails(details);
  const education = normalizedDetails.educationEntries;
  const experience = normalizedDetails.experienceEntries;
  const projects = normalizedDetails.projectEntries;
  const latestEducation = education[0] || {};
  const latestExperience = experience[0] || {};
  const values = {
    firstName: normalizedDetails.firstName,
    fullName: normalizedDetails.fullName || [normalizedDetails.firstName, normalizedDetails.middleName, normalizedDetails.lastName].filter(Boolean).join(" "),
    preferredName: normalizedDetails.preferredName,
    middleName: normalizedDetails.middleName,
    lastName: normalizedDetails.lastName,
    email: normalizedDetails.email,
    phone: normalizedDetails.phone,
    phoneCountryCode: normalizedDetails.phoneCountryCode || String(normalizedDetails.phone || "").match(/^\s*(\+\d{1,3})\b/)?.[1] || "",
    phoneCountryName: normalizedDetails.phoneCountryName || (/^(?:usa|united states|us)$/i.test(normalizedDetails.country || "") ? "United States" : normalizedDetails.country),
    city: normalizedDetails.city,
    addressLine2: normalizedDetails.addressLine2,
    state: /^(?:usa|united states|us)$/i.test(normalizedDetails.state || "") ? "" : normalizedDetails.state,
    country: normalizedDetails.country,
    linkedin: normalizedDetails.linkedin,
    portfolio: normalizedDetails.portfolio,
    github: normalizedDetails.github,
    professionalSummary: normalizedDetails.professionalSummary,
    desiredTitle: normalizedDetails.desiredTitle,
    employmentType: normalizedDetails.employmentType,
    desiredSalary: normalizedDetails.desiredSalary,
    noticePeriod: normalizedDetails.noticePeriod,
    remotePreference: normalizedDetails.remotePreference,
    travel: normalizedDetails.travel,
    workStatus: normalizedDetails.workStatus,
    visaStatus: normalizedDetails.visaStatus,
    source: normalizedDetails.source,
    coverLetterNotes: normalizedDetails.coverLetterNotes,
    skills: (normalizedDetails.skillsAndTools || []).map((item) => item.name).filter(Boolean).join(", "),
    education: formatEducation(education),
    workExperience: formatExperience(experience),
    projectExperience: formatProjects(projects),
    school: latestEducation.school,
    degree: latestEducation.degree,
    major: latestEducation.major,
    graduationYear: String(latestEducation.endDate || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || "",
    currentCompany: latestExperience.company,
    currentTitle: latestExperience.title
  };
  let count = 0;
  for (const [name, value] of Object.entries(values)) {
    if (!value || !form.elements[name]) continue;
    form.elements[name].value = value;
    count += 1;
  }
  resumeDetails = { ...normalizedDetails, educationEntries: education, experienceEntries: experience, projectEntries: projects };
  renderEntryCards(resumeDetails);
  return count;
}

function renderEntryCards(details = {}) {
  resumeDetails = { ...resumeDetails, ...details, skillsAndTools: details.skillsAndTools || [], educationEntries: details.educationEntries || [], experienceEntries: details.experienceEntries || [], projectEntries: details.projectEntries || [], certificationEntries: details.certificationEntries || [], languageEntries: details.languageEntries || [] };
  const field = (labelText, name, value = "") => `<label>${labelText}<input name="${name}" value="${String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></label>`;
  const booleanField = (labelText, name, value = false) => `<label>${labelText}<select name="${name}"><option value="false"${value ? "" : " selected"}>No</option><option value="true"${value ? " selected" : ""}>Yes</option></select></label>`;
  const card = (type, index, fields, description = "") => `<details class="entry-card" data-entry-type="${type}"><summary><span>${type[0].toUpperCase()}${type.slice(1)} ${index + 1}</span></summary><div class="entry-card-head"><span></span><button class="remove-entry" type="button">Remove</button></div><div class="grid">${fields}</div>${description === null ? "" : `<label>Description<textarea name="description" rows="3">${String(description).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</textarea></label>`}</details>`;
  $("#education-cards").innerHTML = resumeDetails.educationEntries.map((item, index) => card("education", index, field("School", "school", item.school) + field("Degree", "degree", item.degree) + field("Major", "major", item.major) + field("Start date", "startDate", item.startDate) + field("End date", "endDate", item.endDate) + booleanField("Current or expected", "isCurrent", item.isCurrent), null)).join("");
  $("#experience-cards").innerHTML = resumeDetails.experienceEntries.map((item, index) => card("experience", index, field("Company", "company", item.company) + field("Title", "title", item.title) + field("Location", "location", item.location) + field("Start date", "startDate", item.startDate) + field("End date", "endDate", item.endDate) + booleanField("Current", "isCurrent", item.isCurrent), item.description)).join("");
  $("#project-cards").innerHTML = resumeDetails.projectEntries.map((item, index) => card("project", index, field("Project name", "name", item.name) + field("Technologies", "technologies", (item.technologies || []).join(", ")) + field("Start date", "startDate", item.startDate) + field("End date", "endDate", item.endDate), item.description)).join("");
  $("#skills-cards").innerHTML = resumeDetails.skillsAndTools.map((item, index) => card("skill", index, field("Skill or tool", "name", item.name) + field("Category", "category", item.category), null)).join("");
  $("#certification-cards").innerHTML = resumeDetails.certificationEntries.map((item, index) => card("certification", index, field("Certification", "name", item.name) + field("Issuer", "issuer", item.issuer) + field("Issued date", "date", item.date) + field("Expiration date", "expirationDate", item.expirationDate) + field("Credential ID", "credentialId", item.credentialId), null)).join("");
  $("#language-cards").innerHTML = resumeDetails.languageEntries.map((item, index) => card("language", index, field("Language", "language", item.language) + booleanField("Fluent", "fluent", item.fluent) + field("Overall", "overall", item.overall) + field("Reading", "reading", item.reading) + field("Speaking", "speaking", item.speaking) + field("Writing", "writing", item.writing), null)).join("");
  const groups = [
    ["skills", "professional", resumeDetails.skillsAndTools.length],
    ["education", "education", resumeDetails.educationEntries.length],
    ["experience", "experience", resumeDetails.experienceEntries.length],
    ["project", "project", resumeDetails.projectEntries.length],
    ["certification", "certification", resumeDetails.certificationEntries.length],
    ["language", "language", resumeDetails.languageEntries.length]
  ];
  for (const [name, group, count] of groups) {
    $(`#${name}-count`).textContent = count ? `(${count})` : "";
  }
  for (const button of document.querySelectorAll(".remove-entry")) button.addEventListener("click", () => { button.closest(".entry-card").remove(); resumeDetails = detailsFromCards(); renderEntryCards(resumeDetails); });
}

function detailsFromCards() {
  const value = (card, name) => card.querySelector(`[name="${name}"]`)?.value.trim() || "";
  const cards = (type) => [...document.querySelectorAll(`.entry-card[data-entry-type="${type}"]`)];
  return { ...resumeDetails,
    skillsAndTools: cards("skill").map((card) => ({ name: value(card, "name"), category: value(card, "category") })),
    educationEntries: cards("education").map((card) => ({ school: value(card, "school"), degree: value(card, "degree"), major: value(card, "major"), startDate: value(card, "startDate"), endDate: value(card, "endDate"), isCurrent: value(card, "isCurrent") === "true" })),
    experienceEntries: cards("experience").map((card) => ({ company: value(card, "company"), title: value(card, "title"), location: value(card, "location"), startDate: value(card, "startDate"), endDate: value(card, "endDate"), isCurrent: value(card, "isCurrent") === "true", description: value(card, "description") })),
    projectEntries: cards("project").map((card) => ({ name: value(card, "name"), technologies: value(card, "technologies").split(",").map((item) => item.trim()).filter(Boolean), startDate: value(card, "startDate"), endDate: value(card, "endDate"), description: value(card, "description") })),
    certificationEntries: cards("certification").map((card) => ({ name: value(card, "name"), issuer: value(card, "issuer"), date: value(card, "date"), expirationDate: value(card, "expirationDate"), credentialId: value(card, "credentialId") })),
    languageEntries: cards("language").map((card) => ({ language: value(card, "language"), fluent: value(card, "fluent") === "true", overall: value(card, "overall"), reading: value(card, "reading"), speaking: value(card, "speaking"), writing: value(card, "writing") }))
  };
}

function syncCardsToProfile(details) {
  const normalizedDetails = normalizeResumeDetails(details);
  const education = sortEducationEntries(normalizedDetails.educationEntries || []);
  const experience = sortExperienceEntries(normalizedDetails.experienceEntries || []);
  const latestEducation = education[0] || {};
  const latestExperience = experience[0] || {};
  form.elements.education.value = formatEducation(education);
  form.elements.workExperience.value = formatExperience(experience);
  form.elements.projectExperience.value = formatProjects(normalizedDetails.projectEntries || []);
  form.elements.skills.value = (normalizedDetails.skillsAndTools || []).map((item) => item.name).filter(Boolean).join(", ");
  form.elements.school.value = latestEducation.school || "";
  form.elements.degree.value = latestEducation.degree || "";
  form.elements.major.value = latestEducation.major || "";
  form.elements.graduationYear.value = String(latestEducation.endDate || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
  form.elements.currentCompany.value = latestExperience.company || "";
  form.elements.currentTitle.value = latestExperience.title || "";
  form.elements.yearsExperience.value = calculateYearsExperience(experience);
}

function validateProcessedProfile(bundle) {
  if (!bundle || bundle.format !== "job-application-helper-profile" || bundle.version !== 1) {
    throw new Error("This is not a supported Job Application Helper profile file.");
  }
  if (!bundle.profile || !bundle.resumeDetails) throw new Error("The processed profile file is incomplete.");
  for (const name of ["skillsAndTools", "educationEntries", "experienceEntries", "projectEntries", "certificationEntries"]) {
    if (!Array.isArray(bundle.resumeDetails[name])) throw new Error(`The processed profile is missing ${name}.`);
  }
}

function validateAllProfilesBundle(bundle) {
  if (!bundle || bundle.format !== "job-application-helper-profile-slots" || bundle.version !== 1) {
    throw new Error("This is not a supported saved profiles backup file.");
  }
  if (!Array.isArray(bundle.profileSlots)) throw new Error("The saved profiles backup is missing profileSlots.");
  for (const slot of bundle.profileSlots) {
    if (!slot.profile || !slot.resumeDetails) throw new Error("One saved profile is incomplete.");
    for (const name of ["skillsAndTools", "educationEntries", "experienceEntries", "projectEntries", "certificationEntries"]) {
      if (!Array.isArray(slot.resumeDetails[name])) throw new Error(`One saved profile is missing ${name}.`);
    }
  }
}

function processedProfileToSlot(bundle, name = "") {
  const resumeDetails = orderedResumeDetails(bundle.resumeDetails);
  const profile = normalizeTopLevelDetails(bundle.profile || {});
  return {
    id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: profileSlotName(profile, name || bundle.profile?.fullName || bundle.profile?.email || ""),
    updatedAt: new Date().toISOString(),
    profile,
    resumeDetails
  };
}

function downloadJson(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

on("#export-profile", "click", async () => {
  resumeDetails = orderedResumeDetails(detailsFromCards());
  syncCardsToProfile(resumeDetails);
  const bundle = {
    format: "job-application-helper-profile",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: profileFromForm(),
    resumeDetails
  };
  downloadJson("job-application-helper-processed-profile.json", bundle);
  setStatus("Processed profile exported. Share the JSON file only through a trusted channel.");
});

on("#import-profile-file", "change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const bundle = JSON.parse(await file.text());
    validateProcessedProfile(bundle);
    resumeDetails = orderedResumeDetails(bundle.resumeDetails);
    populateForm(bundle.profile);
    renderEntryCards(resumeDetails);
    syncCardsToProfile(resumeDetails);
    await chrome.storage.local.set({ profile: profileFromForm(), resumeDetails, activeProfileSlotId: "" });
    await renderProfileSlots();
    showClassificationReport(resumeDetails);
    renderProfileCheck({ reviewMode: true });
    setStatus("Processed profile imported and saved locally. Ollama is not required for this profile.");
  } catch (error) {
    setStatus(`Could not import processed profile: ${error.message}`);
  } finally {
    event.target.value = "";
  }
});

on("#import-profile-slot-file", "change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const bundle = JSON.parse(await file.text());
    validateProcessedProfile(bundle);
    const { profileSlots } = await getProfileSlotState();
    const slot = processedProfileToSlot(bundle);
    profileSlots.push(slot);
    await setProfileSlotState(profileSlots, slot.id);
    await applyProfileSlot(slot);
    setStatus(`Imported "${slot.name}" as a saved profile and switched to it.`);
  } catch (error) {
    setStatus(`Could not import as saved profile: ${error.message}`);
  } finally {
    event.target.value = "";
  }
});

on("#export-all-profiles", "click", async () => {
  const { profileSlots, activeProfileSlotId } = await getProfileSlotState();
  const current = bundleFromCurrentProfile();
  const slots = [...profileSlots];
  if (!slots.some((slot) => slot.id === activeProfileSlotId) && Object.values(current.profile || {}).some((value) => String(value || "").trim())) {
    slots.push({ ...current, name: `${current.name} (current unsaved)` });
  }
  if (!slots.length) {
    setStatus("No saved profiles to export. Save the current profile as new first.");
    return;
  }
  downloadJson("job-application-helper-all-profiles.json", {
    format: "job-application-helper-profile-slots",
    version: 1,
    exportedAt: new Date().toISOString(),
    activeProfileSlotId,
    profileSlots: slots
  });
  setStatus(`Exported ${slots.length} saved profile(s).`);
});

on("#import-all-profiles-file", "change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const bundle = JSON.parse(await file.text());
    validateAllProfilesBundle(bundle);
    const { profileSlots, activeProfileSlotId } = await getProfileSlotState();
    const byId = new Map(profileSlots.map((slot) => [slot.id, slot]));
    for (const incoming of bundle.profileSlots) {
      const id = incoming.id || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      byId.set(id, {
        ...incoming,
        id,
        name: incoming.name || profileSlotName(incoming.profile),
        updatedAt: incoming.updatedAt || new Date().toISOString(),
        profile: normalizeTopLevelDetails(incoming.profile || {}),
        resumeDetails: orderedResumeDetails(incoming.resumeDetails)
      });
    }
    const nextSlots = [...byId.values()];
    const preferredActive = activeProfileSlotId || bundle.activeProfileSlotId || "";
    const nextActive = nextSlots.some((slot) => slot.id === preferredActive) ? preferredActive : "";
    await setProfileSlotState(nextSlots, nextActive);
    await renderProfileSlots();
    setStatus(`Imported ${bundle.profileSlots.length} saved profile(s). Existing profiles were merged by ID.`);
  } catch (error) {
    setStatus(`Could not import saved profiles: ${error.message}`);
  } finally {
    event.target.value = "";
  }
});

on("#save-new-profile-slot", "click", async () => {
  const { profileSlots } = await getProfileSlotState();
  const nameInput = $("#profile-slot-name");
  const slot = bundleFromCurrentProfile(nameInput?.value || "");
  profileSlots.push(slot);
  await setProfileSlotState(profileSlots, slot.id);
  await chrome.storage.local.set({ profile: slot.profile, resumeDetails: slot.resumeDetails });
  if (nameInput) nameInput.value = "";
  await renderProfileSlots();
  setStatus(`Saved current profile as "${slot.name}".`);
});

on("#load-profile-slot", "click", async () => {
  const select = $("#profile-slot-select");
  const id = select?.value || "";
  if (!id) {
    setStatus("Choose a saved profile first.");
    return;
  }
  const { profileSlots } = await getProfileSlotState();
  const slot = profileSlots.find((item) => item.id === id);
  if (!slot) {
    setStatus("That saved profile could not be found.");
    await renderProfileSlots();
    return;
  }
  await applyProfileSlot(slot);
  setStatus(`Switched to "${slot.name}". Autofill will use this profile now.`);
});

on("#update-profile-slot", "click", async () => {
  const select = $("#profile-slot-select");
  const id = select?.value || "";
  if (!id) {
    setStatus("Choose a saved profile to update.");
    return;
  }
  const { profileSlots } = await getProfileSlotState();
  const index = profileSlots.findIndex((slot) => slot.id === id);
  if (index < 0) {
    setStatus("That saved profile could not be found.");
    await renderProfileSlots();
    return;
  }
  const nameInput = $("#profile-slot-name");
  const name = cleanResumeText(nameInput?.value || "") || profileSlots[index].name;
  const slot = bundleFromCurrentProfile(name, id);
  profileSlots[index] = slot;
  await setProfileSlotState(profileSlots, id);
  await chrome.storage.local.set({ profile: slot.profile, resumeDetails: slot.resumeDetails });
  if (nameInput) nameInput.value = "";
  await renderProfileSlots();
  setStatus(`Updated "${slot.name}".`);
});

on("#delete-profile-slot", "click", async () => {
  const select = $("#profile-slot-select");
  const id = select?.value || "";
  if (!id) {
    setStatus("Choose a saved profile to delete.");
    return;
  }
  const { profileSlots, activeProfileSlotId } = await getProfileSlotState();
  const slot = profileSlots.find((item) => item.id === id);
  if (!slot) {
    setStatus("That saved profile could not be found.");
    await renderProfileSlots();
    return;
  }
  if (!confirm(`Delete saved profile "${slot.name}"? The current form will not be cleared.`)) return;
  const nextSlots = profileSlots.filter((item) => item.id !== id);
  await setProfileSlotState(nextSlots, activeProfileSlotId === id ? "" : activeProfileSlotId);
  await renderProfileSlots();
  setStatus(`Deleted saved profile "${slot.name}".`);
});

function showClassificationReport(details) {
  const report = $("#classification-report");
  report.classList.remove("hidden");
  report.textContent = `Created ${(details.skillsAndTools || []).length} Skills & Tools, ${(details.educationEntries || []).length} Education, ${(details.experienceEntries || []).length} Work Experience, ${(details.projectEntries || []).length} Project Experience, ${(details.certificationEntries || []).length} Certification, and ${(details.languageEntries || []).length} Language entries. Sections with results are expanded below.`;
  $("#raw-ai-panel").classList.remove("hidden");
  $("#raw-ai-json").value = JSON.stringify(details, null, 2);
}

function shouldRunSegmentationPass(details, resumeText) {
  const text = String(resumeText || "");
  const hasSkillsHint = /\b(?:skills|tools|technologies|software|platforms|languages)\b/i.test(text);
  const missingSkills = hasSkillsHint && !(details.skillsAndTools || []).length;
  const looksMerged = (entry) => {
    const description = String(entry?.description || "");
    const dateCount = (description.match(/\b(?:19|20)\d{2}\b/g) || []).length;
    const bulletCount = (description.match(/[•\n]|(?:^|\s)-\s/g) || []).length;
    return description.length > 900 || dateCount >= 4 || bulletCount >= 8;
  };
  const mergedEntries = [...(details.experienceEntries || []), ...(details.projectEntries || [])].some(looksMerged);
  return missingSkills || mergedEntries;
}

async function segmentResumeEntries(model, resumeText) {
  const startedAt = performance.now();
  setAiStatus(`First pass done. Running a second local AI pass to split merged entries...`);
  const prompt = [
    "/no_think",
    "Split the resume into separate structured entries.",
    "Your primary job is segmentation: create one array item for each distinct skill/tool, school, paid work or internship role, project, certification, and explicitly listed language.",
    "A section containing three roles must produce three experienceEntries. A section containing four projects must produce four projectEntries.",
    "Do not combine multiple roles, schools, projects, skills, or certifications into one item.",
    "Do not treat paid work or internships as projects. Do not treat projects as education. Do not treat coursework descriptions as separate schools.",
    "For education degree, return only the degree level/type. Example: 'M.S. in Project Management' means degree='Master's' and major='Project Management'.",
    "For work lines formatted as 'Job Title - Company Name', split them into title before the dash and company after the dash.",
    "For education lines formatted as 'School Name - City, State', keep only the school name in school and do not include the location.",
    "Sort each entry array newest first using dates. Current, Present, or Expected entries should sort before completed entries.",
    "Extract Skills & Tools from the entire resume, including technologies mentioned inside work and project bullets.",
    "Use YYYY-MM when month and year are available, YYYY when only year is available, and an empty string when unknown.",
    `JSON schema: ${JSON.stringify(entrySchema)}`,
    `Resume:\n${resumeText}`
  ].join("\n\n");
  const result = await ollamaRequest("chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: false, format: entrySchema, messages: [{ role: "user", content: prompt }], options: { temperature: 0, num_ctx: 8192 } })
  });
  setAiStatus(`Second pass finished in ${((performance.now() - startedAt) / 1000).toFixed(1)}s. Applying results...`);
  return JSON.parse(result.message?.content || "{}");
}

/*
async function pageAction(action, profile, approvedMatches = [], guidedTyping = false) {
  const normalized = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const autocompleteRules = {
    "given-name": "firstName",
    "family-name": "lastName",
    email: "email",
    tel: "phone",
    "street-address": "streetAddress",
    "address-line1": "streetAddress",
    "address-level2": "city",
    "address-level1": "state",
    "postal-code": "postalCode",
    country: "country",
    "country-name": "country"
  };
  const rules = [
    ["firstName", ["first name", "given name", "firstname", "fname"]],
    ["lastName", ["last name", "family name", "surname", "lastname", "lname"]],
    ["email", ["email", "email address", "e mail"]],
    ["phone", ["phone", "phone number", "mobile", "telephone", "tel"]],
    ["streetAddress", ["street address", "address line 1", "address1"]],
    ["city", ["city", "town"]],
    ["state", ["state", "province", "address level1"]],
    ["postalCode", ["zip", "zip code", "postal code", "postcode"]],
    ["country", ["country", "country region"]],
    ["linkedin", ["linkedin", "linkedin url", "linkedin profile"]],
    ["portfolio", ["portfolio", "portfolio url", "personal website"]],
    ["github", ["github", "github url", "github profile"]],
    ["currentCompany", ["current company", "current employer", "most recent employer"]],
    ["currentTitle", ["current title", "job title", "current position", "most recent title"]],
    ["yearsExperience", ["years of experience", "total years experience", "experience years"]],
    ["school", ["school", "university", "college", "institution"]],
    ["degree", ["degree", "degree type", "education level"]],
    ["major", ["major", "field of study", "discipline"]],
    ["graduationYear", ["graduation year", "graduation date", "year graduated"]],
    ["professionalSummary", ["professional summary", "summary", "profile summary"]],
    ["skills", ["skills", "technical skills"]],
    ["workAuthorization", ["authorized to work", "legally authorized", "work authorization"]],
    ["sponsorship", ["require sponsorship", "need sponsorship", "visa sponsorship"]],
    ["relocate", ["willing to relocate", "relocation"]],
    ["startDate", ["start date", "available start date", "earliest start date"]]
  ];

  const textFromIds = (ids) => String(ids || "").split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
  const textFor = (element) => {
    const idLabel = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.innerText : "";
    const parentLabel = element.closest("label")?.innerText || "";
    const ariaLabel = element.getAttribute("aria-label") || "";
    const ariaLabelledBy = textFromIds(element.getAttribute("aria-labelledby"));
    const ariaDescribedBy = textFromIds(element.getAttribute("aria-describedby"));
    const described = element.getAttribute("placeholder") || "";
    const container = element.closest(".form-group, .field, .application-field, [data-automation-id], [data-testid]");
    const containerText = container?.innerText || "";
    return normalized([idLabel, parentLabel, ariaLabel, ariaLabelledBy, ariaDescribedBy, described, element.name, element.id, element.autocomplete, containerText].filter(Boolean).join(" "));
  };

  const identify = (element) => {
    const autocomplete = normalized(element.getAttribute("autocomplete")).split(" ").at(-1);
    if (profile[autocompleteRules[autocomplete]]) return autocompleteRules[autocomplete];
    const text = textFor(element);
    for (const [key, aliases] of rules) {
      if (!profile[key]) continue;
      if (aliases.some((alias) => text === alias || text.includes(alias))) return key;
    }
    return null;
  };

  const elements = [...document.querySelectorAll("input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]), select, textarea, [contenteditable=true], [role=textbox], [role=combobox]")]
    .filter((element) => !element.disabled && !element.readOnly && element.offsetParent !== null);

  const candidates = elements.map((element, index) => {
    const key = identify(element);
    if (!key) return null;
    const label = textFor(element) || element.name || element.id || key;
    return { index, key, label, displayValue: profile[key], value: profile[key] };
  }).filter(Boolean);

  if (action === "scan") {
    const unmatched = elements.filter((element) => !identify(element)).slice(0, 8).map((element) => textFor(element) || element.tagName.toLowerCase());
    return {
      matches: candidates,
      total: elements.length,
      unmatched,
      frames: document.querySelectorAll("iframe").length
    };
  }

  const approved = new Set(approvedMatches.map((match) => `${match.index}:${match.key}`));
  const pause = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
  const setNativeValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
    setter ? setter.call(element, value) : (element.value = value);
  };
  const typeInto = async (element, value) => {
    element.click();
    element.focus();
    setNativeValue(element, "");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    for (const character of String(value)) {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: character, bubbles: true }));
      setNativeValue(element, `${element.value}${character}`);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: character, bubbles: true }));
      await pause(8);
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
  };

  let filled = 0;
  for (const candidate of candidates) {
    if (!approved.has(`${candidate.index}:${candidate.key}`)) continue;
    const element = elements[candidate.index];
    if (element instanceof HTMLSelectElement) {
      element.click();
      element.focus();
      const target = normalized(candidate.value);
      const option = [...element.options].find((item) => normalized(item.value) === target || normalized(item.text) === target);
      if (!option) continue;
      element.value = option.value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.blur();
    } else if (element.isContentEditable) {
      element.click();
      element.focus();
      element.textContent = candidate.value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.blur();
    } else if (guidedTyping) {
      await typeInto(element, candidate.value);
    } else {
      element.focus();
      setNativeValue(element, candidate.value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.blur();
    }
    filled += 1;
  }
  return filled;
}
*/

on(form, "submit", async (event) => {
  event.preventDefault();
  resumeDetails = orderedResumeDetails(detailsFromCards());
  syncCardsToProfile(resumeDetails);
  await chrome.storage.local.set({ profile: profileFromForm() });
  await chrome.storage.local.set({ resumeDetails });
  const updatedSlot = await updateActiveProfileSlotFromCurrent();
  renderProfileCheck();
  setStatus(updatedSlot ? "Profile saved locally and active saved profile updated." : "Profile saved locally.");
});

on("#clear-profile", "click", async () => {
  await chrome.storage.local.remove("profile");
  await chrome.storage.local.remove("resumeDetails");
  await chrome.storage.local.set({ activeProfileSlotId: "" });
  populateForm();
  resumeDetails = emptyResumeDetails();
  renderEntryCards(resumeDetails);
  await renderProfileSlots();
  setStatus("Local profile cleared.");
});

for (const button of document.querySelectorAll("[data-module-target]")) {
  button.addEventListener("click", () => showProfileModule(button.dataset.moduleTarget));
}

for (const button of document.querySelectorAll(".add-entry")) {
  button.addEventListener("click", () => {
    resumeDetails = detailsFromCards();
    if (button.dataset.entryType === "education") resumeDetails.educationEntries.push({ school: "", degree: "", major: "", startDate: "", endDate: "", isCurrent: false });
    if (button.dataset.entryType === "experience") resumeDetails.experienceEntries.push({ company: "", title: "", location: "", startDate: "", endDate: "", isCurrent: false, description: "" });
    if (button.dataset.entryType === "project") resumeDetails.projectEntries.push({ name: "", technologies: [], startDate: "", endDate: "", description: "" });
    if (button.dataset.entryType === "skill") resumeDetails.skillsAndTools.push({ name: "", category: "" });
    if (button.dataset.entryType === "certification") resumeDetails.certificationEntries.push({ name: "", issuer: "", date: "", expirationDate: "", credentialId: "" });
    if (button.dataset.entryType === "language") resumeDetails.languageEntries.push({ language: "", fluent: false, overall: "", reading: "", speaking: "", writing: "" });
    renderEntryCards(resumeDetails);
    renderProfileCheck();
  });
}

on("#run-profile-check", "click", () => {
  resumeDetails = orderedResumeDetails(detailsFromCards());
  syncCardsToProfile(resumeDetails);
  renderEntryCards(resumeDetails);
  renderProfileCheck();
  setStatus("Profile check updated.");
});

on("#start-review-mode", "click", () => {
  resumeDetails = orderedResumeDetails(detailsFromCards());
  syncCardsToProfile(resumeDetails);
  renderEntryCards(resumeDetails);
  renderProfileCheck({ reviewMode: true });
});

on("#expand-all", "click", () => {
  for (const details of document.querySelectorAll("#profile-form details:not([hidden])")) details.open = true;
});

on("#collapse-all", "click", () => {
  for (const details of document.querySelectorAll("#profile-form details:not([hidden])")) details.open = false;
});

function addResumeSuggestions(text, fileName = "", basicOnly = false) {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const firstLines = lines.slice(0, 8);
  const likelyName = firstLines.find((line) =>
    /^(?:[A-Z][A-Za-z'.-]+|[A-Z][A-Z'.-]+)(?:\s+(?:[A-Z][A-Za-z'.-]+|[A-Z][A-Z'.-]+)){1,3}$/.test(line) &&
    !/\b(?:resume|curriculum|vitae|summary|profile|education|experience|skills)\b/i.test(line)
  );
  const nameParts = likelyName?.split(/\s+/) || [];
  const section = (headings) => {
    const headingPattern = new RegExp(`^(?:${headings.join("|")})\\s*:?$`, "i");
    const allHeadings = /^(?:summary|profile|objective|skills|technical skills|education|academic background|experience|work experience|professional experience|employment|projects|certifications|awards|publications|languages)\s*:?\s*$/i;
    const start = lines.findIndex((line) => headingPattern.test(line));
    if (start === -1) return "";
    const collected = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      if (allHeadings.test(lines[index])) break;
      collected.push(lines[index]);
    }
    return collected.join("\n");
  };
  const education = section(["education", "academic background"]);
  const workExperience = section(["experience", "work experience", "professional experience", "employment"]);
  const skills = section(["skills", "technical skills"]);
  const professionalSummary = section(["summary", "profile", "objective"]);
  const degreeMatch = education.match(/\b(?:associate(?:'s)?|bachelor(?:'s)?|master(?:'s)?|doctor(?:ate)?|ph\.?d\.?|b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?a\.?|mba)\b[^\n,;]*/i);
  const schoolMatch = education.match(/[^\n]*(?:university|college|institute|school)[^\n]*/i);
  const graduationYear = education.match(/\b(?:19|20)\d{2}\b/g)?.at(-1);
  const workLines = workExperience.split("\n").map((line) => line.trim()).filter(Boolean);
  const titlePattern = /\b(?:engineer|developer|manager|analyst|designer|director|specialist|consultant|coordinator|assistant|intern|lead|associate|scientist|architect|administrator|officer|representative)\b/i;
  const companyPattern = /\b(?:inc\.?|llc|ltd\.?|corp\.?|corporation|company|co\.?|group|technologies|technology|solutions|systems|university|bank|labs?)\b/i;
  const currentCompanyLine = workLines.slice(0, 8).find((line) => companyPattern.test(line) && line.length < 100);
  const currentTitleLine = workLines.slice(0, 8).find((line) => titlePattern.test(line) && line.length < 100);
  const suggestions = {
    firstName: nameParts.length ? nameParts[0] : "",
    lastName: nameParts.length > 1 ? nameParts.at(-1) : "",
    email: text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0],
    phone: text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/)?.[0],
    linkedin: text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Z0-9_-]+\/?/i)?.[0],
    github: text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Z0-9_-]+\/?/i)?.[0],
    portfolio: text.match(/https?:\/\/(?!www\.linkedin\.com|linkedin\.com|www\.github\.com|github\.com)[^\s)]+/i)?.[0],
    professionalSummary,
    skills,
    education,
    workExperience,
    school: schoolMatch?.[0],
    degree: degreeMatch?.[0],
    graduationYear,
    currentCompany: currentCompanyLine,
    currentTitle: currentTitleLine,
    resumeFileName: fileName
  };
  if (basicOnly) {
    for (const name of ["professionalSummary", "skills", "education", "workExperience", "school", "degree", "graduationYear", "currentCompany", "currentTitle"]) {
      delete suggestions[name];
    }
  }
  let count = 0;
  for (const [name, value] of Object.entries(suggestions)) {
    if (!value || !form.elements[name] || form.elements[name].value) continue;
    form.elements[name].value = value;
    count += 1;
  }
  setStatus(count ? `Added ${count} high-confidence resume suggestions. Review the extracted text and profile before saving.` : "No new high-confidence suggestions found. Review the extracted text and add details manually.");
  return count;
}

async function readPdf(file) {
  const document = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = [];
    for (const item of content.items) {
      const y = Math.round(item.transform?.[5] || 0);
      let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x: item.transform?.[4] || 0, text: item.str });
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push(rows.map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"));
  }
  return pages.join("\n");
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readDocx(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd === -1) throw new Error("Could not read this DOCX file.");

  const decoder = new TextDecoder();
  const entries = new Map();
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let count = 0; count < entryCount; count += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    entries.set(name, { compression, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  const documentEntry = entries.get("word/document.xml");
  if (!documentEntry) throw new Error("This DOCX file does not contain readable document text.");
  const localNameLength = view.getUint16(documentEntry.localOffset + 26, true);
  const localExtraLength = view.getUint16(documentEntry.localOffset + 28, true);
  const dataOffset = documentEntry.localOffset + 30 + localNameLength + localExtraLength;
  const compressed = bytes.slice(dataOffset, dataOffset + documentEntry.compressedSize);
  const xmlBytes = documentEntry.compression === 0 ? compressed : await inflateRaw(compressed);
  const xml = decoder.decode(xmlBytes).replace(/<\/w:(?:p|tab|br)>/g, " ");
  return new DOMParser().parseFromString(xml, "application/xml").documentElement.textContent;
}

async function readResumeFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "pdf") return readPdf(file);
  if (extension === "docx") return readDocx(file);
  if (extension === "txt" || extension === "md") return file.text();
  throw new Error("Please select a PDF, DOCX, TXT, or MD resume.");
}

on("#extract-resume", "click", () => {
  addResumeSuggestions($("#resume-text").value, "", true);
});

on("#read-resume", "click", async () => {
  const file = $("#resume-file").files[0];
  if (!file) {
    setStatus("Choose a resume file first.");
    return;
  }
  try {
    setStatus("Reading your resume locally...");
    const text = await readResumeFile(file);
    $("#resume-text").value = text;
    form.elements.resumeFileName.value = file.name;
    setStatus("Resume text loaded locally. No classification has run yet. Choose Classify with local AI to generate entries.");
  } catch (error) {
    setStatus(`Could not read this resume: ${error.message}`);
  }
});

on("#refresh-models", "click", async () => {
  try {
    await refreshOllamaModels();
  } catch (error) {
    setStatus(error.message);
  }
});

on("#test-ollama", "click", async () => {
  const model = ollamaModel.value;
  if (!model) {
    setAiStatus("Detect and select a local Ollama model first.");
    return;
  }
  const started = performance.now();
  try {
    setAiStatus(`Testing ${model}. The first request may take a little longer...`);
    const result = await ollamaRequest("chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: "Reply with exactly: MODEL_OK" }], options: { temperature: 0, num_predict: 256 } })
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    setAiStatus(result.message?.content?.includes("MODEL_OK") ? `Local AI is working. ${model} replied in ${seconds} seconds.` : `Local AI responded in ${seconds} seconds, but the test reply was unexpected.`);
  } catch (error) {
    setAiStatus(`Local AI test failed: ${error.message}`);
  }
});

on("#open-job-finder", "click", () => chrome.tabs.create({ url: chrome.runtime.getURL("job_finder.html") }));

on(classifyButton, "click", async () => {
  const model = ollamaModel.value;
  const resumeText = $("#resume-text").value.trim();
  if (!model) {
    setStatus("Detect and select a local Ollama model first.");
    return;
  }
  if (!resumeText) {
    setStatus("Read a resume file or paste resume text first.");
    return;
  }
  try {
    const startedAt = performance.now();
    classifyButton.disabled = true;
    classifyButton.textContent = "Classifying...";
    resumeDetails = { skillsAndTools: [], educationEntries: [], experienceEntries: [], projectEntries: [], certificationEntries: [], languageEntries: [] };
    renderEntryCards(resumeDetails);
    $("#classification-report").classList.add("hidden");
    $("#raw-ai-panel").classList.add("hidden");
    $("#raw-ai-json").value = "";
    setAiStatus(`Preparing resume for local AI with ${model}...`);
    const prompt = [
      "/no_think",
      "Extract job application profile data from the resume below.",
      "Return only facts explicitly supported by the resume. Use empty strings or empty arrays when uncertain.",
      "Normalize ALL-CAPS resume text into readable professional capitalization. Keep true acronyms uppercase, such as NYU, USA, HR, SQL, CRM, ATS, OPT, CPT, STEM, MBA, and F-1.",
      "For fullName, return the complete candidate name exactly as supported by the resume. Also split it into firstName, middleName, and lastName when possible.",
      "Extract job application related preferences only when explicitly supported, including desiredTitle, employmentType, desiredSalary, noticePeriod, remotePreference, travel, workStatus, visaStatus, source, and coverLetterNotes. Otherwise return empty strings.",
      "For phoneCountryCode, return a dialing code such as +1 when clearly supported by the phone number or country. For phoneCountryName, return a country name such as United States when supported.",
      "For middleName, return a value only when the resume explicitly shows a separate middle name or middle initial as part of the person's name. Never infer a middle name from another word, heading, username, email address, or address. Otherwise return an empty string.",
      "For state, return only a US state name or two-letter state abbreviation explicitly supported by the resume. Never put USA, United States, or a country in state. Put the country in country. If the state is unknown, return an empty string.",
      "Create one separate array item for every education, work, project, skill/tool, and certification entry. Never merge multiple entries into one item.",
      "Keep educationEntries strictly limited to schools, degrees, majors, start dates, and end dates. Never include projects, coursework descriptions, or work history in educationEntries.",
      "For educationEntries.degree, return only the degree level/type, such as Associate's, Bachelor's, Master's, MBA, Doctorate, or Certificate. Put the field of study in major. Example: 'M.S. in Project Management' means degree='Master's' and major='Project Management'.",
      "Keep experienceEntries strictly limited to paid work, internships, or clearly labeled professional experience. Never include projects, skills, or education in experienceEntries.",
      "Keep projectEntries strictly limited to projects. Never include paid work, internships, schools, or degrees in projectEntries.",
      "When a work line is formatted like 'Job Title - Company Name', put the text before the dash in title and the text after the dash in company. Example: 'Real Estate Agent Assistant / Operations Support - EHOMIE New York Inc.' means title='Real Estate Agent Assistant / Operations Support' and company='EHOMIE New York Inc.'.",
      "When an education line is formatted like 'School Name - City, State', put only the school name in school and do not include the city/state in school. Example: 'New York University (NYU) - New York, NY' means school='New York University (NYU)'.",
      "Sort education, work experience, and project entries by actual dates after extraction. Use the newest end date first; ongoing/current/expected entries count as newest. If end dates tie, use newest start date.",
      "Extract skillsAndTools from the entire resume, even if there is no Skills heading. Include individual programming languages, frameworks, software, platforms, tools, spoken languages, and professional skills. Use one item per skill or tool. Do not return section headings, sentences, or paragraphs.",
      "Keep certificationEntries strictly limited to certifications, licenses, and professional certificates. Never place certificates in educationEntries.",
      "Extract languageEntries when languages are explicitly listed. Do not invent proficiency ratings. Leave unknown proficiency fields empty and set fluent to false unless explicitly supported.",
      "Use YYYY-MM when month and year are available, YYYY when only year is available, and an empty string when a date is unknown.",
      "For educationEntries and experienceEntries, set isCurrent to true only when the resume says Present, Current, Now, Expected, or clearly indicates the entry is ongoing.",
      "List education, experience, and projects newest first by dates. Do not assume the first item in the resume is the newest. Do not invent missing values.",
      `JSON schema: ${JSON.stringify(resumeSchema)}`,
      `Resume:\n${resumeText}`
    ].join("\n\n");
    const requestAt = performance.now();
    setAiStatus(`Sending ${resumeText.length.toLocaleString()} resume characters to local AI...`);
    const result = await ollamaRequest("chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: resumeSchema,
        messages: [{ role: "user", content: prompt }],
        options: { temperature: 0, num_ctx: 8192 }
      })
    });
    setAiStatus(`Local AI first pass returned in ${((performance.now() - requestAt) / 1000).toFixed(1)}s. Parsing JSON...`);
    const details = JSON.parse(result.message?.content || "{}");
    if (shouldRunSegmentationPass(details, resumeText)) {
      const segmented = await segmentResumeEntries(model, resumeText);
      Object.assign(details, segmented);
    } else {
      setAiStatus("First pass already produced separate entries. Skipping slower second pass.");
    }
    if (!Array.isArray(details.skillsAndTools) || !Array.isArray(details.educationEntries) || !Array.isArray(details.experienceEntries) || !Array.isArray(details.projectEntries) || !Array.isArray(details.certificationEntries) || !Array.isArray(details.languageEntries)) {
      throw new Error("The selected model returned an incomplete structure. Try the classification again or use a larger model.");
    }
    const count = applyOllamaDetails(details);
    await chrome.storage.local.set({ ollamaModel: model, resumeDetails });
    showClassificationReport(resumeDetails);
    renderProfileCheck({ reviewMode: true });
    setAiStatus(`Local AI updated ${count} fields in ${((performance.now() - startedAt) / 1000).toFixed(1)}s and created ${resumeDetails.skillsAndTools.length} skill/tool, ${resumeDetails.educationEntries.length} education, ${resumeDetails.experienceEntries.length} work, ${resumeDetails.projectEntries.length} project, ${resumeDetails.certificationEntries.length} certification, and ${resumeDetails.languageEntries.length} language card(s). Review, then save.`);
  } catch (error) {
    setAiStatus(`Local AI could not classify this resume: ${error.message}`);
  } finally {
    classifyButton.disabled = false;
    classifyButton.textContent = "Classify with local AI";
  }
});

Promise.all([getProfile(), chrome.storage.local.get(["resumeDetails", "profileManagerModule"])]).then(([profile, stored]) => {
  populateForm(profile);
  if (stored.resumeDetails) {
    resumeDetails = stored.resumeDetails;
    renderEntryCards(resumeDetails);
    showClassificationReport(resumeDetails);
    renderProfileCheck();
  } else {
    renderEntryCards(resumeDetails);
    renderProfileCheck();
  }
  showProfileModule(stored.profileManagerModule || "resume");
  renderProfileSlots();
});
