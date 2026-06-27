function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function collectMatches(text, patterns, limit = 6) {
  const matches = [];
  for (const { label, pattern } of patterns) {
    if (pattern.test(text)) matches.push(label);
    if (matches.length >= limit) break;
  }
  return matches;
}

const BLOCKING_PATTERNS = [
  { label: "Requires US citizenship", pattern: /\b(?:u\.?s\.?|united states)\s+citizens?(?:hip)?\b|\bmust be (?:a )?(?:u\.?s\.?|united states) citizen\b|\bcitizenship required\b|\bonly (?:u\.?s\.?|united states) citizens\b/i },
  { label: "Requires security clearance or public trust", pattern: /\b(?:security clearance|active clearance|secret clearance|top secret|ts\/sci|public trust|dod clearance)\b/i },
  { label: "Clearly says no visa sponsorship", pattern: /\b(?:no|cannot|can't|will not|won't|unable to)\s+(?:provide|offer|support|sponsor|transfer|consider)?\s*(?:visa\s*)?sponsorship\b|\b(?:does not|do not|not)\s+(?:provide|offer|support|sponsor|transfer|consider)\s+(?:visa\s*)?sponsorship\b|\b(?:visa\s*)?sponsorship\s+(?:is\s+)?(?:not available|unavailable|not provided|not offered|not supported)\b/i },
  { label: "Requires work authorization without sponsorship", pattern: /\b(?:authorized|eligible|permission)\s+to\s+work\s+(?:in\s+)?(?:the\s+)?(?:u\.?s\.?|united states)\s+without\s+(?:current\s+or\s+future\s+)?(?:visa\s*)?sponsorship\b/i },
  { label: "Rejects applicants needing sponsorship", pattern: /\b(?:applicants|candidates|individuals)\s+(?:who\s+)?(?:require|need|needing|requiring)\s+(?:current\s+or\s+future\s+)?(?:visa\s*)?sponsorship\s+(?:will\s+)?(?:not be considered|be ineligible|are ineligible)\b|\bmust\s+not\s+(?:require|need)\s+(?:current\s+or\s+future\s+)?(?:visa\s*)?sponsorship\b/i },
  { label: "Says no sponsorship now or in the future", pattern: /\b(?:now\s+or\s+in\s+the\s+future|currently\s+or\s+in\s+the\s+future|present\s+or\s+future)\b.{0,90}\b(?:sponsorship|sponsor|visa)\b|\b(?:sponsorship|sponsor|visa)\b.{0,90}\b(?:now\s+or\s+in\s+the\s+future|currently\s+or\s+in\s+the\s+future|present\s+or\s+future)\b/i },
  { label: "Requires permanent unrestricted work authorization", pattern: /\b(?:permanent|unrestricted)\s+(?:u\.?s\.?\s+)?work authorization\b|\bmust\s+be\s+(?:permanently\s+)?authorized\s+to\s+work\b/i }
];

const REVIEW_PATTERNS = [
  { label: "Mentions work authorization", pattern: /\b(?:work authorization|authorized to work|eligible to work|legally authorized|employment authorization|i-9|e-verify)\b/i },
  { label: "Mentions sponsorship", pattern: /\b(?:sponsorship|visa sponsor|sponsor visa|h-?1b|h1b|cpt|opt|stem opt|f-?1)\b/i },
  { label: "Mentions immigration or export-control restriction", pattern: /\b(?:export control|itar|ear|immigration status|visa status)\b/i }
];

const POSITIVE_PATTERNS = [
  { label: "Visa sponsorship appears available", pattern: /\b(?:visa\s*)?sponsorship\s+(?:is\s+)?(?:available|provided|offered|considered|supported)\b|\b(?:we|company|employer)\s+(?:can|will|may)\s+sponsor\b/i },
  { label: "OPT/CPT or student work authorization appears acceptable", pattern: /\b(?:opt|stem opt|cpt|f-?1)\s+(?:welcome|accepted|eligible|considered|supported)\b/i },
  { label: "Does not require sponsorship", pattern: /\bdoes not require sponsorship\b|\bwill not require sponsorship\b/i }
];

export function analyzeSponsorshipText(input = {}) {
  const text = normalizeText([
    input.title,
    input.company,
    input.location,
    input.description,
    input.jd,
    ...(input.tags || [])
  ].filter(Boolean).join("\n"));
  if (!text) {
    return {
      risk: "unknown",
      status: "unknown",
      disqualifying: false,
      concerns: ["No JD text available to check sponsorship."],
      positive_signals: [],
      matched_phrases: [],
      summary: "Sponsorship risk unknown because no job text was available.",
      action: "Review the application page or company careers page before applying."
    };
  }

  const blocking = collectMatches(text, BLOCKING_PATTERNS);
  const positive = collectMatches(text, POSITIVE_PATTERNS);
  const review = collectMatches(text, REVIEW_PATTERNS);

  if (blocking.length) {
    return {
      risk: "high",
      status: "likely_blocked",
      disqualifying: true,
      concerns: blocking,
      positive_signals: positive,
      matched_phrases: [...blocking, ...positive].slice(0, 8),
      summary: `Likely blocked for F-1 OPT / future sponsorship: ${blocking.join("; ")}.`,
      action: "Skip or verify with the recruiter before spending time tailoring."
    };
  }

  if (positive.length) {
    return {
      risk: "low",
      status: "likely_ok",
      disqualifying: false,
      concerns: review.filter((item) => !/sponsorship/i.test(item)),
      positive_signals: positive,
      matched_phrases: [...positive, ...review].slice(0, 8),
      summary: `Sponsorship looks potentially acceptable: ${positive.join("; ")}.`,
      action: "Still confirm details if the application asks work-authorization questions."
    };
  }

  if (review.length) {
    return {
      risk: "medium",
      status: "needs_review",
      disqualifying: false,
      concerns: review,
      positive_signals: [],
      matched_phrases: review,
      summary: `Needs review: ${review.join("; ")}.`,
      action: "Answer work-authorization questions manually and verify sponsorship language."
    };
  }

  return {
    risk: "unknown",
    status: "unknown",
    disqualifying: false,
    concerns: ["No explicit sponsorship, citizenship, or clearance language found."],
    positive_signals: [],
    matched_phrases: [],
    summary: "Sponsorship risk unknown because the JD does not say either way.",
    action: "Proceed only after reviewing application questions; ask recruiter if unclear."
  };
}

export function sponsorshipStatusLabel(filter = {}) {
  const status = filter.status || "unknown";
  if (status === "likely_blocked") return "Likely blocked";
  if (status === "likely_ok") return "Likely OK";
  if (status === "needs_review") return "Needs review";
  return "Unknown";
}
