import { getStoredProfileBundle, hasProfileData, saveReviewedJobs } from "./modules/profile_store.js";
import { generateKeywords, searchJobs } from "./modules/job_finder.js";
import { exportJobsCsv, exportJobsExcel } from "./modules/export_tracker.js";
import { openApplicationHelperForJob, APPLICATION_SAFETY_NOTE } from "./modules/application_helper.js";

const $ = (selector) => document.querySelector(selector);
function on(selector, eventName, handler, options) {
  const element = typeof selector === "string" ? $(selector) : selector;
  if (!element) {
    console.warn(`Job Finder: missing element for ${eventName}: ${selector}`);
    return null;
  }
  element.addEventListener(eventName, handler, options);
  return element;
}
const status = $("#job-status");
const results = $("#job-results");
let currentBundle = null;
let currentJobs = [];

function setStatus(message) {
  if (status) status.textContent = message;
}

async function ollamaRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`http://localhost:11434/api/${path}`, { signal: AbortSignal.timeout(300000), ...options });
  } catch {
    throw new Error("Could not connect to Ollama. Job Finder will use the non-AI fallback.");
  }
  if (response.status === 403) throw new Error("Ollama blocked this extension. Restart Ollama after setting OLLAMA_ORIGINS=chrome-extension://*.");
  if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);
  return response.json();
}

function parseKeywords() {
  return $("#keywords").value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function parseCompanyBoards() {
  return $("#company-boards").value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function searchFilters() {
  const locations = [...document.querySelectorAll('input[name="job-location"]:checked')].map((item) => item.value);
  const customLocation = $("#job-location-custom").value.trim();
  if (customLocation) locations.push(customLocation);
  return {
    locations,
    jobTypes: [...document.querySelectorAll('input[name="job-type"]:checked')].map((item) => item.value),
    salaryMin: Number($("#salary-min").value || 0),
    salaryMax: Number($("#salary-max").value || 0)
  };
}

function renderJobs(jobs) {
  currentJobs = jobs;
  results.replaceChildren();
  if (!jobs.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No matched jobs yet.";
    results.append(empty);
    return;
  }
  for (const job of jobs) {
    const card = document.createElement("article");
    card.className = "job-card";
    const review = document.createElement("input");
    review.type = "checkbox";
    review.dataset.jobId = job.id;
    review.checked = Boolean(job.reviewed);
    const title = document.createElement("h3");
    title.textContent = `${job.score}/100 - ${job.title} (${job.recommendation || "maybe"})`;
    const meta = document.createElement("p");
    meta.className = "muted small";
    meta.textContent = `${job.company || "Unknown company"} | ${job.location || "Unknown location"} | ${job.source} | visa risk: ${job.visa_risk || "unknown"}${job.salary ? ` | salary: ${job.salary}` : ""}${job.date_found ? ` | found: ${String(job.date_found).slice(0, 10)}` : ""}`;
    const reasons = document.createElement("p");
    reasons.textContent = (job.reasons || []).join("; ");
    const concerns = document.createElement("p");
    concerns.className = "muted small";
    concerns.textContent = (job.concerns || []).length ? `Concerns: ${(job.concerns || []).join("; ")}` : "No major concerns detected.";
    const explanation = document.createElement("p");
    explanation.className = "muted small";
    explanation.textContent = job.score_explanation || "";
    const prep = document.createElement("details");
    prep.className = "legacy-summary";
    const prepSummary = document.createElement("summary");
    prepSummary.textContent = job.application_prep ? "High-score application prep" : "Application prep";
    const prepText = document.createElement("div");
    prepText.className = "muted small";
    if (job.application_prep) {
      const section = (heading, lines) => {
        const strong = document.createElement("strong");
        strong.textContent = heading;
        prepText.append(strong, document.createElement("br"));
        for (const line of lines) {
          const item = document.createElement("span");
          item.textContent = `- ${line}`;
          prepText.append(item, document.createElement("br"));
        }
        prepText.append(document.createElement("br"));
      };
      section("Resume bullet suggestions", job.application_prep.resume_bullets || []);
      const coverHeading = document.createElement("strong");
      coverHeading.textContent = "Cover letter draft";
      const cover = document.createElement("p");
      cover.textContent = job.application_prep.cover_letter || "";
      prepText.append(coverHeading, cover);
      section("Interview talking points", job.application_prep.interview_talking_points || []);
    } else {
      prepText.textContent = "Generated only for jobs scoring above 80.";
    }
    prep.append(prepSummary, prepText);
    const open = document.createElement("button");
    open.className = "secondary compact";
    open.type = "button";
    open.textContent = "Review job";
    open.addEventListener("click", () => openApplicationHelperForJob(job));
    const row = document.createElement("div");
    row.className = "job-card-actions";
    const label = document.createElement("label");
    label.className = "check-row";
    label.append(review, document.createTextNode(" Reviewed"));
    row.append(label, open);
    card.append(title, meta, reasons, concerns, explanation, prep, row);
    results.append(card);
  }
}

async function loadBundle() {
  currentBundle = await getStoredProfileBundle();
  if (!hasProfileData(currentBundle)) {
    setStatus("Your saved profile is empty. Open Profile Manager, import a resume, then come back.");
  } else {
    setStatus(`Profile loaded. ${APPLICATION_SAFETY_NOTE}`);
  }
}

on("#generate-keywords", "click", async () => {
  try {
    await loadBundle();
    if (!hasProfileData(currentBundle)) return;
    setStatus($("#use-ai-keywords").checked ? "Generating keywords from profile with local AI when available..." : "Generating keywords from profile...");
    const keywords = await generateKeywords(currentBundle, $("#use-ai-keywords").checked ? ollamaRequest : null);
    $("#keywords").value = keywords.join(", ");
    setStatus(`Generated ${keywords.length} keyword(s). Review or edit them, then search jobs.`);
  } catch (error) {
    setStatus(`Could not generate keywords: ${error.message}`);
  }
});

on("#search-jobs", "click", async () => {
  try {
    await loadBundle();
    if (!hasProfileData(currentBundle)) return;
    const keywords = parseKeywords();
    if (!keywords.length) {
      setStatus("Generate or type search keywords first.");
      return;
    }
    $("#search-jobs").disabled = true;
    setStatus("Searching public job sources...");
    const jobs = await searchJobs({
      bundle: currentBundle,
      keywords,
      filters: searchFilters(),
      boardSources: parseCompanyBoards(),
      useAiScoring: $("#use-ai-scoring").checked,
      ollamaRequest,
      onProgress: setStatus
    });
    renderJobs(jobs);
    const filters = searchFilters();
    const filterText = [
      filters.locations.length && `location: ${filters.locations.join(" / ")}`,
      filters.jobTypes.length && `type: ${filters.jobTypes.join(" / ")}`,
      (filters.salaryMin || filters.salaryMax) && `salary: ${filters.salaryMin || "any"}-${filters.salaryMax || "any"}`
    ].filter(Boolean).join(", ");
    setStatus(`Found and scored ${jobs.length} job(s)${filterText ? ` for ${filterText}` : ""}. Review them before opening any application.`);
  } catch (error) {
    setStatus(`Could not search jobs: ${error.message}`);
  } finally {
    $("#search-jobs").disabled = false;
  }
});

on("#save-reviewed", "click", async () => {
  const reviewedIds = new Set([...document.querySelectorAll("[data-job-id]:checked")].map((item) => item.dataset.jobId));
  const reviewed = currentJobs.filter((job) => reviewedIds.has(job.id)).map((job) => ({ ...job, reviewed: true, reviewedAt: new Date().toISOString() }));
  await saveReviewedJobs(reviewed);
  setStatus(`Saved ${reviewed.length} reviewed job(s).`);
});

on("#export-csv", "click", () => exportJobsCsv(currentJobs));
on("#export-excel", "click", () => exportJobsExcel(currentJobs));

loadBundle();
renderJobs([]);
