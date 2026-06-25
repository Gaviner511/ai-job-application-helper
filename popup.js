import { getAiSettings, runVisionJsonAi } from "./modules/ai_client.js";
import { capturePageScreenshots } from "./modules/visual_reader.js";

const popupParams = new URLSearchParams(location.search);
document.body.classList.toggle("floating", popupParams.get("floating") === "1");
document.body.classList.toggle("workspace-expanded", popupParams.get("workspaceMode") === "expanded");
document.body.classList.toggle("workspace-compact", popupParams.get("floating") === "1" && popupParams.get("workspaceMode") !== "expanded");

const $ = (selector) => document.querySelector(selector);
function on(selector, eventName, handler, options) {
  const element = typeof selector === "string" ? $(selector) : selector;
  if (!element) {
    console.warn(`Popup: missing element for ${eventName}: ${selector}`);
    return null;
  }
  element.addEventListener(eventName, handler, options);
  return element;
}
const status = $("#status");
const results = $("#results");
const matchSummary = $("#match-summary");
const scanDiagnostic = $("#scan-diagnostic");
const fillButton = $("#fill");
const fillHighConfidenceButton = $("#fill-high-confidence");
const fillSelectedButton = $("#fill-selected");
const enableFramesButton = $("#enable-frames");
const aiScanButton = $("#ai-scan");
const aiVisualScanButton = $("#ai-visual-scan");
const clearPageButton = $("#clear-page");
const diagnosticsButton = $("#copy-diagnostics");
const fieldPickerButton = $("#field-picker");
const popupProfileSelect = $("#popup-profile-slot-select");
const popupSwitchProfileButton = $("#popup-switch-profile");
const popupActiveProfile = $("#popup-active-profile");
const modeBasicButton = $("#mode-basic");
const modeAdvancedButton = $("#mode-advanced");
const onboardingCard = $("#onboarding-card");
const dismissOnboardingButton = $("#dismiss-onboarding");
const compatibilityCard = $("#compatibility-card");
const compatibilityTitle = $("#compatibility-title");
const compatibilityMessage = $("#compatibility-message");
const repairHelperButton = $("#repair-helper");
let pendingMatches = [];
let scannedFields = [];
let embeddedFrameLinks = [];
let ignoredMatchIds = new Set();
let currentChoices = [];
let currentHost = "";
let lastScanMeta = {};
const SEARCH_TAGS = {
  fullName: "full name legal name name applicant name candidate name complete name display name preferred full name your name name as it appears",
  firstName: "first name given name firstname fname forename personal name",
  preferredName: "preferred name nickname preferred first name goes by chosen name",
  middleName: "middle name additional name middlename middle initial mi",
  lastName: "last name family name surname lastname lname family surname",
  email: "email email address e mail contact email primary email",
  phoneCountryCode: "phone country code country calling code calling code dialing code dial code telephone country code mobile country code",
  phoneCountryName: "phone country telephone country phone country name telephone country country code united states usa country calling country",
  phone: "phone phone number mobile telephone tel cell cellphone mobile number contact number primary phone",
  streetAddress: "street address address line 1 address1 mailing address home address current address residential address address street",
  addressLine2: "address line 2 address2 apartment apt suite unit building floor room address continuation",
  city: "city town municipality locality address city",
  state: "state province region address level1 state province administrative area",
  postalCode: "zip zip code postal code postcode postal zipcode",
  country: "country country region nation residence country address country",
  linkedin: "linkedin linkedin url linkedin profile linkedin link social profile",
  portfolio: "portfolio portfolio url personal website website personal site online portfolio homepage",
  github: "github github url github profile github link code repository",
  currentCompany: "current company current employer most recent employer current organization present company employer",
  currentTitle: "current title job title current position most recent title position title current role present role",
  yearsExperience: "years of experience total years experience experience years years professional experience total experience",
  professionalSummary: "professional summary profile summary summary about me bio biography introduction candidate summary personal summary",
  skills: "skills technical skills tools technologies competencies qualifications expertise abilities software tools platforms",
  graduationYear: "graduation year graduation date year graduated completion year expected graduation grad year degree date",
  startDate: "available start date earliest start date availability date when can you start start work date available from",
  desiredTitle: "desired job title desired title target role target position position applying for preferred role desired position role applying to",
  employmentType: "employment type job type full time part time contract internship temporary permanent schedule type work type",
  desiredSalary: "desired salary salary expectation compensation expected pay pay expectation expected compensation salary requirements target salary",
  noticePeriod: "notice period notice availability resignation notice available after",
  remotePreference: "remote preference work arrangement remote hybrid onsite on site workplace preference work location preference",
  travel: "travel willing to travel travel requirement travel availability",
  workAuthorization: "authorized to work legally authorized work authorization employment authorization eligible to work right to work authorized employment eligibility",
  sponsorship: "require sponsorship need sponsorship visa sponsorship immigration sponsorship work visa sponsorship future sponsorship now or in the future",
  relocate: "willing to relocate relocation relocate open to relocate relocation preference",
  workStatus: "citizenship work status employment status authorization status legal status work eligibility citizenship status",
  visaStatus: "visa status immigration status visa type current visa immigration type opt cpt stem opt f1 f 1",
  source: "source referral source how did you hear where did you hear heard about us job source referral channel",
  referralCode: "referral code employee referral code referrer code referral id referral name referred by",
  coverLetterNotes: "cover letter motivation additional information notes message comments why interested open ended response",
  school: "school university college institution education educational institution academic institution institution name university name college name",
  degree: "degree degree type education level diploma qualification credential award level",
  major: "major field of study discipline concentration program area of study course of study specialization",
  company: "company employer legal employer employer name organization organization name company name business name",
  title: "job title title position role position title role title employment title",
  location: "location city employer city work location job location office location workplace location",
  description: "responsibilities role description description duties job duties tasks achievements achievement accomplishments accomplishment contributions contribution impact results key achievements work summary responsibilities achievements main duties",
  name: "license certificate certification license or certificate credential certification name license name certificate name",
  issuer: "issued by issuer issuing organization issuing authority provider certifying body organization",
  number: "certificate number certification number credential id license number certificate id license id registration number",
  language: "language language name spoken language languages known language proficiency",
  fluent: "fluent fluency native fluent speaker",
  overall: "overall comprehension proficiency overall proficiency language level",
  reading: "reading read proficiency reading proficiency",
  speaking: "speaking speak proficiency oral spoken proficiency",
  writing: "writing write proficiency written writing proficiency",
  start: "start date from beginning date begin date started start month start year",
  end: "end date to graduation date completion date finish date ended end month end year",
  date: "issue date issued date acquired date date earned date received certification date",
  expiration: "expiration date expiry date expires valid until valid through renewal date"
};

function setStatus(message) {
  status.textContent = message;
}

async function applyUxMode(mode) {
  const normalized = mode === "advanced" ? "advanced" : "basic";
  document.body.classList.toggle("mode-advanced", normalized === "advanced");
  document.body.classList.toggle("mode-basic", normalized !== "advanced");
  modeBasicButton?.classList.toggle("active", normalized !== "advanced");
  modeAdvancedButton?.classList.toggle("active", normalized === "advanced");
  await chrome.storage.local.set({ jahUxMode: normalized });
}

async function initUxMode() {
  const stored = await chrome.storage.local.get(["jahUxMode", "jahOnboardingDone"]);
  await applyUxMode(stored.jahUxMode === "advanced" ? "advanced" : "basic");
  onboardingCard?.classList.toggle("hidden", Boolean(stored.jahOnboardingDone));
}

function renderCompatibility(scan = lastScanMeta, matches = pendingMatches, fields = scannedFields) {
  if (!compatibilityCard || !compatibilityTitle || !compatibilityMessage) return;
  if (!fields.length && !matches.length && !scan?.total) {
    compatibilityCard.className = "panel compatibility-card hidden";
    return;
  }
  const buckets = reviewBuckets(matches, fields);
  const manualCount = buckets.needsReview.filter((match) => match.requiresManual).length;
  const sensitiveCount = buckets.needsReview.filter((match) => match.sensitive).length;
  const frameCount = Number(scan?.frames || 0);
  const total = Number(scan?.total || fields.length || 0);
  let level = "good";
  let title = "Great fit";
  let message = `${buckets.highConfidence.length} high-confidence match(es). Review, then fill safely.`;
  if (!matches.length || frameCount || manualCount || sensitiveCount || buckets.missingInfo.length > Math.max(2, total * 0.35)) {
    level = "review";
    title = "Needs review";
    message = `${manualCount} dropdown/search field(s), ${sensitiveCount} sensitive field(s), ${buckets.missingInfo.length} missing info item(s). Use Fill this or click-to-choose for uncertain fields.`;
  }
  if (total && !matches.length) {
    level = "limited";
    title = "Limited support";
    message = "Fields were found, but confident matches were low. Try click-to-choose, then save corrections for this site.";
  }
  if (!total && frameCount) {
    level = "limited";
    title = "Embedded form";
    message = "This site may hide the form inside frames. Open the embedded form directly if available.";
  }
  compatibilityCard.className = `panel compatibility-card ${level}`;
  compatibilityTitle.textContent = title;
  compatibilityMessage.textContent = message;
}

async function getProfile() {
  return (await chrome.storage.local.get("profile")).profile || {};
}

async function getApplicationData() {
  const stored = await chrome.storage.local.get(["profile", "resumeDetails"]);
  return { ...(stored.profile || {}), __resumeDetails: stored.resumeDetails || {} };
}

async function getProfileSlots() {
  const stored = await chrome.storage.local.get(["profileSlots", "activeProfileSlotId"]);
  return { profileSlots: Array.isArray(stored.profileSlots) ? stored.profileSlots : [], activeProfileSlotId: stored.activeProfileSlotId || "" };
}

async function renderPopupProfileSwitcher() {
  if (!popupProfileSelect || !popupActiveProfile) return;
  const { profileSlots, activeProfileSlotId } = await getProfileSlots();
  popupProfileSelect.replaceChildren();
  if (!profileSlots.length) {
    popupProfileSelect.append(new Option("No saved profiles", ""));
    popupProfileSelect.disabled = true;
    if (popupSwitchProfileButton) popupSwitchProfileButton.disabled = true;
    popupActiveProfile.textContent = "Current browser profile";
    return;
  }
  popupProfileSelect.disabled = false;
  if (popupSwitchProfileButton) popupSwitchProfileButton.disabled = false;
  for (const slot of profileSlots) {
    const label = `${slot.id === activeProfileSlotId ? "Active - " : ""}${slot.name || "Untitled profile"}`;
    popupProfileSelect.append(new Option(label, slot.id));
  }
  popupProfileSelect.value = activeProfileSlotId || profileSlots[0]?.id || "";
  const active = profileSlots.find((slot) => slot.id === activeProfileSlotId);
  popupActiveProfile.textContent = active ? active.name : "Current browser profile";
}

async function switchPopupProfile(slotId) {
  const { profileSlots } = await getProfileSlots();
  const slot = profileSlots.find((item) => item.id === slotId);
  if (!slot) throw new Error("Choose a saved profile first.");
  await chrome.storage.local.set({ profile: slot.profile || {}, resumeDetails: slot.resumeDetails || {}, activeProfileSlotId: slot.id });
  pendingMatches = [];
  scannedFields = [];
  ignoredMatchIds = new Set();
  currentChoices = [];
  renderMatches([], []);
  scanDiagnostic?.classList.add("hidden");
  updateFillButtons();
  await clearScanState();
  if (fieldPickerButton?.textContent?.startsWith("Disable")) {
    await setFieldPickerMode("disable-picker", true);
    await setFieldPickerMode("enable-picker", true);
  }
  await renderPopupProfileSwitcher();
  setStatus(`Switched to "${slot.name || "Untitled profile"}". Scan again so matches use this profile.`);
}

async function runInPage(func, args = [], targetOptions = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active browser tab found.");
  return chrome.scripting.executeScript({ target: { tabId: tab.id, ...targetOptions }, func, args });
}

async function getBrowserFrameLinks() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !chrome.webNavigation?.getAllFrames) return [];
  const ignoredFrameUrl = (url) => /content\.googleapis\.com\/static\/proxy\.html|\/static\/proxy\.html|apis\.google\.com\/.*\/iframe|recaptcha(?:\.net|\.google\.com)\/recaptcha|google\.com\/recaptcha/i.test(url || "");
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    return (frames || [])
      .filter((frame) => frame.frameId !== 0 && /^https?:\/\//i.test(frame.url || ""))
      .filter((frame) => !ignoredFrameUrl(frame.url))
      .map((frame) => ({ src: frame.url, title: `frame ${frame.frameId}` }));
  } catch {
    return [];
  }
}

async function getActiveHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    return new URL(tab?.url || "").hostname || "";
  } catch {
    return "";
  }
}

async function loadMappingMemory() {
  return (await chrome.storage.local.get("mappingMemory")).mappingMemory || {};
}

async function saveMappingMemory(memory) {
  await chrome.storage.local.set({ mappingMemory: memory });
}

async function waitForApplicationFields() {
  try {
    const [result] = await runInPage(async () => {
      const platformText = `${location.hostname} ${location.href} ${document.title || ""} ${document.body?.innerText?.slice(0, 1800) || ""}`;
      const isGreenhouse = /(^|\.)job-boards\.greenhouse\.io$/i.test(location.hostname) || /greenhouse/i.test(platformText);
      const isDynamicAts = isGreenhouse || /smartrecruiters\.com|oneclick-ui|ashbyhq\.com|ashby/i.test(platformText);
      const selector = [
        "input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset])",
        "select",
        "textarea",
        "[contenteditable=true]",
        "[role=textbox]",
        "[role=combobox]",
        "[role=spinbutton]",
        "button[aria-haspopup]",
        "button[aria-controls]",
        "[role=button][aria-haspopup]",
        "[data-automation-id*=select]",
        "[data-testid*=select]",
        "[data-test*=select]",
        "[data-test-id*=select]",
        "[data-qa*=select]",
        "[data-testid*=input]",
        "[data-test*=input]",
        "[data-test-id*=input]",
        "[data-qa*=input]",
        "[data-testid*=field]",
        "[data-test*=field]",
        "[data-test-id*=field]",
        "[data-qa*=field]"
      ].join(", ");
      const fieldInfo = () => {
        const fields = [...document.querySelectorAll(selector)].filter((element) => {
          const type = String(element.getAttribute("type") || "").toLowerCase();
          return !["hidden", "file", "submit", "button", "image", "reset"].includes(type) && !element.disabled && !element.readOnly;
        });
        return {
          url: location.href,
          isGreenhouse,
          count: fields.length,
          first: fields.slice(0, 8).map((element) => [element.tagName.toLowerCase(), element.getAttribute("type") || "", element.name || "", element.id || "", element.getAttribute("aria-label") || "", element.getAttribute("autocomplete") || ""].filter(Boolean).join(" | "))
        };
      };
      const deadline = Date.now() + (isDynamicAts ? 4500 : 2000);
      let info = fieldInfo();
      let stableRounds = 0;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const next = fieldInfo();
        stableRounds = next.count === info.count ? stableRounds + 1 : 0;
        info = next;
        if ((!isDynamicAts && info.count > 0) || (info.count > 0 && stableRounds >= 3)) break;
      }
      return info;
    });
    return result?.result || {};
  } catch {
    return {};
  }
}

async function scanStorageKey() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return "";
  return `scanState:${tab.id}:${tab.url || ""}`;
}

async function saveScanState() {
  const key = await scanStorageKey();
  if (key) await chrome.storage.local.set({ [key]: { pendingMatches, scannedFields, ignoredMatchIds: [...ignoredMatchIds], lastScanMeta, savedAt: Date.now() } });
}

async function loadScanState() {
  const key = await scanStorageKey();
  if (!key) return;
  const state = (await chrome.storage.local.get(key))[key];
  if (!state || Date.now() - Number(state.savedAt || 0) > 24 * 60 * 60 * 1000) return;
  pendingMatches = state.pendingMatches || [];
  scannedFields = state.scannedFields || [];
  ignoredMatchIds = new Set(state.ignoredMatchIds || []);
  lastScanMeta = state.lastScanMeta || {};
  currentHost = await getActiveHost();
  currentChoices = applicationChoices(await getApplicationData());
  renderMatches(pendingMatches, scannedFields);
  renderCompatibility(lastScanMeta, pendingMatches, scannedFields);
  updateFillButtons();
  if (pendingMatches.length || scannedFields.length) setStatus(`Restored ${pendingMatches.length} match(es) and ${scannedFields.length} scanned field(s) for this page.`);
}

async function clearScanState() {
  const key = await scanStorageKey();
  if (key) await chrome.storage.local.remove(key);
  lastScanMeta = {};
  renderCompatibility({}, [], []);
}

function summarizeFrameResults(frameResults) {
  return frameResults.reduce((summary, frame) => {
    if (!frame.result) return summary;
    summary.accessibleFrames += 1;
    summary.total += frame.result.total;
    summary.rawTotal += frame.result.rawTotal || 0;
    summary.frames += frame.result.frames;
    summary.frameLinks.push(...(frame.result.frameLinks || []));
    summary.matches.push(...frame.result.matches.map((match) => ({ ...match, frameId: frame.frameId })));
    summary.fields.push(...frame.result.fields.map((field) => ({ ...field, frameId: frame.frameId })));
    summary.unmatched.push(...frame.result.unmatched);
    summary.debug.push(...(frame.result.debug || []));
    summary.platform.greenhouseLike ||= Boolean(frame.result.platform?.greenhouseLike);
    summary.platform.smartRecruitersLike ||= Boolean(frame.result.platform?.smartRecruitersLike);
    summary.platform.ashbyLike ||= Boolean(frame.result.platform?.ashbyLike);
    summary.platform.dynamicAtsLike ||= Boolean(frame.result.platform?.dynamicAtsLike);
    return summary;
  }, { matches: [], fields: [], total: 0, rawTotal: 0, unmatched: [], frames: 0, accessibleFrames: 0, frameLinks: [], debug: [], platform: { greenhouseLike: false, smartRecruitersLike: false, ashbyLike: false, dynamicAtsLike: false } });
}

function matchId(match) {
  return `${match.frameId}:${match.index}:${match.key}`;
}

function memorySignature(fieldOrMatch = {}) {
  if (fieldOrMatch.signature) return fieldOrMatch.signature;
  const label = String(fieldOrMatch.label || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 140);
  return label;
}

function memoryId(host, signature) {
  return `${host || "unknown"}::${signature}`;
}

function prettyKeyLabel(key) {
  return String(key || "")
    .replace(/:/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function choiceForKey(key) {
  return currentChoices.find((choice) => choice.key === key);
}

function updatePendingMatch(match, key) {
  const choice = choiceForKey(key);
  if (!choice) return false;
  const index = pendingMatches.findIndex((item) => item.frameId === match.frameId && item.index === match.index);
  if (index < 0) return false;
  pendingMatches[index] = {
    ...pendingMatches[index],
    key,
    value: choice.value,
    displayValue: String(choice.value),
    confidence: 0.91,
    learned: false,
    corrected: true
  };
  return true;
}

async function saveCorrection(match) {
  const signature = memorySignature(match);
  if (!signature || !match.key) return;
  const memory = await loadMappingMemory();
  const id = memoryId(currentHost, signature);
  memory[id] = {
    id,
    host: currentHost,
    signature,
    label: match.label || "",
    key: match.key,
    updatedAt: new Date().toISOString(),
    uses: Number(memory[id]?.uses || 0)
  };
  await saveMappingMemory(memory);
  setStatus(`Saved correction for this site's "${match.label || "field"}" field.`);
}

function matchFromMemory(field, memory, host, profile) {
  const signature = memorySignature(field);
  const saved = memory[memoryId(host, signature)];
  if (!saved?.key) return null;
  const value = valueForApplicationKey(profile, saved.key);
  if (value === "" || value === undefined || value === null || value === false) return null;
  const requiresManual = /combobox|custom-select|autocomplete/.test(field.controlKind || "") || (field.tag === "button" && field.role !== "textbox");
  return {
    frameId: field.frameId,
    index: field.index,
    key: saved.key,
    label: field.label || saved.label || saved.key,
    value,
    displayValue: String(value),
    requiresManual,
    confidence: 0.94,
    learned: true
  };
}

async function applyMappingMemory(scan, profile) {
  const memory = await loadMappingMemory();
  const byField = new Map(scan.matches.map((match) => [`${match.frameId}:${match.index}`, match]));
  for (const field of scan.fields || []) {
    const learned = matchFromMemory(field, memory, currentHost, profile);
    if (learned) byField.set(`${learned.frameId}:${learned.index}`, learned);
  }
  scan.matches = [...byField.values()];
  return scan;
}

function isSensitiveMatch(match = {}) {
  const text = `${match.key || ""} ${match.label || ""}`.toLowerCase();
  return /work authorization|authorized to work|sponsor|sponsorship|visa|immigration|salary|compensation|pay expectation|expected pay|years? of experience|experience years|disability|disabled|veteran|gender|race|ethnicity|hispanic|demographic|self identification|self-identification|pronoun|sexual orientation/.test(text);
}

function reviewedMatch(match = {}) {
  const sensitive = Boolean(match.sensitive) || isSensitiveMatch(match);
  const confidence = Number(match.confidence || (match.requiresManual ? 0.82 : sensitive ? 0.88 : 0.96));
  const id = matchId(match);
  return { ...match, id, sensitive, confidence, ignored: ignoredMatchIds.has(id) };
}

function reviewBuckets(matches = pendingMatches, fields = scannedFields) {
  const reviewed = matches.map(reviewedMatch).filter((match) => !match.ignored);
  const matchedIds = new Set(reviewed.map((match) => `${match.frameId}:${match.index}`));
  const highConfidence = reviewed.filter((match) => !match.requiresManual && !match.sensitive && match.confidence >= 0.9);
  const needsReview = reviewed.filter((match) => match.requiresManual || match.sensitive || match.confidence < 0.9);
  const missingInfo = fields.filter((field) => field.blank && !matchedIds.has(`${field.frameId}:${field.index}`));
  return { reviewed, highConfidence, needsReview, missingInfo };
}

function updateFillButtons() {
  const buckets = reviewBuckets();
  fillButton.disabled = buckets.highConfidence.length === 0;
  fillHighConfidenceButton.disabled = buckets.highConfidence.length === 0;
  fillSelectedButton.disabled = !document.querySelector(".match-select:checked");
}

function renderScanDiagnostic(scan = {}, pageFieldProbe = {}) {
  if (!scanDiagnostic) return;
  scanDiagnostic.classList.remove("hidden");
  const issues = [];
  if (scan.frames) issues.push(`${scan.frames} embedded frame(s) detected`);
  if ((scan.rawTotal || 0) > (scan.total || 0)) issues.push(`${scan.rawTotal - scan.total} editable-looking field(s) were filtered out`);
  if (scan.total && !scan.matches?.length) issues.push("fields found but no confident matches");
  if (pageFieldProbe?.isGreenhouse) issues.push("Greenhouse page detected");
  const action = scan.matches?.length
    ? "Review High Confidence and Needs Review before filling."
    : scan.total
      ? "Try Improve scan with local AI, then use click-to-choose for remaining fields."
      : scan.frameLinks?.length
        ? "Open the embedded form directly, then scan the new tab."
        : "Wait for the form to fully load or copy the diagnostic report for debugging.";
  scanDiagnostic.innerHTML = `
    <strong>Scan diagnostic</strong>
    <span>${scan.total || 0} scanned field(s), ${scan.rawTotal || 0} editable-looking field(s), ${scan.matches?.length || 0} match(es).</span>
    <small>${issues.length ? issues.join(" | ") : "No obvious scan warning."}</small>
    <small>Suggested next step: ${action}</small>
  `;
}

function renderMatches(matches, fields = scannedFields) {
  results.replaceChildren();
  const buckets = reviewBuckets(matches, fields);
  const blankCount = fields.filter((item) => item.blank).length;
  const sensitiveCount = buckets.needsReview.filter((match) => match.sensitive).length;
  const openEndedCount = fields.filter((field) => /textarea|textbox/i.test(`${field.tag} ${field.controlKind}`) && /why|describe|tell us|cover letter|additional information|question|response/i.test(field.label || "")).length;
  if (matchSummary) {
    matchSummary.textContent = matches.length || fields.length
      ? `${fields.length} field(s): ${buckets.highConfidence.length} high confidence, ${buckets.needsReview.length} need review, ${buckets.missingInfo.length} missing info, ${sensitiveCount} sensitive, ${openEndedCount} open-ended.`
      : fields.length
        ? `${fields.length} field(s) found, but none are safe enough for automatic filling yet.`
        : "No scan yet.";
  }
  const section = (title, items, className = "") => {
    if (!items.length) return;
    const heading = document.createElement("div");
    heading.className = `result-group ${className}`;
    heading.textContent = `${title} (${items.length})`;
    results.append(heading);
  };
  const renderMatch = (match, defaultChecked) => {
    const row = document.createElement("div");
    row.className = `match ${match.requiresManual || match.sensitive ? "manual-match" : ""}`;
    const select = document.createElement("input");
    select.className = "match-select";
    select.type = "checkbox";
    select.checked = defaultChecked;
    select.dataset.matchId = match.id;
    select.addEventListener("change", updateFillButtons);
    const text = document.createElement("div");
    text.className = "match-text";
    const label = document.createElement("strong");
    label.textContent = match.label || "Detected field";
    const key = document.createElement("small");
    key.className = "match-key";
    key.textContent = `Matched to: ${prettyKeyLabel(match.key)} | confidence ${Math.round(match.confidence * 100)}%${match.sensitive ? " | sensitive" : ""}`;
    const value = document.createElement("span");
    value.className = "match-value";
    value.textContent = match.displayValue;
    const note = document.createElement("small");
    note.className = "match-note";
    note.textContent = match.learned ? "Using a saved correction for this site." : match.sensitive ? "Needs confirmation because this looks sensitive." : match.requiresManual ? "Click Choose to type and auto-select the best dropdown result. Bulk fill skips this for safety." : "Safe for high-confidence fill.";
    const correction = document.createElement("select");
    correction.className = "mapping-select";
    correction.title = "Change matched profile key";
    for (const choice of currentChoices) {
      const option = document.createElement("option");
      option.value = choice.key;
      option.textContent = prettyKeyLabel(choice.key);
      option.selected = choice.key === match.key;
      correction.append(option);
    }
    correction.addEventListener("change", async () => {
      updatePendingMatch(match, correction.value);
      renderMatches(pendingMatches, scannedFields);
      await saveScanState();
    });
    const fillOne = document.createElement("button");
    fillOne.className = "secondary compact fill-one";
    fillOne.type = "button";
    fillOne.textContent = match.requiresManual ? "Choose" : "Fill";
    fillOne.addEventListener("click", () => fillMatches([{ ...match, allowManual: true }]));
    const ignore = document.createElement("button");
    ignore.className = "secondary compact fill-one";
    ignore.type = "button";
    ignore.textContent = "Ignore";
    ignore.addEventListener("click", async () => {
      ignoredMatchIds.add(match.id);
      pendingMatches = pendingMatches.filter((item) => matchId(item) !== match.id);
      renderMatches(pendingMatches, scannedFields);
      await saveScanState();
    });
    const save = document.createElement("button");
    save.className = "secondary compact fill-one";
    save.type = "button";
    save.textContent = "Save correction";
    save.addEventListener("click", () => saveCorrection(reviewedMatch(pendingMatches.find((item) => item.frameId === match.frameId && item.index === match.index) || match)));
    text.append(label, key, value, note, correction);
    const actions = document.createElement("div");
    actions.className = "match-actions";
    actions.append(fillOne, save, ignore);
    row.append(select, text, actions);
    results.append(row);
  };
  section("High Confidence", buckets.highConfidence, "high");
  for (const match of buckets.highConfidence) renderMatch(match, true);
  section("Needs Review", buckets.needsReview, "review");
  for (const match of buckets.needsReview) renderMatch(match, false);
  section("Missing Info", buckets.missingInfo, "missing");
  for (const field of buckets.missingInfo) {
    const row = document.createElement("div");
    row.className = "match unmatched";
    const text = document.createElement("div");
    text.className = "match-text";
    const label = document.createElement("strong");
    label.textContent = field.label || `${field.tag} field`;
    const value = document.createElement("span");
    value.className = "match-value";
    value.textContent = "No matching profile value yet. Use click-to-choose or update Profile Manager.";
    text.append(label, value);
    row.append(text);
    results.append(row);
  }
  updateFillButtons();
  renderCompatibility(lastScanMeta, matches, fields);
}

async function ollamaRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`http://localhost:11434/api/${path}`, { signal: AbortSignal.timeout(300000), ...options });
  } catch {
    throw new Error("Could not connect to Ollama. Open Profile Manager and test the local AI first.");
  }
  if (response.status === 403) throw new Error("Ollama blocked this extension. Restart Ollama after setting OLLAMA_ORIGINS=chrome-extension://*.");
  if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);
  return response.json();
}

function valueForProfileKey(profile, key) {
  if (key === "phoneCountryCode") return String(profile.phone || "").match(/^\s*(\+\d{1,3})\b/)?.[1] || (/^(?:usa|united states|us)$/i.test(profile.country || "") ? "+1" : "");
  if (key === "phoneCountryName") return profile.phoneCountryName || (/^(?:usa|united states|us)$/i.test(profile.country || "") ? "United States" : profile.country || "");
  if (key === "fullName") return profile.fullName || [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ");
  if (key === "middleName" && [profile.firstName, profile.lastName].some((name) => String(name || "").toLowerCase() === String(profile.middleName || "").toLowerCase())) return "";
  return profile[key];
}

function valueForApplicationKey(profile, key) {
  if (!String(key).includes(":")) return valueForProfileKey(profile, key);
  const [section, indexText, field] = String(key).split(":");
  const index = Number(indexText);
  const details = profile.__resumeDetails || {};
  const collections = { education: "educationEntries", work: "experienceEntries", certification: "certificationEntries", language: "languageEntries" };
  const entry = details[collections[section]]?.[index] || {};
  const fields = {
    education: { school: "school", degree: "degree", major: "major", start: "startDate", end: "endDate" },
    work: { company: "company", title: "title", location: "location", current: "isCurrent", start: "startDate", end: "endDate", description: "description" },
    certification: { name: "name", issuer: "issuer", number: "credentialId", date: "date", expiration: "expirationDate" },
    language: { language: "language", fluent: "fluent", overall: "overall", reading: "reading", speaking: "speaking", writing: "writing" }
  };
  return entry[fields[section]?.[field]];
}

function applicationChoices(profile) {
  const basicKeys = ["fullName", "firstName", "preferredName", "middleName", "lastName", "email", "phoneCountryCode", "phoneCountryName", "phone", "streetAddress", "addressLine2", "city", "state", "postalCode", "country", "linkedin", "portfolio", "github", "currentCompany", "currentTitle", "yearsExperience", "desiredTitle", "employmentType", "desiredSalary", "noticePeriod", "remotePreference", "travel", "school", "degree", "major", "graduationYear", "professionalSummary", "skills", "workAuthorization", "sponsorship", "relocate", "workStatus", "visaStatus", "source", "startDate", "referralCode", "coverLetterNotes"];
  const choices = basicKeys.flatMap((key) => {
    const value = valueForProfileKey(profile, key);
    return value === "" || value === undefined || value === null || value === false ? [] : [{ key, value, description: key, tags: SEARCH_TAGS[key] || key }];
  });
  const details = profile.__resumeDetails || {};
  const addEntries = (section, entries, fields, heading) => {
    for (const [index, entry] of (entries || []).entries()) {
      const identity = entry[heading] || `${section} ${index + 1}`;
      for (const [field, property] of Object.entries(fields)) {
        const value = entry[property];
        if (value === "" || value === undefined || value === null || value === false) continue;
        choices.push({ key: `${section}:${index}:${field}`, value, description: `${section} ${index + 1} (${identity}) ${field}`, tags: SEARCH_TAGS[field] || field });
      }
    }
  };
  addEntries("education", details.educationEntries, { school: "school", degree: "degree", major: "major", start: "startDate", end: "endDate" }, "school");
  addEntries("work", details.experienceEntries, { company: "company", title: "title", location: "location", current: "isCurrent", start: "startDate", end: "endDate", description: "description" }, "company");
  addEntries("certification", details.certificationEntries, { name: "name", issuer: "issuer", number: "credentialId", date: "date", expiration: "expirationDate" }, "name");
  addEntries("language", details.languageEntries, { language: "language", fluent: "fluent", overall: "overall", reading: "reading", speaking: "speaking", writing: "writing" }, "language");
  return choices;
}

async function improveMatchesWithLocalAi(profile, onProgress = () => {}) {
  const startedAt = performance.now();
  const { ollamaModel } = await chrome.storage.local.get("ollamaModel");
  if (!ollamaModel) throw new Error("No Ollama model is selected. Open Profile Manager, detect models, then choose one.");
  const existing = new Map(pendingMatches.map((match) => [`${match.frameId}:${match.index}`, match]));
  const choices = applicationChoices(profile);
  const normalizedText = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const fields = scannedFields.filter((field) => {
    const match = existing.get(`${field.frameId}:${field.index}`);
    return !match || String(match.key).includes(":");
  }).slice(0, 80);
  const fieldWords = normalizedText(fields.map((field) => `${field.label} ${field.autocomplete} ${field.options?.slice(0, 8).join(" ")}`).join(" "));
  const likelyChoices = choices.filter((choice) => {
    const haystack = normalizedText(`${choice.key} ${choice.description} ${choice.tags}`);
    return haystack.split(" ").some((word) => word.length > 2 && fieldWords.includes(word));
  });
  const compactChoices = (likelyChoices.length >= 8 ? likelyChoices : choices).slice(0, 120);
  const availableKeys = compactChoices.map((choice) => choice.key);
  if (!fields.length || !availableKeys.length) return [];
  onProgress(`Prepared ${fields.length} field(s) and ${availableKeys.length} possible profile key(s) in ${((performance.now() - startedAt) / 1000).toFixed(1)}s. Asking local AI...`);
  const schema = {
    type: "object",
    properties: {
      mappings: {
        type: "array",
        items: {
          type: "object",
          properties: { fieldId: { type: "string" }, key: { type: "string", enum: availableKeys }, confidence: { type: "number" } },
          required: ["fieldId", "key", "confidence"]
        }
      }
    },
    required: ["mappings"]
  };
  const prompt = [
    "/no_think",
    "Classify visible job application form fields. Return compact JSON only.",
    "Map each fieldId to one allowed key only when the label clearly asks for that profile value.",
    "Use the exact fieldId and key strings provided. Skip uncertain, demographic, voluntary disclosure, password, file upload, and free-response questions.",
    "For repeated education, work, certification, or language cards, preserve the visible card order. Map fields in the same visible card to the same numbered choice. Skip a repeated field when the entry number is uncertain.",
    "A phone country code, calling code, or dial code field maps to phoneCountryCode, not country. A country or country/region field maps to country.",
    "A field labeled First Name, Given Name, first_name, or autocomplete given-name must map to firstName, never fullName.",
    "A field labeled Last Name, Family Name, Surname, last_name, or autocomplete family-name must map to lastName, never fullName.",
    "Map to fullName only when the label explicitly asks for Full Name, Legal Name, Applicant Name, Candidate Name, or a single combined Name field.",
    "Only map middleName when the label explicitly asks for middle name or additional name.",
    "Use confidence 0.9 or higher only when the label and options clearly match a profile key. Do not invent fields.",
    `Allowed keys: ${JSON.stringify(compactChoices.map(({ key, description, tags }) => ({ key, description, tags: String(tags).slice(0, 120) })))}`,
    `Fields: ${JSON.stringify(fields.map(({ frameId, index, label, tag, type, role, controlKind, autocomplete, blank, options }) => ({ fieldId: `${frameId}:${index}`, label: String(label).slice(0, 260), tag, type, role, controlKind, autocomplete, blank, options: (options || []).slice(0, 12) })))}`
  ].join("\n\n");
  const requestAt = performance.now();
  const result = await ollamaRequest("chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ollamaModel, stream: false, format: schema, messages: [{ role: "user", content: prompt }], options: { temperature: 0, num_ctx: 4096 } })
  });
  onProgress(`Local AI responded in ${((performance.now() - requestAt) / 1000).toFixed(1)}s. Parsing results...`);
  const parsed = JSON.parse(result.message?.content || "{}");
  const byFieldId = new Map(fields.map((field) => [`${field.frameId}:${field.index}`, field]));
  return (parsed.mappings || []).flatMap((mapping) => {
    const field = byFieldId.get(mapping.fieldId);
    const value = valueForApplicationKey(profile, mapping.key);
    if (!field || !availableKeys.includes(mapping.key) || Number(mapping.confidence) < 0.9 || value === "" || value === undefined || value === null) return [];
    const requiresManual = /combobox|custom-select|autocomplete/.test(field.controlKind || "") || (field.tag === "button" && field.role !== "textbox");
    return [{ frameId: field.frameId, index: field.index, key: mapping.key, label: field.label || mapping.key, value, displayValue: String(value), requiresManual, confidence: Number(mapping.confidence) }];
  });
}

function visualScanSchema(availableKeys, fieldIds) {
  return {
    name: "visual_application_field_scan",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        mappings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              fieldId: { type: "string", enum: fieldIds },
              key: { type: "string", enum: availableKeys },
              confidence: { type: "number" },
              reason: { type: "string" }
            },
            required: ["fieldId", "key", "confidence", "reason"]
          }
        },
        notes: { type: "array", items: { type: "string" } }
      },
      required: ["mappings", "notes"]
    }
  };
}

async function activePageTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) throw new Error("Open a job application page first.");
  return tab;
}

async function improveMatchesWithVisionAi(profile, onProgress = () => {}) {
  const existing = new Map(pendingMatches.map((match) => [`${match.frameId}:${match.index}`, match]));
  const choices = applicationChoices(profile);
  const fields = scannedFields
    .filter((field) => field.blank !== false)
    .slice(0, 110);
  const availableKeys = choices.map((choice) => choice.key).slice(0, 160);
  const fieldIds = fields.map((field) => `${field.frameId}:${field.index}`);
  if (!fields.length || !availableKeys.length) return [];
  const settings = await getAiSettings();
  if ((settings.aiProvider || "local") === "cloud" && settings.confirmCloudAi && !confirm("AI vision sends screenshots of this application page to OpenAI. Continue?")) return [];
  const tab = await activePageTab();
  onProgress("Capturing page views for AI vision...");
  const imageDataUrls = await capturePageScreenshots(tab, {
    mode: "long",
    maxScreenshots: 8,
    startAtTop: true,
    stitch: true,
    onProgress
  });
  const visibleFallback = imageDataUrls.captureMode === "visible-fallback";
  const choicePayload = choices.slice(0, 160).map(({ key, description, tags }) => ({
    key,
    description,
    tags: String(tags || "").slice(0, 180)
  }));
  const fieldPayload = fields.map((field) => ({
    fieldId: `${field.frameId}:${field.index}`,
    label: String(field.label || "").slice(0, 280),
    tag: field.tag || "",
    type: field.type || "",
    role: field.role || "",
    controlKind: field.controlKind || "",
    autocomplete: field.autocomplete || "",
    options: (field.options || []).slice(0, 16)
  }));
  const system = [
    "You map visible job application fields to candidate profile keys.",
    "Use the screenshots as visual context and the DOM field list for exact field IDs.",
    "Return a mapping only when the field label and visual location clearly ask for that profile value.",
    "Skip file uploads, passwords, voluntary demographic questions, and uncertain fields.",
    "For repeated education, work, certification, and language sections, preserve the visible card order and use the same numbered entry within the same card.",
    "First Name or given-name must be firstName, Last Name or family-name must be lastName. Use fullName only for a single combined name field.",
    "Phone country/calling/dial code maps to phoneCountryCode or phoneCountryName, not country. Address country maps to country.",
    "Do not invent missing fields. Return JSON only."
  ].join(" ");
  const user = [
    "Map fields to allowed profile keys.",
    `Allowed profile keys:\n${JSON.stringify(choicePayload)}`,
    `DOM fields:\n${JSON.stringify(fieldPayload)}`,
    "Use confidence 0.9+ only for clear matches. Use 0.86-0.89 for likely matches that need human review."
  ].join("\n\n");
  onProgress(visibleFallback ? "Reading the visible screenshot with AI vision because this page blocked long screenshot access..." : "Reading the long page screenshot with AI vision...");
  const result = await runVisionJsonAi({
    system,
    user,
    imageDataUrls,
    schema: visualScanSchema(availableKeys, fieldIds),
    preferProvider: ""
  });
  const byFieldId = new Map(fields.map((field) => [`${field.frameId}:${field.index}`, field]));
  return (result.mappings || []).flatMap((mapping) => {
    const field = byFieldId.get(mapping.fieldId);
    const key = mapping.key;
    const value = valueForApplicationKey(profile, key);
    const confidence = Number(mapping.confidence || 0);
    if (!field || !availableKeys.includes(key) || confidence < 0.86 || value === "" || value === undefined || value === null || value === false) return [];
    const existingMatch = existing.get(`${field.frameId}:${field.index}`);
    if (existingMatch && Number(existingMatch.confidence || 0) >= confidence) return [];
    const requiresManual = /combobox|custom-select|autocomplete/.test(field.controlKind || "") || (field.tag === "button" && field.role !== "textbox");
    return [{
      frameId: field.frameId,
      index: field.index,
      key,
      label: field.label || key,
      value,
      displayValue: String(value),
      requiresManual,
      confidence,
      aiVision: true,
      reason: mapping.reason || ""
    }];
  });
}

async function pageAction(action, profile, approvedMatches = [], guidedTyping = false, blankOnly = false) {
  const normalized = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const phoneCountryCode = String(profile.phone || "").match(/^\s*(\+\d{1,3})\b/)?.[1] || (/^(?:usa|united states|us)$/i.test(profile.country || "") ? "+1" : "");
  const phoneCountryName = profile.phoneCountryName || (/^(?:usa|united states|us)$/i.test(profile.country || "") ? "United States" : profile.country || "");
  const middleName = [profile.firstName, profile.lastName].some((name) => normalized(name) === normalized(profile.middleName)) ? "" : profile.middleName;
  const phoneCountryValueFor = (element) => {
    const optionText = element instanceof HTMLSelectElement ? [...element.options].map((option) => normalized(`${option.text} ${option.value}`)).join(" ") : "";
    if (/united states/.test(optionText)) return "United States";
    if (/\busa\b|\bus\b/.test(optionText)) return "USA";
    return phoneCountryCode;
  };
  const profileValue = (key, element = null) => key === "phoneCountryCode" ? (element ? phoneCountryValueFor(element) : phoneCountryCode) : key === "phoneCountryName" ? phoneCountryName : key === "fullName" ? (profile.fullName || [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")) : key === "middleName" ? middleName : profile[key];
  const autocompleteRules = { name: "fullName", "given-name": "firstName", "additional-name": "middleName", "family-name": "lastName", email: "email", tel: "phone", "tel-country-code": "phoneCountryCode", "street-address": "streetAddress", "address-line1": "streetAddress", "address-line2": "addressLine2", "address-level2": "city", "address-level1": "state", "postal-code": "postalCode", country: "country", "country-name": "country" };
  const rules = [
    ["fullName", ["full name", "legal name", "applicant name", "candidate name", "complete name", "display name", "your name", "name as it appears", "name on resume"]], ["firstName", ["first name", "given name", "firstname", "fname", "forename", "legal first name"]], ["preferredName", ["preferred name", "nickname", "preferred first name", "goes by", "chosen name"]], ["middleName", ["middle name", "additional name", "middlename", "middle initial"]], ["lastName", ["last name", "family name", "surname", "lastname", "lname", "legal last name"]],
    ["email", ["email", "email address", "e mail", "contact email", "primary email", "personal email"]], ["phoneCountryCode", ["phone country code", "country calling code", "calling code", "dialing code", "dial code", "telephone country code", "mobile country code"]], ["phoneCountryName", ["phone country", "telephone country", "calling country"]], ["phone", ["phone", "phone number", "mobile", "mobile phone", "telephone", "tel", "cell", "cellphone", "contact number", "primary phone", "primary phone number"]],
    ["streetAddress", ["street address", "address line 1", "address1", "mailing address", "home address", "current address", "residential address"]], ["addressLine2", ["address line 2", "address2", "apartment", "apt", "suite", "unit", "building", "floor", "room"]], ["city", ["city", "town", "municipality", "locality"]], ["state", ["state", "province", "region", "address level1", "administrative area"]],
    ["postalCode", ["zip", "zip code", "postal code", "postcode", "zipcode"]], ["country", ["country", "country region", "nation", "residence country", "country of residence"]], ["linkedin", ["linkedin", "linkedin url", "linkedin profile", "linkedin link", "linkedin profile url"]],
    ["portfolio", ["portfolio", "portfolio url", "personal website", "website", "personal site", "online portfolio", "homepage"]], ["github", ["github", "github url", "github profile", "github link", "code repository"]],
    ["currentCompany", ["current company", "current employer", "most recent employer", "present company", "current organization"]], ["currentTitle", ["current title", "job title", "current position", "most recent title", "position title", "current role", "present role"]],
    ["yearsExperience", ["years of experience", "total years experience", "experience years", "years professional experience", "total experience", "relevant experience", "professional experience years"]], ["desiredTitle", ["desired job title", "desired title", "target role", "target position", "position applying for", "preferred role", "desired position", "role interested in"]], ["employmentType", ["employment type", "job type", "full time", "full time role", "part time", "contract", "internship", "temporary", "permanent", "work type"]], ["desiredSalary", ["desired salary", "salary expectation", "salary expectations", "compensation", "expected pay", "pay expectation", "expected compensation", "salary requirements", "target salary", "desired compensation"]], ["noticePeriod", ["notice period", "notice", "availability", "available after"]], ["remotePreference", ["remote preference", "work arrangement", "remote", "hybrid", "onsite", "on site", "workplace preference"]], ["school", ["school", "university", "college", "institution", "educational institution", "academic institution", "institution name"]],
    ["degree", ["degree", "degree type", "education level", "diploma", "qualification", "credential", "award level"]], ["major", ["major", "field of study", "discipline", "concentration", "program", "area of study", "course of study", "specialization"]],
    ["graduationYear", ["graduation year", "graduation date", "year graduated", "completion year", "expected graduation", "grad year"]], ["professionalSummary", ["professional summary", "summary", "profile summary", "about me", "bio", "biography", "candidate summary", "personal summary"]],
    ["skills", ["skills", "technical skills", "tools", "technologies", "competencies", "qualifications", "expertise", "abilities", "software tools", "platforms"]], ["workAuthorization", ["authorized to work", "legally authorized", "work authorization", "employment authorization", "eligible to work", "right to work", "employment eligibility", "authorized to work in the united states", "authorized to work in us", "work permit"]],
    ["sponsorship", ["require sponsorship", "need sponsorship", "visa sponsorship", "immigration sponsorship", "work visa sponsorship", "future sponsorship", "now or in the future", "require sponsorship now or in the future", "need visa sponsorship now or in the future"]], ["relocate", ["willing to relocate", "relocation", "relocate", "open to relocate"]], ["travel", ["willing to travel", "travel", "travel requirement", "travel availability"]],
    ["workStatus", ["citizenship", "work status", "employment status", "authorization status", "legal status", "work eligibility", "citizenship status"]], ["visaStatus", ["visa status", "immigration status", "visa type", "current visa", "opt", "cpt", "stem opt", "f1", "f 1"]], ["source", ["source", "how did you hear", "where did you hear", "heard about us", "job source", "referral channel"]],
    ["startDate", ["start date", "available start date", "earliest start date", "availability date", "when can you start", "start work date", "available from"]], ["referralCode", ["referral code", "employee referral code", "referrer code", "referral id", "referral name", "referred by"]], ["coverLetterNotes", ["cover letter", "additional information", "notes", "motivation", "message", "comments", "why interested", "open ended response"]]
  ];
  const details = profile.__resumeDetails || {};
  const counters = new Map();
  const nextEntry = (section, field, entries) => {
    const counterKey = `${section}:${field}`;
    const index = counters.get(counterKey) || 0;
    counters.set(counterKey, index + 1);
    return { index, entry: entries[index] || {} };
  };
  const entryContainers = new Map();
  const entryContainerIndexes = new Map();
  const explicitEntryIndex = (element, section) => {
    const aliases = {
      work: "(?:work|employment|professional)\\s*(?:experience|history)?",
      education: "(?:education|school)",
      certification: "(?:license|certificate|certification)",
      language: "(?:language)"
    }[section];
    if (!aliases) return -1;
    let current = element.parentElement;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const text = current.innerText || "";
      const patterns = [
        new RegExp(`${aliases}\\s*(?:#|number|no\\.?|entry)?\\s*(\\d{1,2})`, "i"),
        new RegExp(`(\\d{1,2})\\s*${aliases}`, "i")
      ];
      for (const pattern of patterns) {
        const match = text.match(pattern);
        const index = Number(match?.[1] || 0) - 1;
        if (index >= 0 && index < 20) return index;
      }
    }
    return -1;
  };
  const editableSelector = [
    "input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset])",
    "select",
    "textarea",
    "[contenteditable=true]",
    "[role=textbox]",
    "[role=combobox]",
    "[role=spinbutton]",
    "button[aria-haspopup]",
    "button[aria-controls]",
    "[role=button][aria-haspopup]",
    "[data-automation-id*=select]",
    "[data-testid*=select]",
    "[data-test*=select]",
    "[data-test-id*=select]",
    "[data-qa*=select]",
    "[data-testid*=input]",
    "[data-test*=input]",
    "[data-test-id*=input]",
    "[data-qa*=input]",
    "[data-testid*=field]",
    "[data-test*=field]",
    "[data-test-id*=field]",
    "[data-qa*=field]"
  ].join(", ");
  const writableSelector = [
    "input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset])",
    "select",
    "textarea",
    "[contenteditable=true]",
    "[role=textbox]",
    "[role=combobox]",
    "[role=spinbutton]"
  ].join(", ");
  const fieldSelector = editableSelector;
  const entryContainerFor = (element, section) => {
    if (!["work", "education", "certification", "language"].includes(section)) return null;
    const markers = {
      work: ["job title", "title", "position", "company", "employer", "legal employer", "employer city", "location", "responsibilities", "job duties", "achievements", "accomplishments", "start date", "end date"],
      education: ["school", "university", "degree", "major", "field of study", "start date", "end date"],
      certification: ["license", "certificate", "certification", "issued by", "issue date", "expiration date"],
      language: ["language", "fluent", "reading", "speaking", "writing"]
    }[section];
    const primaryMarker = {
      work: /job title|\btitle\b|\bposition\b|legal employer|\bemployer\b|company/,
      education: /school|university/,
      certification: /license or certificate|certification/,
      language: /\blanguage\b/
    }[section];
    let current = element.parentElement;
    for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
      const text = normalized(current.innerText);
      const fields = [...current.querySelectorAll(fieldSelector)];
      const fieldCount = fields.length;
      const markerCount = markers.filter((marker) => text.includes(marker)).length;
      const primaryFields = fields.filter((field) => primaryMarker.test(normalized([field.getAttribute("aria-label"), field.getAttribute("placeholder"), field.name, field.id, field.closest("label")?.innerText].filter(Boolean).join(" ")))).length;
      if (fieldCount >= 2 && fieldCount <= 30 && markerCount >= 2 && primaryFields === 1) return current;
    }
    return null;
  };
  const entryFor = (section, field, entries, element) => {
    const explicitIndex = explicitEntryIndex(element, section);
    if (explicitIndex >= 0) return { index: explicitIndex, entry: entries[explicitIndex] || {} };
    const container = entryContainerFor(element, section);
    if (!container) return entries.length <= 1 ? nextEntry(section, field, entries) : { index: -1, entry: {} };
    if (!entryContainers.has(section)) entryContainers.set(section, new WeakMap());
    const sectionContainers = entryContainers.get(section);
    if (!sectionContainers.has(container)) {
      const index = entryContainerIndexes.get(section) || 0;
      sectionContainers.set(container, index);
      entryContainerIndexes.set(section, index + 1);
    }
    const index = sectionContainers.get(container);
    return { index, entry: entries[index] || {} };
  };
  const datePartFor = (element) => {
    const hint = normalized([element.getAttribute("aria-label"), element.getAttribute("placeholder"), element.name, element.id, element.closest("label")?.innerText].filter(Boolean).join(" "));
    if (/\bday\b/.test(hint)) return "day";
    if (/\bmonth\b/.test(hint)) return "month";
    if (/\byear\b/.test(hint)) return "year";
    return "monthYear";
  };
  const nextDateEntry = (section, field, entries, element) => entryFor(section, `${field}:${datePartFor(element)}`, entries, element);
  const sectionFor = (element) => {
    const sections = [["certification", "licenses and certificates"], ["certification", "license or certificate"], ["work", "work experience"], ["work", "experience"], ["education", "education"], ["certification", "certification"], ["language", "language"]];
    let current = element.parentElement;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const text = normalized(current.innerText);
      const matches = sections.filter(([, phrase]) => text.includes(phrase));
      const sectionNames = [...new Set(matches.map(([section]) => section))];
      if (sectionNames.length === 1) return sectionNames[0];
    }
    return "";
  };
  const fieldTextFor = (element) => normalized([
    element.getAttribute("data-automation-id"),
    element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.innerText : "",
    element.getAttribute("aria-label"),
    element.getAttribute("aria-description"),
    textFromIds(element.getAttribute("aria-labelledby")),
    textFromIds(element.getAttribute("aria-describedby")),
    element.name,
    element.id,
    element.getAttribute("placeholder"),
    element.closest("label")?.innerText,
    element.getAttribute("data-testid"),
    element.getAttribute("data-test"),
    element.getAttribute("data-test-id"),
    element.getAttribute("data-qa")
  ].filter(Boolean).join(" "));
  const monthYear = (value) => {
    const match = String(value || "").match(/\b((?:19|20)\d{2})[-/](\d{1,2})\b/);
    return match ? `${match[2].padStart(2, "0")}/${match[1]}` : value || "";
  };
  const parseDate = (value) => {
    const text = String(value || "").trim();
    const numeric = text.match(/\b((?:19|20)\d{2})[-/](\d{1,2})(?:[-/](\d{1,2}))?/) || text.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/]((?:19|20)\d{2}))?/);
    if (numeric?.[1]?.length === 4) return { year: numeric[1], month: String(numeric[2]).padStart(2, "0"), day: numeric[3] ? String(numeric[3]).padStart(2, "0") : "" };
    if (numeric) return { month: String(numeric[1]).padStart(2, "0"), day: String(numeric[2]).padStart(2, "0"), year: numeric[3] || "" };
    const months = { jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03", apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07", aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12" };
    const named = text.toLowerCase().match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[\s.,-]*(\d{1,2})(?:st|nd|rd|th)?(?:[\s,.-]+((?:19|20)\d{2}))?/);
    if (named) return { month: months[named[1]], day: String(named[2]).padStart(2, "0"), year: named[3] || "" };
    const yearOnly = text.match(/\b((?:19|20)\d{2})\b/);
    return yearOnly ? { year: yearOnly[1], month: "", day: "" } : {};
  };
  const dateComponent = (element, value, fallback = "monthYear") => {
    const parts = parseDate(value);
    if (!parts.year && !parts.month && !parts.day) return "";
    const part = datePartFor(element);
    if (part === "day") return parts.day || "";
    if (part === "month") return parts.month || "";
    if (part === "year") return parts.year || "";
    if (fallback === "year") return parts.year || "";
    if (parts.month && parts.day && parts.year) return `${parts.month}/${parts.day}/${parts.year}`;
    if (parts.month && parts.day) return `${parts.month}/${parts.day}`;
    if (parts.month && parts.year) return `${parts.month}/${parts.year}`;
    return parts.year || monthYear(value);
  };
  const applicationValueForKey = (element, key) => {
    if (!String(key).includes(":")) return profileValue(key, element);
    const [section, indexText, field] = String(key).split(":");
    const index = Number(indexText);
    const collections = { education: "educationEntries", work: "experienceEntries", certification: "certificationEntries", language: "languageEntries" };
    const entry = details[collections[section]]?.[index] || {};
    const fields = {
      education: { school: "school", degree: "degree", major: "major", start: "startDate", end: "endDate" },
      work: { company: "company", title: "title", location: "location", current: "isCurrent", start: "startDate", end: "endDate", description: "description" },
      certification: { name: "name", issuer: "issuer", number: "credentialId", date: "date", expiration: "expirationDate" },
      language: { language: "language", fluent: "fluent", overall: "overall", reading: "reading", speaking: "speaking", writing: "writing" }
    };
    const value = entry[fields[section]?.[field]];
    return ["start", "end", "date", "expiration"].includes(field) ? dateComponent(element, value, section === "education" ? "year" : "monthYear") : value;
  };
  const structuredValue = (element) => {
    const section = sectionFor(element);
    const text = fieldTextFor(element);
    if (section === "work") {
      const entries = details.experienceEntries || [];
      if (/\bjob title\b|jobtitle|\bposition\b|\btitle\b|\brole\b/.test(text)) { const { index, entry } = entryFor(section, "title", entries, element); return { key: `work:${index}:title`, value: entry.title }; }
      if (/legal employer name|\bcompany\b|\bemployer\b|organization name|\borganization\b/.test(text)) { const { index, entry } = entryFor(section, "company", entries, element); return { key: `work:${index}:company`, value: entry.company }; }
      if (/employer city|\blocation\b|work location|job location|office location|\bcity\b/.test(text)) { const { index, entry } = entryFor(section, "location", entries, element); return { key: `work:${index}:location`, value: entry.location }; }
      if (/current job|currently work|currentwork|currentlywork/.test(text)) { const { index, entry } = entryFor(section, "current", entries, element); return { key: `work:${index}:current`, value: Boolean(entry.isCurrent) }; }
      if (/\bfrom\b|startdate|start date|\bstart\b|started|begin date|beginning date/.test(text)) { const { index, entry } = nextDateEntry(section, "start", entries, element); return { key: `work:${index}:start`, value: dateComponent(element, entry.startDate) }; }
      if (/\bto\b|enddate|end date|\bend\b|ended|finish date|through|until/.test(text)) { const { index, entry } = nextDateEntry(section, "end", entries, element); return { key: `work:${index}:end`, value: dateComponent(element, entry.endDate) }; }
      if (/responsibilities|role description|description|job duties|duties|tasks|achievements?|accomplishments?|contributions?|impact|results/.test(text)) { const { index, entry } = entryFor(section, "description", entries, element); return { key: `work:${index}:description`, value: entry.description }; }
    }
    if (section === "education") {
      const entries = details.educationEntries || [];
      if (/school|university/.test(text)) { const { index, entry } = entryFor(section, "school", entries, element); return { key: `education:${index}:school`, value: entry.school }; }
      if (/\bdegree\b/.test(text)) { const { index, entry } = entryFor(section, "degree", entries, element); return { key: `education:${index}:degree`, value: entry.degree }; }
      if (/field of study|major/.test(text)) { const { index, entry } = entryFor(section, "major", entries, element); return { key: `education:${index}:major`, value: entry.major }; }
      if (/\bfrom\b|startdate|start date/.test(text)) { const { index, entry } = nextDateEntry(section, "start", entries, element); return { key: `education:${index}:start`, value: dateComponent(element, entry.startDate, "year") }; }
      if (/\bto\b|enddate|end date/.test(text)) { const { index, entry } = nextDateEntry(section, "end", entries, element); return { key: `education:${index}:end`, value: dateComponent(element, entry.endDate, "year") }; }
    }
    if (section === "certification") {
      const entries = details.certificationEntries || [];
      if (/certificate number|certification number|credential id|credentialid/.test(text)) { const { index, entry } = entryFor(section, "number", entries, element); return { key: `certification:${index}:number`, value: entry.credentialId }; }
      if (/issued by/.test(text)) { const { index, entry } = entryFor(section, "issuer", entries, element); return { key: `certification:${index}:issuer`, value: entry.issuer }; }
      if (/license or certificate|\bcertification\b/.test(text)) { const { index, entry } = entryFor(section, "name", entries, element); return { key: `certification:${index}:name`, value: entry.name }; }
      if (/issued date|issue date/.test(text)) { const { index, entry } = nextDateEntry(section, "date", entries, element); return { key: `certification:${index}:date`, value: dateComponent(element, entry.date) }; }
      if (/expiration date|expiry date/.test(text)) { const { index, entry } = nextDateEntry(section, "expiration", entries, element); return { key: `certification:${index}:expiration`, value: dateComponent(element, entry.expirationDate) }; }
    }
    if (section === "language") {
      const entries = details.languageEntries || [];
      if (/fluent/.test(text)) { const { index, entry } = entryFor(section, "fluent", entries, element); return { key: `language:${index}:fluent`, value: Boolean(entry.fluent) }; }
      if (/comprehension|overall/.test(text)) { const { index, entry } = entryFor(section, "overall", entries, element); return { key: `language:${index}:overall`, value: entry.overall }; }
      if (/reading/.test(text)) { const { index, entry } = entryFor(section, "reading", entries, element); return { key: `language:${index}:reading`, value: entry.reading }; }
      if (/speaking/.test(text)) { const { index, entry } = entryFor(section, "speaking", entries, element); return { key: `language:${index}:speaking`, value: entry.speaking }; }
      if (/writing/.test(text)) { const { index, entry } = entryFor(section, "writing", entries, element); return { key: `language:${index}:writing`, value: entry.writing }; }
      if (/^language\b|\blanguage name\b/.test(text)) { const { index, entry } = entryFor(section, "language", entries, element); return { key: `language:${index}:language`, value: entry.language }; }
    }
    return null;
  };
  const textFromIds = (ids) => String(ids || "").split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
  const shortText = (value, limit = 180) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text && text.length <= limit ? text : "";
  };
  const labelForId = (element) => element.id ? shortText(document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.innerText, 160) : "";
  const ownLabelFor = (element) => {
    const wrappingLabel = element.closest("label");
    const wrappingText = wrappingLabel ? shortText(wrappingLabel.innerText || wrappingLabel.textContent, 180) : "";
    return normalized([
      labelForId(element),
      wrappingText,
      element.getAttribute("aria-label"),
      element.getAttribute("aria-placeholder"),
      element.getAttribute("aria-description"),
      element.getAttribute("title"),
      textFromIds(element.getAttribute("aria-labelledby")),
      textFromIds(element.getAttribute("aria-describedby")),
      element.getAttribute("placeholder"),
      element.name,
      element.id,
      element.autocomplete === "off" ? "" : element.autocomplete,
      element.getAttribute("data-automation-id"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.getAttribute("data-test-id"),
      element.getAttribute("data-qa")
    ].filter(Boolean).join(" "));
  };
  const nearbyTextFor = (element) => {
    const pieces = [];
    const rect = element.getBoundingClientRect();
    const fieldCenterY = rect.top + rect.height / 2;
    let sibling = element.previousElementSibling;
    for (let count = 0; sibling && count < 4; count += 1, sibling = sibling.previousElementSibling) {
      const text = shortText(sibling.innerText || sibling.textContent, 220);
      if (text) pieces.push(text);
    }
    let current = element.parentElement;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const text = shortText(current.innerText, depth < 2 ? 360 : 240);
      if (text) pieces.push(text);
      const labelish = [...current.querySelectorAll("label, legend, [role=label], [data-automation-id*=label], [data-testid*=label], [data-test*=label], .label, .field-label, .form-label")].slice(0, 8);
      for (const item of labelish) {
        const labelText = shortText(item.innerText || item.textContent, 180);
        if (labelText) pieces.push(labelText);
      }
    }
    const nearby = [...document.querySelectorAll("label, legend, p, span, div, strong")].filter((node) => {
      if (node === element || element.contains(node) || node.contains(element)) return false;
      const text = shortText(node.innerText || node.textContent, 120);
      if (!text) return false;
      const nodeRect = node.getBoundingClientRect();
      if (!nodeRect.width || !nodeRect.height) return false;
      const closeAbove = nodeRect.bottom <= rect.top + 8 && rect.top - nodeRect.bottom <= 90 && Math.abs(nodeRect.left - rect.left) <= Math.max(280, rect.width + 80);
      const closeLeft = nodeRect.right <= rect.left + 8 && rect.left - nodeRect.right <= 180 && Math.abs((nodeRect.top + nodeRect.height / 2) - fieldCenterY) <= 45;
      return closeAbove || closeLeft;
    }).slice(0, 6);
    for (const node of nearby) {
      const text = shortText(node.innerText || node.textContent, 120);
      if (text) pieces.push(text);
    }
    return [...new Set(pieces)].join(" ");
  };
  const displayTextFor = (element) => {
    const own = ownLabelFor(element);
    if (/^(?:type here\s*)?systemfield\s+\w+$/.test(own)) {
      const context = nearbyTextFor(element);
      const nearby = normalized(context).slice(0, 180);
      if (nearby) return nearby;
    }
    if (own) return own;
    const context = nearbyTextFor(element);
    return normalized(context).slice(0, 180);
  };
  const systemFieldKeyFor = (element) => {
    const systemText = normalized([element.name, element.id, element.getAttribute("data-automation-id"), element.getAttribute("data-testid"), element.getAttribute("data-test"), element.getAttribute("data-test-id"), element.getAttribute("data-qa")].filter(Boolean).join(" "));
    if (!/\bsystemfield\b/.test(systemText)) return null;
    if (/\bfirst\b|\bgiven\b/.test(systemText)) return profileValue("firstName") ? "firstName" : null;
    if (/\blast\b|\bfamily\b|\bsurname\b/.test(systemText)) return profileValue("lastName") ? "lastName" : null;
    if (/\bmiddle\b|\badditional\b/.test(systemText)) return middleName ? "middleName" : null;
    if (/\bemail\b|e mail/.test(systemText)) return profileValue("email") ? "email" : null;
    if (/\bphone\b|\btel\b|\bmobile\b/.test(systemText)) return profileValue("phone") ? "phone" : null;
    if (/\blinkedin\b/.test(systemText)) return profileValue("linkedin") ? "linkedin" : null;
    if (/\bwebsite\b|\bportfolio\b/.test(systemText)) return profileValue("portfolio") ? "portfolio" : null;
    if (/\bgithub\b/.test(systemText)) return profileValue("github") ? "github" : null;
    if (/\bname\b/.test(systemText)) return profileValue("fullName") ? "fullName" : null;
    return null;
  };
  const textFor = (element) => {
    try {
      return ownLabelFor(element);
    } catch {
      return normalized([element.getAttribute("aria-label"), element.getAttribute("placeholder"), element.name, element.id, element.getAttribute("autocomplete")].filter(Boolean).join(" "));
    }
  };
  const localFieldTextFor = (element) => {
    const pieces = [textFor(element)];
    let current = element.parentElement;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      const fields = [...current.querySelectorAll(editableSelector)].filter((field) => field !== element && !field.disabled && !field.readOnly);
      const radioGroup = element instanceof HTMLInputElement && ["radio", "checkbox"].includes(String(element.type || "").toLowerCase());
      if (fields.length <= (radioGroup ? 4 : 1)) {
        const text = shortText(current.innerText || current.textContent, radioGroup ? 360 : 220);
        if (text) pieces.push(text);
      }
    }
    return normalized([...new Set(pieces.filter(Boolean))].join(" "));
  };
  const identify = (element) => {
    const systemKey = systemFieldKeyFor(element);
    if (systemKey) return systemKey;
    const directText = textFor(element);
    const localText = localFieldTextFor(element);
    const text = localText || directText;
    if (!text) return null;
    if (/first name|given name|firstname|\bfname\b|^first\b|_first|first_/.test(text)) return profileValue("firstName") ? "firstName" : null;
    if (/last name|family name|surname|lastname|\blname\b|^last\b|_last|last_/.test(text)) return profileValue("lastName") ? "lastName" : null;
    if (/middle name|additional name|middlename/.test(text)) return middleName ? "middleName" : null;
    if (/preferred name|nickname|preferred first name/.test(text)) return profileValue("preferredName") ? "preferredName" : null;
    const autocomplete = normalized(element.getAttribute("autocomplete")).split(" ").at(-1);
    const autocompleteKey = autocompleteRules[autocomplete];
    if (autocompleteKey && autocompleteKey !== "fullName") return profileValue(autocompleteKey) ? autocompleteKey : null;
    if (autocompleteKey === "fullName" && /full name|legal name|applicant name|candidate name|^name$/.test(text)) return profileValue("fullName") ? "fullName" : null;
    if (/country code|calling code|dialing code|dial code/.test(text)) return phoneCountryCode ? "phoneCountryCode" : null;
    if (/employer phone/.test(text)) return null;
    if (/\blink\b|\burl\b|website/.test(text) && !/linkedin|github|portfolio|personal website/.test(text)) return null;
    for (const [key, aliases] of rules) if (profileValue(key) && aliases.some((alias) => text === alias || text.includes(alias))) return key;
    return null;
  };
  const fieldQuery = editableSelector;
  const deepQueryAll = (root, selector, seen = new Set()) => {
    const found = [];
    const visit = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      if (node.querySelectorAll) found.push(...node.querySelectorAll(selector));
      const all = node.querySelectorAll ? node.querySelectorAll("*") : [];
      for (const element of all) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(root);
    return [...new Set(found)];
  };
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const hiddenByAttribute = element.hidden || element.closest("[hidden]");
    return !hiddenByAttribute && style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const isUsableFallback = (element) => {
    const style = getComputedStyle(element);
    const type = String(element.getAttribute("type") || "").toLowerCase();
    const badType = ["hidden", "file", "submit", "button", "image", "reset"].includes(type);
    const hiddenByAttribute = element.hidden || element.closest("[hidden]");
    return !badType && !hiddenByAttribute && style.display !== "none" && style.visibility !== "hidden";
  };
  const allEditableElements = deepQueryAll(document, fieldQuery).filter((element) => !element.disabled && !element.readOnly && isUsableFallback(element));
  const visibleElements = allEditableElements.filter(isVisible);
  const platformText = `${location.hostname} ${location.href} ${document.title || ""} ${document.body?.innerText?.slice(0, 2500) || ""}`;
  const greenhouseLike = /greenhouse\.io|greenhouse/i.test(platformText);
  const smartRecruitersLike = /smartrecruiters\.com|oneclick-ui|smartrecruiters/i.test(platformText);
  const ashbyLike = /ashbyhq\.com|ashby/i.test(platformText);
  const dynamicAtsLike = greenhouseLike || smartRecruitersLike || ashbyLike;
  const fieldLooksRelevant = (element) => {
    if (dynamicAtsLike && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element.isContentEditable)) return true;
    const text = [
      fieldTextFor(element),
      displayTextFor(element),
      element.id,
      element.name,
      element.getAttribute("aria-label"),
      element.getAttribute("autocomplete"),
      element.getAttribute("placeholder"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.getAttribute("data-test-id"),
      element.getAttribute("data-qa")
    ].filter(Boolean).join(" ");
    if (/name|email|phone|resume|linkedin|website|location|school|degree|company|title|address|city|state|zip|postal|country|authorization|sponsor|visa|salary|experience/i.test(text)) return true;
    const containerText = normalized(element.closest("label, [role=group], fieldset, form, [data-testid*=field], [data-test*=field], [data-qa*=field]")?.innerText || "");
    return /name|email|phone|resume|linkedin|website|location|school|degree|company|title|address|city|state|zip|postal|country|authorization|sponsor|visa|salary|experience/.test(containerText);
  };
  const elements = dynamicAtsLike
    ? [...new Set([...visibleElements, ...allEditableElements.filter(fieldLooksRelevant)])]
    : visibleElements.length || !allEditableElements.length
      ? visibleElements
      : allEditableElements.filter(fieldLooksRelevant);
  const setNativeValue = (element, value) => { const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set; setter ? setter.call(element, value) : (element.value = value); };
  if (["toggle-picker", "enable-picker", "disable-picker"].includes(action)) {
    if (window.__jahFieldPicker?.enabled) {
      if (action === "enable-picker") return { enabled: true };
      window.__jahFieldPicker.cleanup();
      return { enabled: false };
    }
    if (action === "disable-picker") return { enabled: false };
    const pickerChoices = [];
    const tagGroups = {
      fullName: "full name legal name name applicant name candidate name complete name display name preferred full name your name name as it appears",
      firstName: "first name given name firstname fname forename personal name",
      preferredName: "preferred name nickname preferred first name goes by chosen name",
      middleName: "middle name additional name middlename middle initial mi",
      lastName: "last name family name surname lastname lname family surname",
      email: "email email address e mail contact email primary email",
      phoneCountryCode: "phone country code country calling code calling code dialing code dial code telephone country code mobile country code",
      phoneCountryName: "phone country telephone country phone country name telephone country country code united states usa country calling country",
      phone: "phone phone number mobile telephone tel cell cellphone mobile number contact number primary phone",
      streetAddress: "street address address line 1 address1 mailing address home address current address residential address address street",
      addressLine2: "address line 2 address2 apartment apt suite unit building floor room address continuation",
      city: "city town municipality locality address city",
      state: "state province region address level1 state province administrative area",
      postalCode: "zip zip code postal code postcode postal zipcode",
      country: "country country region nation residence country address country",
      linkedin: "linkedin linkedin url linkedin profile linkedin link social profile",
      portfolio: "portfolio portfolio url personal website website personal site online portfolio homepage",
      github: "github github url github profile github link code repository",
      currentCompany: "current company current employer most recent employer current organization present company employer",
      currentTitle: "current title job title current position most recent title position title current role present role",
      yearsExperience: "years of experience total years experience experience years years professional experience total experience",
      professionalSummary: "professional summary profile summary summary about me bio biography introduction candidate summary personal summary",
      skills: "skills technical skills tools technologies competencies qualifications expertise abilities software tools platforms",
      graduationYear: "graduation year graduation date year graduated completion year expected graduation grad year degree date",
      startDate: "available start date earliest start date availability date when can you start start work date available from",
      desiredTitle: "desired job title desired title target role target position position applying for preferred role desired position role applying to",
      employmentType: "employment type job type full time part time contract internship temporary permanent schedule type work type",
      desiredSalary: "desired salary salary expectation compensation expected pay pay expectation expected compensation salary requirements target salary",
      noticePeriod: "notice period notice availability resignation notice available after",
      remotePreference: "remote preference work arrangement remote hybrid onsite on site workplace preference work location preference",
      travel: "travel willing to travel travel requirement travel availability",
      workStatus: "citizenship work status employment status authorization status legal status work eligibility citizenship status",
      visaStatus: "visa status immigration status visa type current visa immigration type opt cpt stem opt f1 f 1",
      source: "source referral source how did you hear where did you hear heard about us job source referral channel",
      coverLetterNotes: "cover letter motivation additional information notes message comments why interested open ended response",
      workAuthorization: "authorized to work legally authorized work authorization employment authorization eligible to work right to work authorized employment eligibility",
      sponsorship: "require sponsorship need sponsorship visa sponsorship immigration sponsorship work visa sponsorship future sponsorship now or in the future",
      relocate: "willing to relocate relocation relocate open to relocate relocation preference",
      referralCode: "referral code employee referral code referrer code referral id referral name referred by",
      school: "school university college institution education educational institution academic institution institution name university name college name",
      degree: "degree degree type education level diploma qualification credential award level",
      major: "major field of study discipline concentration program area of study course of study specialization",
      company: "company employer legal employer employer name organization organization name company name business name",
      title: "job title title position role position title role title employment title",
      location: "location city employer city work location job location office location workplace location",
      description: "responsibilities role description description duties job duties tasks achievements achievement accomplishments accomplishment contributions contribution impact results key achievements work summary responsibilities achievements main duties",
      name: "license certificate certification license or certificate credential certification name license name certificate name",
      issuer: "issued by issuer issuing organization issuing authority provider certifying body organization",
      number: "certificate number certification number credential id license number certificate id license id registration number",
      language: "language language name spoken language languages known language proficiency",
      fluent: "fluent fluency native fluent speaker",
      overall: "overall comprehension proficiency overall proficiency language level",
      reading: "reading read proficiency reading proficiency",
      speaking: "speaking speak proficiency oral spoken proficiency",
      writing: "writing write proficiency written writing proficiency",
      start: "start date from beginning date begin date started start month start year",
      end: "end date to graduation date completion date finish date ended end month end year",
      date: "issue date issued date acquired date date earned date received certification date",
      expiration: "expiration date expiry date expires valid until valid through renewal date"
    };
    const tagsForKey = (key) => tagGroups[String(key).split(":").at(-1)] || tagGroups[key] || String(key);
    const addChoice = (key, value, description = key, tags = tagsForKey(key)) => {
      if (value === "" || value === undefined || value === null) return;
      pickerChoices.push({ key, value, description, tags });
    };
    for (const key of ["fullName", "firstName", "preferredName", "middleName", "lastName", "email", "phone", "phoneCountryName", "streetAddress", "addressLine2", "city", "state", "postalCode", "country", "linkedin", "portfolio", "github", "currentCompany", "currentTitle", "yearsExperience", "desiredTitle", "employmentType", "desiredSalary", "noticePeriod", "remotePreference", "travel", "school", "degree", "major", "graduationYear", "professionalSummary", "skills", "workAuthorization", "sponsorship", "relocate", "workStatus", "visaStatus", "source", "startDate", "referralCode", "coverLetterNotes"]) addChoice(key, profileValue(key));
    addChoice("phoneCountryCode", phoneCountryCode, "Phone country code");
    const addEntryChoices = (section, entries, fields, heading) => {
      for (const [entryIndex, entry] of (entries || []).entries()) {
        const identity = entry[heading] || `${section} ${entryIndex + 1}`;
        for (const [field, property] of Object.entries(fields)) addChoice(`${section}:${entryIndex}:${field}`, entry[property], `${section} ${entryIndex + 1} (${identity}) - ${field}`);
      }
    };
    addEntryChoices("education", details.educationEntries, { school: "school", degree: "degree", major: "major", start: "startDate", end: "endDate" }, "school");
    addEntryChoices("work", details.experienceEntries, { company: "company", title: "title", location: "location", current: "isCurrent", start: "startDate", end: "endDate", description: "description" }, "company");
    addEntryChoices("project", details.projectEntries, { name: "name", technologies: "technologies", start: "startDate", end: "endDate", description: "description" }, "name");
    addEntryChoices("certification", details.certificationEntries, { name: "name", issuer: "issuer", number: "credentialId", date: "date", expiration: "expirationDate" }, "name");
    addEntryChoices("language", details.languageEntries, { language: "language", fluent: "fluent", overall: "overall", reading: "reading", speaking: "speaking", writing: "writing" }, "language");
    const style = document.createElement("style");
    style.id = "jah-picker-style";
    style.textContent = "#jah-picker-panel{position:fixed;z-index:2147483647;width:440px;max-width:calc(100vw - 24px);max-height:560px;overflow:hidden;padding:12px;border:1px solid #b9c8c2;border-radius:16px;background:#fff;box-shadow:0 18px 44px rgba(0,0,0,.24);font:13px Arial,sans-serif;color:#23332e}#jah-picker-panel *{box-sizing:border-box}#jah-picker-panel header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}.jah-picker-heading{display:flex;flex-direction:column;gap:3px;min-width:0}.jah-picker-title{font-weight:800;font-size:14px;color:#213d35}.jah-picker-subtitle{font-size:11px;line-height:1.35;color:#6f7f79;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px}#jah-picker-panel input{width:100%;padding:10px 11px;border:1px solid #cbd8d3;border-radius:10px;background:#fbfdfc;font:13px Arial,sans-serif;color:#223832;outline:none}#jah-picker-panel input:focus{border-color:#2f6f5f;box-shadow:0 0 0 3px rgba(47,111,95,.14)}.jah-picker-more,.jah-back-button,.jah-browse-button{width:100%;margin:8px 0 0;padding:8px 10px;border:1px solid #cadbd4;border-radius:10px;background:#f5faf8;color:#2f6f5f;cursor:pointer;font:700 12px Arial,sans-serif}.jah-browse-button{background:#fff7ed;border-color:#e8c9a7;color:#8a5a24}.jah-picker-more:hover,.jah-back-button:hover,.jah-browse-button:hover{background:#edf6f2}.jah-browse-button:hover{background:#fff1dc}.jah-browser-title{margin:10px 2px 8px;color:#61736d;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.jah-category-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.jah-category-button{padding:11px;border:1px solid #dde7e3;border-radius:12px;background:#fff;color:#264f43;text-align:left;cursor:pointer;font:13px Arial,sans-serif}.jah-category-button strong{display:block;margin-bottom:4px;color:#203d35}.jah-category-button span{display:block;color:#71807b;font-size:11px}.jah-category-button:hover{background:#f3f8f6;border-color:#b8ccc4}.jah-entry-title{display:block;color:#203d35;font-weight:800}.jah-entry-subtitle{display:block;margin-top:4px;color:#71807b;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#jah-picker-list{max-height:388px;overflow:auto;margin-top:10px;padding-right:2px}#jah-picker-list button{display:block;width:100%;margin:0 0 8px;padding:10px 11px;border:1px solid #dde7e3;border-radius:12px;background:#fff;color:#264f43;text-align:left;cursor:pointer;font:13px Arial,sans-serif;transition:background .12s,border-color .12s,transform .12s}#jah-picker-list button:hover{background:#f3f8f6;border-color:#b8ccc4;transform:translateY(-1px)}.jah-choice-meta,.jah-choice-value,.jah-choice-key{display:block}.jah-choice-meta{margin-bottom:5px;color:#61736d;font-size:11px;line-height:1.25}.jah-choice-value{color:#203d35;font-size:13px;line-height:1.35;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.jah-choice-key{margin-top:6px;color:#8a6a48;font-size:10px;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#jah-picker-list p{margin:10px 4px;color:#71807b;line-height:1.4}#jah-picker-close{border:0;border-radius:9px;background:#f7eee9;color:#8a4d43;cursor:pointer;font-weight:800;padding:7px 9px}.jah-picker-active{outline:2px solid #d7673f!important;outline-offset:2px!important}";
    document.documentElement.append(style);
    let panel;
    let activeElement;
    let rememberedBrowseState = { section: "", entryKey: "" };
    const keyField = (key) => String(key).split(":").at(-1).replace(/(?:Year|Month|Day)$/, "");
    const datePartForChoice = (key) => String(key).match(/(Year|Month|Day)$/)?.[1]?.toLowerCase() || "";
    const dateParts = (value) => {
      const text = String(value || "").trim();
      const match = text.match(/\b((?:19|20)\d{2})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?/);
      if (match) return { year: match[1], month: match[2] ? String(match[2]).padStart(2, "0") : "", day: match[3] ? String(match[3]).padStart(2, "0") : "" };
      const numeric = text.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/]((?:19|20)\d{2}))?/);
      if (numeric) return { month: String(numeric[1]).padStart(2, "0"), day: String(numeric[2]).padStart(2, "0"), year: numeric[3] || "" };
      const named = text.toLowerCase().match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[\s.,-]*(\d{1,2})(?:st|nd|rd|th)?(?:[\s,.-]+((?:19|20)\d{2}))?/);
      const months = { jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03", apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07", aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12" };
      return named ? { month: months[named[1]], day: String(named[2]).padStart(2, "0"), year: named[3] || "" } : {};
    };
    const expandDateChoices = (choices) => choices.flatMap((choice) => {
      if (!["start", "end", "date", "expiration"].includes(keyField(choice.key))) return [choice];
      const parts = dateParts(choice.value);
      const extra = Object.entries(parts).flatMap(([part, value]) => value ? [{ ...choice, key: `${choice.key}${part[0].toUpperCase()}${part.slice(1)}`, value, description: `${choice.description} - ${part}`, tags: `${choice.tags} ${part}` }] : []);
      return [choice, ...extra];
    });
    const keySection = (key) => String(key).includes(":") ? String(key).split(":")[0] : "basic";
    const contextFor = (element) => normalized([textFor(element), fieldTextFor(element)].filter(Boolean).join(" "));
    const fieldIntentFor = (context) => {
      const rules = [
        ["phoneCountryCode", /phone country code|country calling code|calling code|dialing code|dial code|telephone country code|mobile country code/], ["phone", /\bphone\b|phone number|mobile|telephone|\btel\b|cellphone|cell phone|contact number/],
        ["fullName", /full name|legal name|applicant name|candidate name|complete name|display name|your name/],
        ["firstName", /first name|given name|firstname|\bfname\b|forename/], ["middleName", /middle name|additional name|middlename|middle initial/], ["lastName", /last name|family name|surname|lastname|\blname\b/],
        ["email", /\bemail\b|e mail|contact email|primary email/], ["streetAddress", /street address|address line 1|address1|mailing address|home address|residential address/], ["postalCode", /\bzip\b|zip code|postal code|postcode|zipcode/],
        ["city", /\bcity\b|\btown\b|municipality|locality/], ["state", /\bstate\b|province|administrative area|address level1/], ["country", /\bcountry\b|country region|nation|residence country/],
        ["linkedin", /linkedin/], ["github", /github|code repository/], ["portfolio", /portfolio|personal website|personal site|online portfolio|homepage/],
        ["yearsExperience", /years of experience|total experience|professional experience|experience years/], ["skills", /\bskills\b|technical skills|tools|technologies|competencies|expertise|software tools|platforms/], ["professionalSummary", /professional summary|profile summary|candidate summary|personal summary|about me|bio|biography/],
        ["desiredSalary", /desired salary|salary expectation|expected pay|pay expectation|expected compensation|salary requirements|target salary|compensation/], ["employmentType", /employment type|job type|work type|full time|part time|contract|internship|temporary|permanent/],
        ["remotePreference", /remote preference|work arrangement|remote|hybrid|onsite|on site|workplace preference/], ["noticePeriod", /notice period|resignation notice|available after/], ["startDate", /available start date|earliest start date|availability date|when can you start|start work date|available from/],
        ["workAuthorization", /authorized to work|legally authorized|work authorization|employment authorization|eligible to work|right to work|employment eligibility/], ["sponsorship", /require sponsorship|need sponsorship|visa sponsorship|immigration sponsorship|work visa sponsorship|now or in the future/],
        ["visaStatus", /visa status|immigration status|visa type|current visa|\bopt\b|\bcpt\b|stem opt|\bf1\b|f 1/], ["workStatus", /citizenship|work status|employment status|authorization status|legal status|work eligibility|citizenship status/],
        ["relocate", /willing to relocate|relocation|open to relocate/], ["travel", /willing to travel|travel requirement|travel availability/], ["source", /how did you hear|where did you hear|heard about us|job source|referral source|referral channel/], ["referralCode", /referral code|employee referral code|referrer code|referral id|referral name|referred by/], ["coverLetterNotes", /cover letter|additional information|motivation|message|comments|why interested|open ended response/],
        ["school", /\bschool\b|university|college|academic institution|educational institution|institution name/], ["degree", /\bdegree\b|degree type|education level|diploma|qualification|credential|award level/], ["major", /\bmajor\b|field of study|discipline|concentration|area of study|course of study|specialization/],
        ["graduationYear", /graduation year|graduation date|year graduated|completion year|expected graduation|grad year|degree date/],
        ["company", /\bcompany\b|legal employer|employer name|organization name|business name/], ["description", /responsibilities|role description|description|job duties|duties|tasks|achievements?|accomplishments?|contributions?|impact|results|work summary|main duties/], ["title", /job title|position title|current title|desired title|\bposition\b|\brole\b|role title|employment title/], ["location", /\blocation\b|employer city|job location|office location|workplace location/],
        ["name", /license or certificate|certification name|certificate name|license name|credential name/], ["issuer", /issued by|\bissuer\b|issuing organization|issuing authority|provider|certifying body/], ["number", /certificate number|certification number|credential id|license number|certificate id|license id|registration number/],
        ["language", /\blanguage\b|language name|spoken language|languages known/], ["fluent", /\bfluent\b|fluency|native speaker/], ["reading", /\breading\b|read proficiency/], ["speaking", /\bspeaking\b|oral|spoken proficiency/], ["writing", /\bwriting\b|written|write proficiency/], ["overall", /comprehension|overall|proficiency|language level/],
        ["date", /issue date|issued date|acquired date|date earned|date received/], ["expiration", /expiration date|expiry date|expires|valid until|valid through|renewal date/], ["start", /\bfrom\b|start date|begin date|started|start month|start year/], ["end", /\bto\b|end date|finish date|ended|completion date|end month|end year/]
      ];
      return rules.find(([, pattern]) => pattern.test(context))?.[0] || "";
    };
    const sectionIntentFor = (context) => {
      if (/license|certificate|certification/.test(context)) return "certification";
      if (/education|school|university|\bdegree\b|\bmajor\b|field of study/.test(context)) return "education";
      if (/work experience|employment|employer|job title|responsibilities|job duties|role description|achievements?|accomplishments?/.test(context)) return "work";
      if (/\blanguage\b|fluent|reading|speaking|writing/.test(context)) return "language";
      return "";
    };
    const choiceMatchesIntent = (choice, fieldIntent, sectionIntent) => {
      const field = keyField(choice.key);
      const section = keySection(choice.key);
      const aliases = { title: ["title", "currentTitle", "desiredTitle"], company: ["company", "currentCompany"], start: ["start", "startDate"] }[fieldIntent] || [fieldIntent];
      if (fieldIntent && !aliases.includes(field) && !aliases.includes(choice.key)) return false;
      if (fieldIntent === "title" && field === "title") return true;
      if (sectionIntent && section !== "basic" && section !== sectionIntent) {
        if (!(fieldIntent === "title" && ["currentTitle", "desiredTitle"].includes(choice.key))) return false;
      }
      return true;
    };
    const scoreChoice = (label, choice, fieldIntent = "", sectionIntent = "") => {
      const words = new Set(normalized(label).split(" ").filter((word) => word.length > 1));
      const choiceText = normalized(`${choice.key} ${choice.description} ${choice.tags}`);
      let score = 0;
      const aliases = { title: ["title", "currentTitle", "desiredTitle"], company: ["company", "currentCompany"], start: ["start", "startDate"] }[fieldIntent] || [fieldIntent];
      if (aliases.includes(keyField(choice.key)) || aliases.includes(choice.key)) score += 30;
      if (fieldIntent === "title" && choice.key === "currentTitle") score += 8;
      if (fieldIntent === "title" && keyField(choice.key) === "title") score += 6;
      if (keySection(choice.key) === sectionIntent) score += 12;
      for (const word of words) if (choiceText.includes(word)) score += 2;
      if (choiceText.includes(normalized(label))) score += 6;
      return score;
    };
    const closePanel = () => {
      activeElement?.classList.remove("jah-picker-active");
      panel?.remove();
      panel = null;
      activeElement = null;
    };
    const writableElementFor = (element) => {
      if (!element) return null;
      if (element.matches?.(writableSelector)) return element;
      const nested = element.querySelector?.(writableSelector);
      if (nested && !nested.disabled && !nested.readOnly) return nested;
      const labelled = element.id ? document.querySelector(`[aria-labelledby~="${CSS.escape(element.id)}"], [aria-describedby~="${CSS.escape(element.id)}"]`) : null;
      return labelled?.matches?.(writableSelector) && !labelled.disabled && !labelled.readOnly ? labelled : null;
    };
    const commitValue = (element, value) => {
      element.focus?.();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        setNativeValue(element, String(value));
      } else if (element.isContentEditable) {
        element.textContent = String(value);
      } else if ("value" in element) {
        setNativeValue(element, String(value));
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.blur?.();
    };
    const fillTarget = (element, value) => {
      element = writableElementFor(element) || element;
      if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
        const desired = !/^(?:false|no|0)$/i.test(String(value));
        if (element.checked !== desired) element.click();
        return;
      }
      if (element instanceof HTMLSelectElement) {
        const target = normalized(value);
        const option = [...element.options].find((item) => normalized(item.value) === target || normalized(item.text) === target)
          || [...element.options].find((item) => normalized(item.text).includes(target) || target.includes(normalized(item.text)));
        if (!option) return;
        element.value = option.value;
      } else if (element.isContentEditable) {
        commitValue(element, value);
        return;
      } else if ("value" in element) {
        commitValue(element, value);
        return;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const showPanel = (element) => {
      closePanel();
      activeElement = element;
      element.classList.add("jah-picker-active");
      const label = contextFor(element);
      const fieldIntent = fieldIntentFor(label);
      const sectionIntent = sectionIntentFor(label);
      panel = document.createElement("div");
      panel.id = "jah-picker-panel";
      const header = document.createElement("header");
      const heading = document.createElement("div");
      heading.className = "jah-picker-heading";
      const title = document.createElement("span");
      title.className = "jah-picker-title";
      title.textContent = "Choose a value for this field";
      const subtitle = document.createElement("span");
      subtitle.className = "jah-picker-subtitle";
      subtitle.textContent = label ? `Field: ${String(label).slice(0, 120)}` : "Pick from saved profile values.";
      heading.append(title, subtitle);
      const close = document.createElement("button");
      close.id = "jah-picker-close";
      close.type = "button";
      close.textContent = "Close";
      close.addEventListener("click", closePanel);
      header.append(heading, close);
      const search = document.createElement("input");
      search.placeholder = "Search profile values";
      search.autocomplete = "off";
      let showMore = false;
      let browseState = { ...rememberedBrowseState };
      let browsingAll = false;
      const browseAll = document.createElement("button");
      browseAll.type = "button";
      browseAll.className = "jah-browse-button";
      browseAll.textContent = "Browse all categories";
      const more = document.createElement("button");
      more.type = "button";
      more.className = "jah-picker-more";
      more.textContent = "Show more options";
      const back = document.createElement("button");
      back.type = "button";
      back.className = "jah-back-button";
      back.textContent = "Back";
      back.hidden = true;
      const list = document.createElement("div");
      list.id = "jah-picker-list";
      const choiceMeta = (choice) => {
        const key = String(choice.key || "");
        const parts = key.split(":");
        const section = parts.length >= 3 ? parts[0] : "basic";
        const entryIndex = parts.length >= 3 ? Number(parts[1]) : -1;
        const field = parts.length >= 3 ? parts[2] : key;
        const sectionLabel = { basic: "Basic", work: "Work", education: "Education", project: "Project", certification: "Certification", language: "Language" }[section] || section;
        const entryLabel = entryIndex >= 0 ? `${sectionLabel} ${entryIndex + 1}` : sectionLabel;
        return { section, entryIndex, field, sectionLabel, entryLabel, entryKey: entryIndex >= 0 ? `${section}:${entryIndex}` : `basic:${field}` };
      };
      const browseLabelFor = (choice) => {
        const meta = choiceMeta(choice);
        const cleanField = String(meta.field || choice.key).replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()).trim();
        return `${meta.entryLabel} - ${cleanField}`;
      };
      const addChoiceButton = (choice, labelText = choice.description) => {
        const button = document.createElement("button");
        button.type = "button";
        const description = document.createElement("small");
        description.className = "jah-choice-meta";
        description.textContent = labelText;
        const value = document.createElement("strong");
        value.className = "jah-choice-value";
        value.textContent = String(choice.value).slice(0, 160);
        const key = document.createElement("span");
        key.className = "jah-choice-key";
        key.textContent = choice.key;
        button.append(description, value, key);
        button.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          fillTarget(element, choice.value);
          closePanel();
        });
        list.append(button);
      };
      const renderBrowser = (choices) => {
        list.replaceChildren();
        search.hidden = true;
        more.hidden = true;
        browseAll.hidden = true;
        back.hidden = false;
        const validSection = !browseState.section || choices.some((choice) => choiceMeta(choice).section === browseState.section);
        const validEntry = !browseState.entryKey || choices.some((choice) => choiceMeta(choice).entryKey === browseState.entryKey);
        if (!validSection || !validEntry) {
          browseState = { section: "", entryKey: "" };
          rememberedBrowseState = { ...browseState };
        }
        back.textContent = browseState.section ? "Back" : "Back to suggestions";
        if (!browseState.section) {
          const title = document.createElement("div");
          title.className = "jah-browser-title";
          title.textContent = "No precise match. Browse by category";
          list.append(title);
          const grid = document.createElement("div");
          grid.className = "jah-category-grid";
          const grouped = choices.reduce((map, choice) => {
            const meta = choiceMeta(choice);
            if (!map.has(meta.section)) map.set(meta.section, []);
            map.get(meta.section).push(choice);
            return map;
          }, new Map());
          const order = ["basic", "work", "education", "project", "certification", "language"];
          for (const section of order.filter((item) => grouped.has(item))) {
            const sectionChoices = grouped.get(section);
            const sectionLabel = choiceMeta(sectionChoices[0]).sectionLabel;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "jah-category-button";
            button.innerHTML = `<strong>${sectionLabel}</strong><span>${sectionChoices.length} value(s)</span>`;
            button.addEventListener("click", () => {
              browseState = { section, entryKey: "" };
              rememberedBrowseState = { ...browseState };
              renderBrowser(choices);
            });
            grid.append(button);
          }
          list.append(grid);
          return;
        }
        const sectionChoices = choices.filter((choice) => choiceMeta(choice).section === browseState.section);
        if (browseState.section === "basic") {
          const title = document.createElement("div");
          title.className = "jah-browser-title";
          title.textContent = "Basic";
          list.append(title);
          for (const choice of sectionChoices) addChoiceButton(choice, browseLabelFor(choice));
          return;
        }
        if (!browseState.entryKey) {
          const entries = sectionChoices.reduce((map, choice) => {
            const meta = choiceMeta(choice);
            if (!map.has(meta.entryKey)) map.set(meta.entryKey, []);
            map.get(meta.entryKey).push(choice);
            return map;
          }, new Map());
          const title = document.createElement("div");
          title.className = "jah-browser-title";
          title.textContent = choiceMeta(sectionChoices[0] || {}).sectionLabel;
          list.append(title);
          for (const [entryKey, entryChoices] of entries) {
            const first = entryChoices[0];
            const meta = choiceMeta(first);
            const button = document.createElement("button");
            button.type = "button";
            const primary = document.createElement("span");
            primary.className = "jah-entry-title";
            primary.textContent = meta.entryLabel;
            const subtitle = document.createElement("span");
            subtitle.className = "jah-entry-subtitle";
            subtitle.textContent = entryChoices.map((choice) => String(choice.value || "")).filter(Boolean).slice(0, 3).join(" | ");
            button.append(primary, subtitle);
            button.addEventListener("click", () => {
              browseState = { ...browseState, entryKey };
              rememberedBrowseState = { ...browseState };
              renderBrowser(choices);
            });
            list.append(button);
          }
          return;
        }
        const fieldChoices = sectionChoices.filter((choice) => choiceMeta(choice).entryKey === browseState.entryKey);
        for (const choice of fieldChoices) addChoiceButton(choice, browseLabelFor(choice));
      };
      const render = () => {
        const query = normalized(search.value);
        const expandedChoices = expandDateChoices(pickerChoices);
        const datePart = datePartFor(element);
        const matchingChoices = expandedChoices.filter((choice) => {
          const choiceField = keyField(choice.key);
          const datePartMatches = !["year", "month", "day"].includes(datePart) || (["start", "end", "date", "expiration"].includes(choiceField) && datePartForChoice(choice.key) === datePart);
          return choiceMatchesIntent(choice, fieldIntent, sectionIntent) && datePartMatches;
        });
        const searchPool = query ? expandedChoices : (matchingChoices.length ? matchingChoices : expandedChoices);
        const choices = searchPool.filter((choice) => !query || normalized(`${choice.key} ${choice.description} ${choice.tags} ${choice.value}`).includes(query))
          .sort((a, b) => scoreChoice(label, b, fieldIntent, sectionIntent) - scoreChoice(label, a, fieldIntent, sectionIntent));
        if (!query && !showMore && matchingChoices.length === 0) {
          browsingAll = true;
          browseState = { ...rememberedBrowseState };
          renderBrowser(expandedChoices);
          return;
        }
        search.hidden = false;
        back.hidden = true;
        browseAll.hidden = false;
        const visibleChoices = choices.slice(0, query ? 18 : showMore ? 24 : 8);
        more.hidden = query || choices.length <= visibleChoices.length;
        list.replaceChildren();
        if (!visibleChoices.length) {
          const empty = document.createElement("p");
          empty.textContent = "No matching profile values. Try a different search.";
          list.append(empty);
        }
        for (const choice of visibleChoices) addChoiceButton(choice);
      };
      more.addEventListener("click", () => {
        showMore = true;
        render();
      });
      browseAll.addEventListener("click", () => {
        browsingAll = true;
        browseState = { section: "", entryKey: "" };
        rememberedBrowseState = { ...browseState };
        renderBrowser(expandDateChoices(pickerChoices));
      });
      back.addEventListener("click", () => {
        if (!browseState.section) {
          browsingAll = false;
          render();
          return;
        }
        browseState = browseState.entryKey ? { section: browseState.section, entryKey: "" } : { section: "", entryKey: "" };
        rememberedBrowseState = { ...browseState };
        renderBrowser(expandDateChoices(pickerChoices));
      });
      search.addEventListener("input", render);
      panel.append(header, search, browseAll, more, back, list);
      document.body.append(panel);
      const rect = element.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 368, rect.right + 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(window.innerHeight - 438, rect.top))}px`;
      render();
    };
    const pickerTargetFromEvent = (event) => {
      const path = event.composedPath?.() || [];
      for (const node of path) {
        if (!(node instanceof Element) || node.id === "jah-picker-panel" || node.closest?.("#jah-picker-panel")) return null;
        if (node.matches?.(editableSelector)) return node;
        const direct = node.closest?.(editableSelector);
        if (direct) return direct;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest?.("#jah-picker-panel")) return null;
      const scoped = target.closest?.("label, [role=group], fieldset, [data-testid*=field], [data-test*=field], [data-test-id*=field], [data-qa*=field], div");
      const descendants = scoped ? [...scoped.querySelectorAll(editableSelector)].filter((item) => !item.disabled && !item.readOnly) : [];
      return descendants.length === 1 ? descendants[0] : null;
    };
    const isPickerEligible = (element) => {
      if (!element || element.disabled || element.readOnly) return false;
      if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio" || element.type === "file")) return false;
      return true;
    };
    const listener = (event) => {
      if (event.target instanceof Element && event.target.closest?.("#jah-picker-panel")) return;
      const element = pickerTargetFromEvent(event);
      if (isPickerEligible(element)) showPanel(element);
      else if (event.type === "pointerdown" || event.type === "click") closePanel();
    };
    document.addEventListener("pointerdown", listener, true);
    document.addEventListener("focusin", listener, true);
    document.addEventListener("click", listener, true);
    window.__jahFieldPicker = { enabled: true, cleanup: () => { document.removeEventListener("pointerdown", listener, true); document.removeEventListener("focusin", listener, true); document.removeEventListener("click", listener, true); closePanel(); style.remove(); delete window.__jahFieldPicker; } };
    return { enabled: true };
  }
  if (action === "clear") {
    let cleared = 0;
    for (const element of elements) {
      if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
        if (!element.checked) continue;
        element.checked = false;
      } else if (element instanceof HTMLSelectElement) {
        const emptyOption = [...element.options].find((option) => !String(option.value || "").trim());
        element.value = emptyOption?.value ?? element.options[0]?.value ?? "";
      } else if (element.isContentEditable) {
        if (!String(element.textContent || "").trim()) continue;
        element.textContent = "";
      } else if ("value" in element) {
        if (!String(element.value || "").trim()) continue;
        setNativeValue(element, "");
      } else {
        continue;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      element.blur();
      cleared += 1;
    }
    return cleared;
  }
  const approvedKeys = new Map(approvedMatches.map((match) => [match.index, match.key]));
  const approvedManual = new Set(approvedMatches.filter((match) => match.allowManual).map((match) => match.index));
  const requiresManualSelection = (element) => {
    if (element instanceof HTMLSelectElement) return false;
    const role = element.getAttribute("role") || "";
    if (element instanceof HTMLButtonElement && (element.getAttribute("aria-haspopup") || element.getAttribute("aria-controls"))) return true;
    if (role === "combobox" && !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return true;
    if (element.getAttribute("aria-haspopup") && !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return true;
    if ((element.getAttribute("aria-autocomplete") || element.getAttribute("aria-controls") || element.getAttribute("list")) && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return true;
    return false;
  };
  const candidates = elements.map((element, index) => {
    try {
      const structured = structuredValue(element);
      const approvedKey = approvedKeys.get(index);
      const key = approvedKey || structured?.key || identify(element);
      const value = approvedKey ? applicationValueForKey(element, approvedKey) : structured?.value ?? applicationValueForKey(element, key);
      const requiresManual = requiresManualSelection(element);
      return key && value !== "" && value !== undefined && value !== null && value !== false ? { index, key, label: displayTextFor(element) || element.name || element.id || key, displayValue: String(value), value, requiresManual, confidence: requiresManual ? 0.82 : 0.96 } : null;
    } catch {
      return null;
    }
  }).filter(Boolean);
  if (action === "scan") {
    const matchedIndexes = new Set(candidates.map((candidate) => candidate.index));
    const optionTextsFor = (element) => {
      if (element instanceof HTMLSelectElement) return [...element.options].slice(0, 25).map((option) => option.text || option.value).filter(Boolean);
      const ids = [element.getAttribute("aria-controls"), element.getAttribute("aria-owns")].filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
      const controlled = ids.flatMap((id) => [...(document.getElementById(id)?.querySelectorAll?.('[role="option"], [role="menuitem"], [data-value]') || [])]);
      return controlled.slice(0, 25).map((option) => option.innerText || option.getAttribute("aria-label") || option.getAttribute("data-value") || "").filter(Boolean);
    };
    const controlKindFor = (element) => {
      if (element instanceof HTMLSelectElement) return "select";
      if (element instanceof HTMLTextAreaElement) return "textarea";
      if (element instanceof HTMLButtonElement || element.getAttribute("role") === "button") return "custom-select";
      if (element.getAttribute("role") === "combobox" || element.getAttribute("aria-haspopup")) return "combobox";
      if (element.getAttribute("aria-autocomplete") || element.getAttribute("aria-controls") || element.getAttribute("list")) return "autocomplete";
      if (element.isContentEditable || element.getAttribute("role") === "textbox") return "textbox";
      return element.tagName.toLowerCase();
    };
    const fields = elements.map((element, index) => {
      const fallbackLabel = [element.tagName.toLowerCase(), element.getAttribute("role"), element.name, element.id, element.getAttribute("placeholder"), element.getAttribute("aria-label"), element.innerText].filter(Boolean).join(" ");
      try {
        const valueText = "value" in element ? element.value : element.innerText || element.textContent || "";
        return { index, label: displayTextFor(element) || fallbackLabel, tag: element.tagName.toLowerCase(), type: element.getAttribute("type") || "", role: element.getAttribute("role") || "", controlKind: controlKindFor(element), autocomplete: element.getAttribute("autocomplete") || "", options: optionTextsFor(element), blank: element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio") ? !element.checked : element.isContentEditable ? !String(element.textContent || "").trim() : !String(valueText || "").trim() };
      } catch {
        return { index, label: fallbackLabel, tag: element.tagName.toLowerCase(), type: element.getAttribute("type") || "", role: element.getAttribute("role") || "", controlKind: controlKindFor(element), autocomplete: element.getAttribute("autocomplete") || "", options: [], blank: true };
      }
    });
    const frameElements = deepQueryAll(document, "iframe");
    const ignoredFrameUrl = (url) => /content\.googleapis\.com\/static\/proxy\.html|\/static\/proxy\.html|apis\.google\.com\/.*\/iframe|recaptcha(?:\.net|\.google\.com)\/recaptcha|google\.com\/recaptcha/i.test(url || "");
    const frameLinks = frameElements.map((frame) => ({ src: frame.src || frame.getAttribute("src") || "", title: frame.title || frame.name || frame.id || "" })).filter((frame) => /^https?:\/\//i.test(frame.src) && !ignoredFrameUrl(frame.src));
    const debug = allEditableElements.slice(0, 8).map((element) => {
      const rect = element.getBoundingClientRect();
      return [element.tagName.toLowerCase(), element.getAttribute("type") || "", element.getAttribute("role") || "", element.name || "", element.id || "", element.getAttribute("aria-label") || "", element.getAttribute("aria-haspopup") || "", `${Math.round(rect.width)}x${Math.round(rect.height)}`, displayTextFor(element).slice(0, 100)].filter(Boolean).join(" | ");
    });
    return { matches: candidates, fields, total: elements.length, rawTotal: allEditableElements.length, unmatched: fields.filter((field) => !matchedIndexes.has(field.index)).slice(0, 8).map((field) => field.label), frames: frameElements.length, frameLinks, debug, platform: { greenhouseLike, smartRecruitersLike, ashbyLike, dynamicAtsLike } };
  }
  if (action === "diagnose") {
    const optionTextsFor = (element) => {
      if (element instanceof HTMLSelectElement) return [...element.options].slice(0, 30).map((option) => option.text || option.value).filter(Boolean);
      const ids = [element.getAttribute("aria-controls"), element.getAttribute("aria-owns")].filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
      const controlled = ids.flatMap((id) => [...(document.getElementById(id)?.querySelectorAll?.('[role="option"], [role="menuitem"], [data-value]') || [])]);
      return controlled.slice(0, 30).map((option) => option.innerText || option.getAttribute("aria-label") || option.getAttribute("data-value") || "").filter(Boolean);
    };
    const controlKindFor = (element) => {
      if (element instanceof HTMLSelectElement) return "select";
      if (element instanceof HTMLTextAreaElement) return "textarea";
      if (element instanceof HTMLButtonElement || element.getAttribute("role") === "button") return "custom-select";
      if (element.getAttribute("role") === "combobox" || element.getAttribute("aria-haspopup")) return "combobox";
      if (element.getAttribute("aria-autocomplete") || element.getAttribute("aria-controls") || element.getAttribute("list")) return "autocomplete";
      if (element.isContentEditable || element.getAttribute("role") === "textbox") return "textbox";
      return element.tagName.toLowerCase();
    };
    const candidateByIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]));
    const fields = allEditableElements.slice(0, 160).map((element, rawIndex) => {
      const index = elements.indexOf(element);
      const rect = element.getBoundingClientRect();
      const candidate = candidateByIndex.get(index);
      const valueText = "value" in element ? element.value : element.innerText || element.textContent || "";
      return {
        rawIndex,
        scanIndex: index >= 0 ? index : null,
        includedInScan: index >= 0,
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") || "",
        role: element.getAttribute("role") || "",
        controlKind: controlKindFor(element),
        id: element.id || "",
        name: element.getAttribute("name") || "",
        autocomplete: element.getAttribute("autocomplete") || "",
        placeholder: element.getAttribute("placeholder") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        ariaLabelledby: element.getAttribute("aria-labelledby") || "",
        ariaDescribedby: element.getAttribute("aria-describedby") || "",
        dataAutomationId: element.getAttribute("data-automation-id") || "",
        dataTestId: element.getAttribute("data-testid") || "",
        ownLabel: ownLabelFor(element),
        nearbyText: normalized(nearbyTextFor(element)).slice(0, 240),
        displayLabel: displayTextFor(element),
        options: optionTextsFor(element),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        visible: isVisible(element),
        blank: element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio") ? !element.checked : !String(valueText || "").trim(),
        matchedKey: candidate?.key || "",
        requiresManual: Boolean(candidate?.requiresManual)
      };
    });
    const frameElements = deepQueryAll(document, "iframe");
    return {
      url: location.href,
      title: document.title,
      host: location.hostname,
      timestamp: new Date().toISOString(),
      platform: { greenhouseLike, smartRecruitersLike, ashbyLike, dynamicAtsLike },
      counts: { allEditable: allEditableElements.length, visible: visibleElements.length, scanned: elements.length, matched: candidates.length, iframes: frameElements.length },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      iframes: frameElements.slice(0, 20).map((frame) => ({ src: frame.src || frame.getAttribute("src") || "", title: frame.title || "", name: frame.name || "", id: frame.id || "" })),
      fields
    };
  }
  const approved = new Set(approvedMatches.map((match) => `${match.index}:${match.key}`));
  const pause = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
  const chooseCustomOption = async (element, value) => {
    element.click(); element.focus(); await pause(180);
    const searchInput = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element
      : deepQueryAll(document, 'input:not([type=hidden]):not([type=file]), [role="combobox"], [role="textbox"], textarea').filter(isVisible).find((item) => item !== element && !item.disabled && !item.readOnly);
    if (searchInput && "value" in searchInput) {
      setNativeValue(searchInput, "");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.focus();
      for (const character of String(value)) {
        searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: character, bubbles: true }));
        setNativeValue(searchInput, `${searchInput.value || ""}${character}`);
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: character, bubbles: true }));
        await pause(12);
      }
      await pause(450);
    }
    const target = normalized(value);
    const optionText = (option) => normalized([option.innerText, option.getAttribute("aria-label"), option.getAttribute("data-value"), option.getAttribute("title")].filter(Boolean).join(" "));
    const textTokens = (text) => new Set(normalized(text).split(" ").filter((token) => token.length > 1));
    const overlapScore = (text) => {
      const option = optionText(text);
      if (!option || !target) return 0;
      if (option === target) return 1000;
      if (option.includes(target)) return 850;
      if (target.includes(option) && option.length >= 3) return 780;
      const targetTokens = textTokens(target);
      const optionTokens = textTokens(option);
      let overlap = 0;
      for (const token of targetTokens) if (optionTokens.has(token)) overlap += 1;
      const ratio = overlap / Math.max(1, targetTokens.size);
      return ratio >= 0.66 ? 600 + overlap * 20 : ratio >= 0.45 ? 430 + overlap * 20 : 0;
    };
    const degreeFamily = (text) => {
      if (/bachelor|\bba\b|\bbs\b/.test(text)) return "bachelor";
      if (/master|\bma\b|\bms\b|mba/.test(text)) return "master";
      if (/associate/.test(text)) return "associate";
      if (/doctor|phd/.test(text)) return "doctor";
      return "";
    };
    const options = deepQueryAll(document, '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="treeitem"], [data-automation-id="promptOption"], [data-value], [aria-selected], [aria-posinset]').filter((option) => {
      if (!isVisible(option)) return false;
      if (option === element || element.contains(option)) return false;
      const text = optionText(option);
      return text && text.length <= 220;
    });
    const family = degreeFamily(target);
    const exactMatches = options.filter((option) => optionText(option) === target);
    const containsMatches = options.filter((option) => {
      const text = optionText(option);
      return text && (text.includes(target) || target.includes(text));
    });
    const familyMatches = family ? options.filter((option) => degreeFamily(optionText(option)) === family) : [];
    const scoredMatches = options.map((option) => ({ option, score: overlapScore(option) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    const match = exactMatches.length === 1 ? exactMatches[0]
      : containsMatches.length === 1 ? containsMatches[0]
      : familyMatches.length === 1 ? familyMatches[0]
      : scoredMatches.length && scoredMatches[0].score >= 600 && scoredMatches[0].score > (scoredMatches[1]?.score || 0) + 40 ? scoredMatches[0].option
      : null;
    if (!match) {
      const inputTarget = searchInput || element;
      inputTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await pause(120);
      inputTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      inputTarget.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
      await pause(180);
      if (!isBlank(element)) return true;
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      element.blur();
      return false;
    }
    match.click();
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  const chooseNativeOption = (element, value) => {
    const target = normalized(value);
    const options = [...element.options];
    return options.find((item) => normalized(item.value) === target || normalized(item.text) === target)
      || options.find((item) => normalized(item.text).includes(target) || target.includes(normalized(item.text)));
  };
  const isBlank = (element) => {
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) return !element.checked;
    if (element instanceof HTMLSelectElement) return !String(element.value || "").trim();
    if (element.isContentEditable) return !String(element.textContent || "").trim();
    return !String(element.value || "").trim();
  };
  const typeInto = async (element, value) => {
    element.focus(); setNativeValue(element, ""); element.dispatchEvent(new Event("input", { bubbles: true }));
    for (const character of String(value)) { element.dispatchEvent(new KeyboardEvent("keydown", { key: character, bubbles: true })); setNativeValue(element, `${element.value}${character}`); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new KeyboardEvent("keyup", { key: character, bubbles: true })); await pause(8); }
    element.dispatchEvent(new Event("change", { bubbles: true })); element.blur();
  };
  let filled = 0;
  for (const candidate of candidates) {
    if (!approved.has(`${candidate.index}:${candidate.key}`)) continue;
    const element = elements[candidate.index];
    if (candidate.requiresManual && !approvedManual.has(candidate.index)) continue;
    if (blankOnly && !isBlank(element)) continue;
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      if (Boolean(candidate.value) !== element.checked) element.click();
    } else if (element instanceof HTMLInputElement && element.type === "radio") {
      const radioText = normalized([element.value, element.closest("label")?.innerText, element.getAttribute("aria-label")].filter(Boolean).join(" "));
      if (radioText.includes(normalized(candidate.value))) element.click();
      else continue;
    } else if ((element.getAttribute("role") === "combobox" || element.getAttribute("aria-haspopup") || element.getAttribute("aria-autocomplete") || element.getAttribute("aria-controls") || element.getAttribute("list")) && !(element instanceof HTMLSelectElement)) {
      if (!await chooseCustomOption(element, candidate.value)) continue;
    } else if (element instanceof HTMLSelectElement) {
      const option = chooseNativeOption(element, candidate.value); if (!option) continue;
      element.focus(); element.value = option.value; element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); element.blur();
    } else if (element.isContentEditable) {
      element.focus(); element.textContent = candidate.value; element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); element.blur();
    } else if (guidedTyping || /date|year|from|to/.test(fieldTextFor(element))) await typeInto(element, candidate.value);
    else { element.focus(); setNativeValue(element, candidate.value); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); element.blur(); }
    filled += 1;
  }
  return filled;
}

async function fillMatches(matches) {
  try {
    const profile = await getApplicationData();
    const guidedTyping = $("#guided-typing").checked;
    const blankOnly = $("#blank-only").checked;
    const safeMatches = matches.map(reviewedMatch).filter((match) => !match.ignored && (!match.sensitive || match.allowManual || match.userConfirmed));
    const matchesByFrame = safeMatches.reduce((groups, match) => { if (!groups.has(match.frameId)) groups.set(match.frameId, []); groups.get(match.frameId).push(match); return groups; }, new Map());
    let count = 0;
    for (const [frameId, frameMatches] of matchesByFrame) {
      const [frameResult] = await runInPage(pageAction, ["fill", profile, frameMatches, guidedTyping, blankOnly], { frameIds: [frameId] });
      count += frameResult.result || 0;
    }
    setStatus(count ? `Filled ${count} field(s). Please review the page before submitting.` : "No fields were changed. The selected field may already contain a value, need manual selection, or be sensitive.");
  } catch (error) {
    setStatus(`Could not fill this page: ${error.message}`);
  }
}

on("#open-profile", "click", () => chrome.tabs.create({ url: chrome.runtime.getURL("profile.html") }));
on("#open-tailor", "click", () => chrome.tabs.create({ url: chrome.runtime.getURL("resume_tailor.html") }));
on("#open-job-finder", "click", () => chrome.tabs.create({ url: chrome.runtime.getURL("job_finder.html") }));
on("#open-settings", "click", () => chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") }));
function selectedReviewMatches() {
  const selected = new Set([...document.querySelectorAll(".match-select:checked")].map((item) => item.dataset.matchId));
  return pendingMatches.map(reviewedMatch).filter((match) => selected.has(match.id));
}
on("#scan", "click", async () => {
  try {
    enableFramesButton.classList.add("hidden");
    embeddedFrameLinks = [];
    ignoredMatchIds = new Set();
    const profile = await getApplicationData();
    currentHost = await getActiveHost();
    currentChoices = applicationChoices(profile);
    if (!Object.values(profile).some((value) => String(value || "").trim())) { setStatus("Your saved profile is empty. Open profile manager, add details, save, then scan again."); return; }
    setStatus("Checking whether the application fields have loaded...");
    const pageFieldProbe = await waitForApplicationFields();
    let frameResults = await runInPage(pageAction, ["scan", profile], { allFrames: true });
    let scan = summarizeFrameResults(frameResults);
    if (scan.total === 0 && scan.frames > 0) {
      await new Promise((resolve) => setTimeout(resolve, pageFieldProbe?.isGreenhouse ? 1500 : 700));
      frameResults = await runInPage(pageAction, ["scan", profile], { allFrames: true });
      scan = summarizeFrameResults(frameResults);
    }
      scan = await applyMappingMemory(scan, profile);
      lastScanMeta = {
        total: scan.total || 0,
        rawTotal: scan.rawTotal || 0,
        matches: scan.matches || [],
        frames: scan.frames || 0,
        frameLinks: scan.frameLinks || [],
        platform: scan.platform || {}
      };
      scannedFields = scan.fields;
    const browserFrameLinks = await getBrowserFrameLinks();
    embeddedFrameLinks = [...new Map([...scan.frameLinks, ...browserFrameLinks].map((frame) => [frame.src, frame])).values()];
      pendingMatches = scan.matches; renderMatches(pendingMatches, scannedFields); updateFillButtons();
      renderScanDiagnostic(scan, pageFieldProbe);
      renderCompatibility(lastScanMeta, pendingMatches, scannedFields);
    await saveScanState();
    const blankUnmatched = scannedFields.filter((field) => field.blank && !pendingMatches.some((match) => match.frameId === field.frameId && match.index === field.index)).length;
    const debugExamples = scan.debug.slice(0, 3).join(" || ") || "no labels available";
    if (pendingMatches.length) setStatus(`Found ${pendingMatches.length} confident match(es) and ${blankUnmatched} additional blank field(s) from ${scan.total} editable field(s). Review matches or enable the click-to-choose helper.`);
    else if (scan.total === 0 && scan.rawTotal > 0) {
      if (embeddedFrameLinks.length) enableFramesButton.classList.remove("hidden");
      setStatus(`Found ${scan.rawTotal} editable-looking field(s), but none passed the scan filter. Examples: ${debugExamples}${embeddedFrameLinks.length ? " A direct form link is available below if these examples are not the application fields." : ""}`);
    }
    else if (scan.total === 0 && scan.frames > 0) {
      if (embeddedFrameLinks.length) {
        enableFramesButton.classList.remove("hidden");
        setStatus(`Found no editable fields and ${scan.frames} embedded frame(s). Click Open embedded form directly below, wait for the new tab to load, then scan that tab. Google proxy and reCAPTCHA frames are ignored.`);
      } else {
        setStatus(pageFieldProbe?.isGreenhouse ? `Greenhouse page detected, but the main page exposed ${pageFieldProbe.count || 0} editable field(s) to the extension after waiting. Examples: ${(pageFieldProbe.first || []).slice(0, 3).join(" || ") || "none"}. Try refreshing the Greenhouse tab once, wait until First Name is visible, then scan again.` : `Found no editable fields and ${scan.frames} embedded frame(s), but only proxy/protection frames were exposed. This page may need the main form to finish loading before scanning.`);
      }
    }
    else if (scan.total === 0) setStatus("Found no visible form fields. Continue to the application form, then scan again.");
    else setStatus(`Found ${scan.total} editable field(s) but no confident matches. The page may use unknown labels, or your profile may not contain values for these fields. Examples: ${scan.unmatched.slice(0, 3).join(" | ") || "no labels available"}`);
  } catch (error) { setStatus(`Could not scan this page: ${error.message}`); }
});
on(aiScanButton, "click", async () => {
  try {
    if (!scannedFields.length) {
      setStatus("Scan this page first, then ask local AI to improve the unmatched fields.");
      return;
    }
    const startedAt = performance.now();
    aiScanButton.disabled = true;
    aiScanButton.textContent = "Improving scan with local AI...";
    setStatus("Preparing compact page data for local AI...");
    const profile = await getApplicationData();
    currentHost = await getActiveHost();
    currentChoices = applicationChoices(profile);
    const added = await improveMatchesWithLocalAi(profile, (message) => setStatus(message));
    for (const match of added) {
      const index = pendingMatches.findIndex((pending) => `${pending.frameId}:${pending.index}` === `${match.frameId}:${match.index}`);
      if (index >= 0) pendingMatches[index] = match;
      else pendingMatches.push(match);
    }
    renderMatches(pendingMatches, scannedFields);
    updateFillButtons();
    await saveScanState();
    setStatus(added.length ? `Local AI added ${added.length} confident match(es) in ${((performance.now() - startedAt) / 1000).toFixed(1)}s. Review the list before filling.` : `Local AI did not find additional confident matches after ${((performance.now() - startedAt) / 1000).toFixed(1)}s. Fill the remaining fields manually.`);
  } catch (error) {
    setStatus(`Local AI page scan failed: ${error.message}`);
  } finally {
    aiScanButton.disabled = false;
    aiScanButton.textContent = "Improve scan with local AI";
  }
});
aiVisualScanButton?.addEventListener("click", async () => {
  try {
    if (!scannedFields.length) {
      setStatus("Scan this page first, then use AI vision to improve the detected fields.");
      return;
    }
    const startedAt = performance.now();
    aiVisualScanButton.disabled = true;
    aiVisualScanButton.textContent = "Improving scan visually...";
    const profile = await getApplicationData();
    currentHost = await getActiveHost();
    currentChoices = applicationChoices(profile);
    const added = await improveMatchesWithVisionAi(profile, (message) => setStatus(message));
    for (const match of added) {
      const index = pendingMatches.findIndex((pending) => `${pending.frameId}:${pending.index}` === `${match.frameId}:${match.index}`);
      if (index >= 0) pendingMatches[index] = match;
      else pendingMatches.push(match);
    }
    renderMatches(pendingMatches, scannedFields);
    updateFillButtons();
    await saveScanState();
    setStatus(added.length ? `AI vision added ${added.length} match(es) in ${((performance.now() - startedAt) / 1000).toFixed(1)}s. Review before filling.` : `AI vision did not add confident matches after ${((performance.now() - startedAt) / 1000).toFixed(1)}s.`);
  } catch (error) {
    setStatus(`AI vision scan failed: ${error.message}`);
  } finally {
    aiVisualScanButton.disabled = false;
    aiVisualScanButton.textContent = "Improve scan with AI vision";
  }
});
async function setFieldPickerMode(action = "toggle-picker", quiet = false) {
  try {
    const profile = await getApplicationData();
    const frameResults = await runInPage(pageAction, [action, profile], { allFrames: true });
    const enabled = frameResults.some((frame) => frame.result?.enabled);
    fieldPickerButton.textContent = enabled ? "Disable click-to-choose helper" : "Enable click-to-choose helper";
    if (!quiet) setStatus(enabled ? "Click-to-choose helper enabled. Click an editable field on the application page, then select a profile value from the nearby panel." : "Click-to-choose helper disabled.");
    return enabled;
  } catch (error) {
    if (!quiet) setStatus(`Could not toggle click-to-choose helper: ${error.message}`);
    return false;
  }
}
on(fieldPickerButton, "click", async () => {
  await setFieldPickerMode("toggle-picker");
});
popupSwitchProfileButton?.addEventListener("click", async () => {
  try {
    await switchPopupProfile(popupProfileSelect?.value || "");
  } catch (error) {
    setStatus(`Could not switch profile: ${error.message}`);
  }
});
on(fillHighConfidenceButton, "click", async () => {
  await fillMatches(reviewBuckets().highConfidence);
});
on(fillSelectedButton, "click", async () => {
  await fillMatches(selectedReviewMatches());
});
on(fillButton, "click", async () => {
  await fillMatches(reviewBuckets().highConfidence);
});
on(clearPageButton, "click", async () => {
  if (!confirm("Clear all visible editable fields on this application page? Your saved profile will not be changed.")) return;
  try {
    const profile = await getApplicationData();
    const frameResults = await runInPage(pageAction, ["clear", profile], { allFrames: true });
    const count = frameResults.reduce((total, frame) => total + (frame.result || 0), 0);
    pendingMatches = [];
    scannedFields = [];
    ignoredMatchIds = new Set();
    renderMatches([], []);
    scanDiagnostic?.classList.add("hidden");
    updateFillButtons();
    await clearScanState();
    setStatus(`Cleared ${count} visible field(s). Your saved profile was not changed.`);
  } catch (error) {
    setStatus(`Could not clear this page: ${error.message}`);
  }
});
on(diagnosticsButton, "click", async () => {
  try {
    diagnosticsButton.disabled = true;
    diagnosticsButton.textContent = "Copying diagnostic report...";
    const profile = await getApplicationData();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const frameResults = await runInPage(pageAction, ["diagnose", profile], { allFrames: true });
    const report = {
      tool: "Job Application Helper scan diagnostic",
      version: chrome.runtime.getManifest().version,
      activeTab: { url: tab?.url || "", title: tab?.title || "" },
      capturedAt: new Date().toISOString(),
      note: "Profile values are intentionally omitted. Field labels, attributes, frame info, and matched profile keys are included for debugging scan quality.",
      frames: frameResults.map((frame) => ({ frameId: frame.frameId, result: frame.result || null, error: frame.error?.message || "" }))
    };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setStatus("Copied scan diagnostic report. Paste it to me and I can improve scan rules much faster.");
  } catch (error) {
    setStatus(`Could not copy diagnostic report: ${error.message}`);
  } finally {
    diagnosticsButton.disabled = false;
    diagnosticsButton.textContent = "Copy scan diagnostic report";
  }
});
on(enableFramesButton, "click", async () => {
  const link = embeddedFrameLinks.find((frame) => /^https?:\/\//i.test(frame.src));
  if (!link) {
    setStatus("No direct embedded form URL was found. Open the application form directly from the site if possible.");
    return;
  }
  await chrome.tabs.create({ url: link.src });
  setStatus("Opened the embedded form in a new tab. Scan that tab after it loads.");
});
modeBasicButton?.addEventListener("click", () => applyUxMode("basic"));
modeAdvancedButton?.addEventListener("click", () => applyUxMode("advanced"));
dismissOnboardingButton?.addEventListener("click", async () => {
  onboardingCard?.classList.add("hidden");
  await chrome.storage.local.set({ jahOnboardingDone: true });
});
on(repairHelperButton, "click", async () => {
  pendingMatches = [];
  scannedFields = [];
  ignoredMatchIds = new Set();
  lastScanMeta = {};
  renderMatches([], []);
  scanDiagnostic?.classList.add("hidden");
  await clearScanState();
  await setFieldPickerMode("disable-picker", true);
  updateFillButtons();
  setStatus("Repaired temporary helper state for this page. Your profile and saved corrections were not changed.");
});

initUxMode();
loadScanState();
renderPopupProfileSwitcher();

if (new URLSearchParams(location.search).get("floating") === "1") {
  setFieldPickerMode("enable-picker", true);
}
