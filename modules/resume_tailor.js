import { runJsonAi, runVisionJsonAi } from "./ai_client.js";
import { analyzeSponsorshipText, sponsorshipStatusLabel } from "./visa_filter.js";

export function compactProfileBundle(profile = {}, details = {}) {
  return {
    contact: {
      name: profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" "),
      location: [profile.city, profile.state, profile.country].filter(Boolean).join(", "),
      linkedin: profile.linkedin || "",
      portfolio: profile.portfolio || "",
      github: profile.github || ""
    },
    professional: {
      summary: profile.professionalSummary || "",
      desiredTitle: profile.desiredTitle || "",
      currentTitle: profile.currentTitle || "",
      currentCompany: profile.currentCompany || "",
      yearsExperience: profile.yearsExperience || "",
      skills: profile.skills || "",
      skillsAndTools: (details.skillsAndTools || []).map((item) => item.name || item).filter(Boolean)
    },
    education: details.educationEntries || [],
    work: details.experienceEntries || [],
    projects: details.projectEntries || [],
    certifications: details.certificationEntries || [],
    languages: details.languageEntries || [],
    constraints: {
      workAuthorization: profile.workAuthorization || "",
      sponsorship: profile.sponsorship || "",
      visaStatus: profile.visaStatus || ""
    }
  };
}

export function tailorSchema() {
  return {
    name: "resume_tailor_result",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        job: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            company: { type: "string" },
            location: { type: "string" },
            salary: { type: "string" }
          },
          required: ["title", "company", "location", "salary"]
        },
        match: {
          type: "object",
          additionalProperties: false,
          properties: {
            score: { type: "number" },
            recommendation: { type: "string" },
            summary: { type: "string" },
            strengths: { type: "array", items: { type: "string" } },
            gaps: { type: "array", items: { type: "string" } },
            visa_risk: { type: "string" }
          },
          required: ["score", "recommendation", "summary", "strengths", "gaps", "visa_risk"]
        },
        sponsorship_filter: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string" },
            risk: { type: "string" },
            disqualifying: { type: "boolean" },
            summary: { type: "string" },
            concerns: { type: "array", items: { type: "string" } },
            positive_signals: { type: "array", items: { type: "string" } },
            action: { type: "string" }
          },
          required: ["status", "risk", "disqualifying", "summary", "concerns", "positive_signals", "action"]
        },
        jd_keywords: { type: "array", items: { type: "string" } },
        ats_keywords_covered: { type: "array", items: { type: "string" } },
        ats_keywords_to_consider: { type: "array", items: { type: "string" } },
        missing_do_not_claim: { type: "array", items: { type: "string" } },
        tailored_summary: { type: "string" },
        skills_order: { type: "array", items: { type: "string" } },
        bullet_suggestions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              section: { type: "string" },
              source: { type: "string" },
              original: { type: "string" },
              suggested: { type: "string" },
              jd_keyword: { type: "string" },
              evidence: { type: "string" },
              risk: { type: "string" },
              reason: { type: "string" }
            },
            required: ["id", "section", "source", "original", "suggested", "jd_keyword", "evidence", "risk", "reason"]
          }
        },
        cover_letter_draft: { type: "string" },
        interview_talking_points: { type: "array", items: { type: "string" } },
        final_checklist: { type: "array", items: { type: "string" } }
      },
      required: ["job", "match", "sponsorship_filter", "jd_keywords", "ats_keywords_covered", "ats_keywords_to_consider", "missing_do_not_claim", "tailored_summary", "skills_order", "bullet_suggestions", "cover_letter_draft", "interview_talking_points", "final_checklist"]
    }
  };
}

function mergeSponsorshipFilter(analysis, deterministicFilter) {
  const result = analysis || {};
  const aiFilter = result.sponsorship_filter || {};
  const merged = {
    status: deterministicFilter.status || aiFilter.status || "unknown",
    risk: deterministicFilter.risk || aiFilter.risk || "unknown",
    disqualifying: Boolean(deterministicFilter.disqualifying || aiFilter.disqualifying),
    summary: deterministicFilter.summary || aiFilter.summary || "Sponsorship risk unknown.",
    concerns: [...new Set([...(deterministicFilter.concerns || []), ...(aiFilter.concerns || [])].filter(Boolean))],
    positive_signals: [...new Set([...(deterministicFilter.positive_signals || []), ...(aiFilter.positive_signals || [])].filter(Boolean))],
    action: deterministicFilter.action || aiFilter.action || "Review work authorization questions manually."
  };
  result.sponsorship_filter = merged;
  result.match = result.match || {};
  result.match.visa_risk = merged.risk || result.match.visa_risk || "unknown";

  const gaps = new Set(result.match.gaps || []);
  if (merged.summary) gaps.add(`Sponsorship: ${merged.summary}`);
  for (const concern of merged.concerns || []) gaps.add(`Sponsorship review: ${concern}`);
  result.match.gaps = [...gaps];

  const checklist = new Set(result.final_checklist || []);
  checklist.add(`Sponsorship filter: ${sponsorshipStatusLabel(merged)}. ${merged.action}`);
  result.final_checklist = [...checklist];

  if (merged.disqualifying) {
    result.match.score = Math.min(Number(result.match.score || 0), 35);
    result.match.recommendation = "skip / verify sponsorship first";
    result.match.summary = `${result.match.summary || ""} Sponsorship filter found a likely blocking requirement. Verify before tailoring or applying.`.trim();
  } else if (merged.status === "needs_review" && Number(result.match.score || 0) > 85) {
    result.match.score = 85;
    result.match.recommendation = result.match.recommendation || "review sponsorship first";
  }
  return result;
}

export function refineSchema() {
  return {
    name: "resume_tailor_refinement",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        revised: { type: "string" },
        reason: { type: "string" },
        risk: { type: "string" }
      },
      required: ["revised", "reason", "risk"]
    }
  };
}

export function rewriteResumeSchema() {
  return {
    name: "resume_rewrite_result",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        resume_text: { type: "string" },
        change_summary: { type: "array", items: { type: "string" } },
        warnings: { type: "array", items: { type: "string" } }
      },
      required: ["resume_text", "change_summary", "warnings"]
    }
  };
}

export function visualJdSchema() {
  return {
    name: "visual_job_description",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        company: { type: "string" },
        location: { type: "string" },
        salary: { type: "string" },
        jd_text: { type: "string" },
        confidence: { type: "number" },
        limitations: { type: "array", items: { type: "string" } }
      },
      required: ["title", "company", "location", "salary", "jd_text", "confidence", "limitations"]
    }
  };
}

export function cleanJdSchema() {
  return {
    name: "clean_job_description",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        company: { type: "string" },
        location: { type: "string" },
        salary: { type: "string" },
        jd_text: { type: "string" },
        removed_noise_summary: { type: "string" },
        confidence: { type: "number" }
      },
      required: ["title", "company", "location", "salary", "jd_text", "removed_noise_summary", "confidence"]
    }
  };
}

export async function cleanJdFromPageText({ rawText, pageUrl = "", pageTitle = "", title = "", company = "", location = "", provider = "" }) {
  const system = [
    "You clean raw text extracted from a job page into a focused job description.",
    "Keep only job-specific content: title, company, location, salary, overview, responsibilities, requirements, qualifications, benefits, work authorization, and compensation.",
    "Remove navigation, buttons, cookie text, recommended jobs, unrelated company boilerplate, chats, browser/extension text, duplicate lines, URLs, and tracking content.",
    "Do not invent missing content. Preserve useful wording and readable section breaks. Return JSON only."
  ].join(" ");
  const user = [
    `Page title: ${pageTitle}`,
    `Page URL: ${pageUrl}`,
    `Existing title guess: ${title}`,
    `Existing company guess: ${company}`,
    `Existing location guess: ${location}`,
    "Clean this raw extracted page text into a job description:",
    String(rawText || "").slice(0, 30000)
  ].join("\n\n");
  return runJsonAi({ system, user, schema: cleanJdSchema(), preferProvider: provider });
}

export async function extractJdFromScreenshot({ imageDataUrl, imageDataUrls, pageUrl = "", pageTitle = "", provider = "" }) {
  const system = [
    "You extract job descriptions from one or more screenshots of job pages.",
    "Ignore browser chrome, extension UI, side panels, chat/messages, ads, recommended jobs, navigation, and unrelated profile content.",
    "Screenshots may be sequential vertical views from the same page. Merge overlapping text and remove duplicates.",
    "Only transcribe job-specific content visible in the screenshots: title, company, location, salary, responsibilities, requirements, qualifications, and benefits.",
    "If the screenshots do not show a useful job description, return an empty jd_text and a low confidence score.",
    "Do not invent text that is not visible. Return JSON only."
  ].join(" ");
  const user = [
    `Page title: ${pageTitle}`,
    `Page URL: ${pageUrl}`,
    "Extract the job description from these page screenshots.",
    "Preserve readable line breaks. Remove duplicate lines. Do not include URLs, message text, extension text, or browser UI."
  ].join("\n");
  return runVisionJsonAi({ system, user, imageDataUrl, imageDataUrls, schema: visualJdSchema(), preferProvider: provider });
}

export async function analyzeResumeForJob({ jd, profile, resumeDetails, strategy = "balanced", provider = "" }) {
  const profileBundle = compactProfileBundle(profile, resumeDetails);
  const deterministicSponsorship = analyzeSponsorshipText({ jd });
  const system = [
    "You are a careful resume tailoring assistant for job applications.",
    "Never invent experience, skills, dates, employers, schools, or credentials.",
    "Only rewrite wording, reorder emphasis, and suggest changes supported by the candidate profile.",
    "Every bullet suggestion must include evidence from the resume/profile and a risk level.",
    "Evaluate sponsorship/work-authorization risk separately. Treat US citizenship, security clearance, public trust, or no sponsorship now/in the future as likely blocking for F-1 OPT unless the JD clearly says otherwise.",
    "Keep wording simple, confident, early-career, and ATS-friendly. Return JSON only."
  ].join(" ");
  const user = [
    `Optimization strategy: ${strategy}`,
    "Analyze this job description and candidate profile.",
    "Score match from 0-100. Flag visa/sponsorship/citizenship/security-clearance risks.",
    `Deterministic sponsorship pre-check:\n${JSON.stringify(deterministicSponsorship)}`,
    "Generate a clean tailored resume draft plan: summary, skills order, bullet suggestions, cover letter, interview talking points, and final checklist.",
    "Do not claim missing requirements. Put unsupported requirements in missing_do_not_claim.",
    `Job page/JD:\n${String(jd || "").slice(0, 18000)}`,
    `Candidate profile JSON:\n${JSON.stringify(profileBundle).slice(0, 18000)}`
  ].join("\n\n");
  const analysis = await runJsonAi({ system, user, schema: tailorSchema(), preferProvider: provider });
  return mergeSponsorshipFilter(analysis, deterministicSponsorship);
}

export async function refineTailorText({ jd, profile, resumeDetails, original, instruction, provider = "" }) {
  const system = [
    "You revise one resume bullet or resume section.",
    "Stay truthful to the provided profile. Do not invent facts.",
    "Keep the result concise and application-ready. Return JSON only."
  ].join(" ");
  const user = [
    `Instruction: ${instruction}`,
    `Original text:\n${original}`,
    `Job description:\n${String(jd || "").slice(0, 9000)}`,
    `Candidate profile:\n${JSON.stringify(compactProfileBundle(profile, resumeDetails)).slice(0, 9000)}`
  ].join("\n\n");
  return runJsonAi({ system, user, schema: refineSchema(), preferProvider: provider });
}

export async function rewriteResumeFromOriginal({ jd, profile, resumeDetails, originalResume, strategy = "balanced", layout = "original", provider = "" }) {
  const system = [
    "You rewrite an existing resume for a specific job.",
    "Do not write a resume from scratch. Preserve the candidate's original sections, order, dates, employers, schools, and factual claims unless the candidate profile clearly supports a correction.",
    "You may tighten wording, reorder skills, improve bullets, and emphasize truthful experience that fits the job.",
    "Never invent experience, tools, metrics, credentials, companies, projects, dates, visa status, or education.",
    "Keep the result ATS-friendly and clean. Return JSON only."
  ].join(" ");
  const user = [
    `Strategy: ${strategy}`,
    `Layout preference: ${layout}. If layout is original, keep the original resume's section order and plain-text structure as much as possible.`,
    `Job description:\n${String(jd || "").slice(0, 18000)}`,
    `Original resume text to revise:\n${String(originalResume || "").slice(0, 18000)}`,
    `Candidate profile JSON for fact checking:\n${JSON.stringify(compactProfileBundle(profile, resumeDetails)).slice(0, 14000)}`,
    "Return the full revised resume_text, plus a short change_summary and warnings for anything the user should review."
  ].join("\n\n");
  return runJsonAi({ system, user, schema: rewriteResumeSchema(), preferProvider: provider });
}

export function buildTailoredResumeText(profile = {}, details = {}, analysis = {}, acceptedBullets = []) {
  const lines = [];
  const name = profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const contact = [profile.email, profile.phone, [profile.city, profile.state].filter(Boolean).join(", "), profile.linkedin].filter(Boolean).join(" | ");
  if (name) lines.push(name);
  if (contact) lines.push(contact);
  lines.push("");
  if (analysis.tailored_summary) {
    lines.push("SUMMARY");
    lines.push(analysis.tailored_summary);
    lines.push("");
  }
  const skills = (analysis.skills_order || []).length ? analysis.skills_order : (details.skillsAndTools || []).map((item) => item.name || item).filter(Boolean);
  if (skills.length) {
    lines.push("SKILLS");
    lines.push(skills.join(" | "));
    lines.push("");
  }
  if ((details.experienceEntries || []).length) {
    lines.push("EXPERIENCE");
    for (const entry of details.experienceEntries || []) {
      lines.push([entry.title, entry.company, entry.location].filter(Boolean).join(" - "));
      const dates = [entry.startDate, entry.endDate || (entry.isCurrent ? "Present" : "")].filter(Boolean).join(" - ");
      if (dates) lines.push(dates);
      const related = acceptedBullets.filter((item) => String(item.source || "").toLowerCase().includes(String(entry.company || "").toLowerCase()) || String(item.source || "").toLowerCase().includes(String(entry.title || "").toLowerCase()));
      const bullets = related.length ? related.map((item) => item.suggested) : String(entry.description || "").split(/\n|•/).map((item) => item.trim()).filter(Boolean).slice(0, 3);
      for (const bullet of bullets) lines.push(`- ${bullet}`);
      lines.push("");
    }
  }
  if ((details.projectEntries || []).length) {
    lines.push("PROJECTS");
    for (const project of details.projectEntries || []) {
      lines.push([project.name, project.technologies].filter(Boolean).join(" - "));
      const bullets = String(project.description || "").split(/\n|•/).map((item) => item.trim()).filter(Boolean).slice(0, 3);
      for (const bullet of bullets) lines.push(`- ${bullet}`);
      lines.push("");
    }
  }
  if ((details.educationEntries || []).length) {
    lines.push("EDUCATION");
    for (const edu of details.educationEntries || []) {
      lines.push([edu.school, edu.degree, edu.major].filter(Boolean).join(" - "));
      const dates = [edu.startDate, edu.endDate].filter(Boolean).join(" - ");
      if (dates) lines.push(dates);
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
