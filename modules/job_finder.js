import { generateHeuristicKeywords, profileText } from "./resume_parser.js";
import { scoreJob, scoreJobsWithLocalAi, visaRiskForJob } from "./job_scorer.js";

export const PUBLIC_JOB_SOURCES = [
  {
    id: "remotive",
    name: "Remotive public API",
    buildUrl: (query) => `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`,
    normalize: (payload) => (payload.jobs || []).map((job) => ({
      id: `remotive:${job.id}`,
      title: job.title || "",
      company: job.company_name || "",
      location: job.candidate_required_location || "Remote",
      description: stripHtml(job.description || ""),
      url: job.url || "",
      source: "Remotive",
      posted: job.publication_date || "",
      date_found: new Date().toISOString(),
      salary: job.salary || "",
      tags: [job.category, job.job_type].filter(Boolean)
    }))
  },
  {
    id: "arbeitnow",
    name: "Arbeitnow public API",
    buildUrl: () => "https://www.arbeitnow.com/api/job-board-api",
    normalize: (payload) => (payload.data || []).map((job) => ({
      id: `arbeitnow:${job.slug || job.url}`,
      title: job.title || "",
      company: job.company_name || "",
      location: (job.location || "Remote").toString(),
      description: stripHtml(job.description || ""),
      url: job.url || "",
      source: "Arbeitnow",
      posted: job.created_at ? new Date(Number(job.created_at) * 1000).toISOString() : "",
      date_found: new Date().toISOString(),
      salary: "",
      tags: [...(job.tags || []), ...(job.job_types || [])].filter(Boolean)
    }))
  }
];

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = `${job.title}|${job.company}|${job.url}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return job.title && job.url;
  });
}

function boardSourceFromLine(line) {
  const text = String(line || "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const slugFromUrl = (pattern) => text.match(pattern)?.[1]?.replace(/\/$/, "");
  if (lower.startsWith("greenhouse:")) return { type: "greenhouse", slug: text.split(":").slice(1).join(":").trim() };
  if (lower.startsWith("lever:")) return { type: "lever", slug: text.split(":").slice(1).join(":").trim() };
  if (lower.startsWith("ashby:")) return { type: "ashby", slug: text.split(":").slice(1).join(":").trim() };
  if (/greenhouse\.io/i.test(text)) return { type: "greenhouse", slug: slugFromUrl(/(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)/i) };
  if (/jobs\.lever\.co/i.test(text)) return { type: "lever", slug: slugFromUrl(/jobs\.lever\.co\/([^/?#]+)/i) };
  if (/jobs\.ashbyhq\.com/i.test(text)) return { type: "ashby", slug: slugFromUrl(/jobs\.ashbyhq\.com\/([^/?#]+)/i) };
  return null;
}

function normalizeGreenhouse(payload, slug) {
  return (payload.jobs || []).map((job) => ({
    id: `greenhouse:${slug}:${job.id}`,
    title: job.title || "",
    company: slug,
    location: (job.location?.name || job.offices?.map((office) => office.name).join(", ") || "Unspecified").toString(),
    description: stripHtml(job.content || ""),
    url: job.absolute_url || "",
    source: "Greenhouse",
    posted: job.updated_at || "",
    date_found: new Date().toISOString(),
    salary: "",
    tags: [job.department?.name].filter(Boolean)
  }));
}

function normalizeLever(payload, slug) {
  return (payload || []).map((job) => ({
    id: `lever:${slug}:${job.id}`,
    title: job.text || "",
    company: slug,
    location: job.categories?.location || "Unspecified",
    description: stripHtml(job.descriptionPlain || job.description || ""),
    url: job.hostedUrl || job.applyUrl || "",
    source: "Lever",
    posted: job.createdAt ? new Date(Number(job.createdAt)).toISOString() : "",
    date_found: new Date().toISOString(),
    salary: "",
    tags: [job.categories?.team, job.categories?.commitment].filter(Boolean)
  }));
}

function normalizeAshby(payload, slug) {
  return (payload.jobs || []).filter((job) => job.isListed !== false).map((job) => ({
    id: `ashby:${slug}:${job.id}`,
    title: job.title || "",
    company: slug,
    location: (job.location || job.locationName || "Unspecified").toString(),
    description: stripHtml(job.descriptionHtml || job.descriptionPlain || ""),
    url: job.jobUrl || job.applyUrl || `https://jobs.ashbyhq.com/${slug}/${job.id}`,
    source: "Ashby",
    posted: job.publishedAt || "",
    date_found: new Date().toISOString(),
    salary: job.compensationTierSummary || "",
    tags: [job.department, job.employmentType].filter(Boolean)
  }));
}

async function fetchBoardJobs(lines = [], onProgress = () => {}) {
  const jobs = [];
  for (const line of lines) {
    const source = boardSourceFromLine(line);
    if (!source?.slug) continue;
    try {
      onProgress(`Searching ${source.type} board: ${source.slug}...`);
      if (source.type === "greenhouse") {
        jobs.push(...normalizeGreenhouse(await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.slug)}/jobs?content=true`), source.slug));
      }
      if (source.type === "lever") {
        jobs.push(...normalizeLever(await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(source.slug)}?mode=json`), source.slug));
      }
      if (source.type === "ashby") {
        jobs.push(...normalizeAshby(await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.slug)}`), source.slug));
      }
    } catch (error) {
      onProgress(`${source.type} board ${source.slug} skipped: ${error.message}`);
    }
  }
  return jobs;
}

function parseLooseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw error;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const text = await response.text();
  return parseLooseJson(text);
}

function normalized(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
}

function salaryNumbers(job) {
  const salaryText = String(job.salary || "");
  const description = String(job.description || "");
  const snippets = salaryText ? [salaryText] : [];
  const salarySnippetPattern = /(salary|compensation|pay range|base pay|annual pay|hourly pay|hourly rate|rate)[\s\S]{0,160}/gi;
  for (const match of description.matchAll(salarySnippetPattern)) snippets.push(match[0]);
  const moneyPattern = /(\$?\s*\d{2,3}(?:[,.]\d{3})?\s*(?:k|K|000)?|\$\s*\d{1,3})(?:\s*(?:-|to|–|—)\s*(\$?\s*\d{2,3}(?:[,.]\d{3})?\s*(?:k|K|000)?|\$\s*\d{1,3}))?/g;
  const values = [];

  const parseAmount = (raw, context) => {
    const text = String(raw || "").trim();
    const hasCurrency = text.includes("$");
    const hasK = /k|K|000/.test(text);
    const digits = Number(text.replace(/[$,\s]/g, "").replace(/k/i, ""));
    if (!digits) return null;
    let amount = digits;
    if (/k/i.test(text)) amount *= 1000;
    if (/000/.test(text) && !/,/.test(text)) amount *= 1000;
    if (!hasCurrency && !hasK && amount < 1000) return null;
    if (hasCurrency && amount < 200 && /\b(hour|hourly|hr)\b/i.test(context)) amount *= 2080;
    if (amount < 1000 && (hasCurrency || hasK)) amount *= 1000;
    return amount;
  };

  for (const snippet of snippets) {
    for (const match of snippet.matchAll(moneyPattern)) {
      const first = parseAmount(match[1], snippet);
      const second = parseAmount(match[2], snippet);
      if (first) values.push(first);
      if (second) values.push(second);
    }
  }
  return values.filter((value) => value >= 20000 && value <= 400000);
}

function matchesSalary(job, filters = {}) {
  const min = Number(filters.salaryMin || 0);
  const max = Number(filters.salaryMax || 0);
  if (!min && !max) return true;
  const values = salaryNumbers(job);
  if (!values.length) return true;
  const jobMin = Math.min(...values);
  const jobMax = Math.max(...values);
  const desiredMin = min || 0;
  const desiredMax = max || Infinity;
  return jobMax >= desiredMin && jobMin <= desiredMax;
}

function matchesFilters(job, filters = {}) {
  const locations = (filters.locations || (filters.location ? [filters.location] : [])).map(normalized).filter(Boolean);
  const types = (filters.jobTypes || (filters.jobType ? [filters.jobType] : [])).map(normalized).filter(Boolean);
  const jobLocation = normalized(job.location);
  const jobText = normalized(`${job.title} ${job.company} ${job.location} ${(job.tags || []).join(" ")} ${job.description}`);
  const matchesLocation = (location) => {
    if (location === "remote") return /remote|anywhere|worldwide|work from home/.test(jobText);
    if (location === "bay area") return /bay area|san francisco|sf bay|san jose|oakland|palo alto|menlo park|mountain view|sunnyvale|santa clara|redwood city|san mateo/.test(jobText);
    if (location === "united states") return /united states|usa|\bus\b|u s|america|remote/.test(jobText);
    if (location === "new york") return /new york|\bny\b|nyc/.test(jobText);
    if (location === "new jersey") return /new jersey|\bnj\b|jersey city|newark/.test(jobText);
    return jobLocation.includes(location) || jobText.includes(location);
  };
  const locationOk = !locations.length || locations.some(matchesLocation);
  const matchesType = (type) => jobText.includes(type) ||
    (type === "full time" && /full time|fulltime|permanent/.test(jobText)) ||
    (type === "part time" && /part time|parttime/.test(jobText)) ||
    (type === "internship" && /intern|internship/.test(jobText)) ||
    (type === "contract" && /contract|contractor|freelance/.test(jobText));
  const typeOk = !types.length || types.some(matchesType);
  const visa = visaRiskForJob(job);
  return locationOk && typeOk && matchesSalary(job, filters) && !visa.disqualifying;
}

export async function generateKeywords(bundle, ollamaRequest = null) {
  const fallback = generateHeuristicKeywords(bundle);
  const model = bundle?.ollamaModel;
  if (!model || !ollamaRequest) return fallback;
  const schema = {
    type: "object",
    properties: {
      keywords: { type: "array", items: { type: "string" } }
    },
    required: ["keywords"]
  };
  const prompt = [
    "/no_think",
    "Generate concise job search keywords from this candidate profile. Return JSON only.",
    "Include role titles, core skills/tools, and job families. Avoid private personal data, schools, addresses, emails, and phone numbers.",
    "Return 8 to 14 search keywords, each 1 to 4 words.",
    `Profile:\n${profileText(bundle).slice(0, 4000)}`
  ].join("\n\n");
  try {
    const result = await ollamaRequest("chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, format: schema, messages: [{ role: "user", content: prompt }], options: { temperature: 0.2, num_ctx: 4096 } })
    });
    const parsed = JSON.parse(result.message?.content || "{}");
    const aiKeywords = (parsed.keywords || []).map((item) => String(item || "").trim()).filter(Boolean);
    return [...new Set([...aiKeywords, ...fallback])].slice(0, 14);
  } catch {
    return fallback;
  }
}

export async function searchJobs({ bundle, keywords, filters = {}, boardSources = [], sources = PUBLIC_JOB_SOURCES, maxPerSource = 40, useAiScoring = false, ollamaRequest = null, onProgress = () => {} }) {
  const searchTerms = (keywords || []).filter(Boolean).slice(0, 5);
  const jobs = [];
  for (const source of sources) {
    try {
      onProgress(`Searching ${source.name}...`);
      if (source.id === "arbeitnow") {
        const payload = await fetchJson(source.buildUrl(""));
        jobs.push(...source.normalize(payload).slice(0, maxPerSource));
      } else {
        for (const term of searchTerms.length ? searchTerms : ["remote"]) {
          const payload = await fetchJson(source.buildUrl(term));
          jobs.push(...source.normalize(payload).slice(0, maxPerSource));
        }
      }
    } catch (error) {
      onProgress(`${source.name} skipped: ${error.message}`);
    }
  }
  jobs.push(...await fetchBoardJobs(boardSources, onProgress));
  const scored = uniqueJobs(jobs).filter((job) => matchesFilters(job, filters)).map((job) => ({ ...job, ...scoreJob(job, bundle, keywords) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);
  if (!useAiScoring) return scored;
  onProgress("Refining top matches with local AI...");
  try {
    return (await scoreJobsWithLocalAi(scored, bundle, keywords, ollamaRequest)).sort((a, b) => b.score - a.score);
  } catch (error) {
    onProgress(`Local AI scoring returned invalid JSON, using normal scores instead: ${error.message}`);
    return scored;
  }
}
