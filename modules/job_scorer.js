import { profileText } from "./resume_parser.js";
import { analyzeSponsorshipText } from "./visa_filter.js";

function words(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9+#.-]{2,}/g) || []);
}

function includesAny(text, terms) {
  const haystack = String(text || "").toLowerCase();
  return terms.some((term) => term && haystack.includes(String(term).toLowerCase()));
}

function hitList(text, terms, limit = 8) {
  const haystack = String(text || "").toLowerCase();
  return terms.filter((term) => term && haystack.includes(String(term).toLowerCase())).slice(0, limit);
}

export function visaRiskForJob(job) {
  const filter = analyzeSponsorshipText({
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.description,
    tags: job.tags
  });
  return {
    visaRisk: filter.risk === "unknown" ? "low" : filter.risk,
    concerns: filter.status === "unknown" ? [] : filter.concerns,
    disqualifying: filter.disqualifying,
    sponsorshipFilter: filter
  };
}

function recommendationFor(score, concerns) {
  if (concerns.some((item) => /citizenship|clearance|no sponsorship/i.test(item))) return "skip";
  if (score >= 72) return "apply";
  if (score >= 50) return "maybe";
  return "skip";
}

function points(value, max) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

export function generateApplicationPrep(job, bundle, scoreBreakdown = {}) {
  if ((job.score || 0) <= 80) return null;
  const details = bundle?.resumeDetails || {};
  const profile = bundle?.profile || {};
  const topSkills = (details.skillsAndTools || []).map((item) => item.name).filter(Boolean).slice(0, 8);
  const recentExperience = (details.experienceEntries || [])[0] || {};
  const project = (details.projectEntries || [])[0] || {};
  const role = job.title || "this role";
  const company = job.company || "your team";
  return {
    resume_bullets: [
      `Tailor a resume bullet around project coordination for ${role}, emphasizing scheduling, stakeholder follow-up, documentation, and cross-functional execution.`,
      recentExperience.title ? `Reframe ${recentExperience.title} experience to show measurable operations impact, process improvement, and ownership of recurring workflows.` : "Add a bullet showing measurable operations impact, process improvement, and ownership of recurring workflows.",
      topSkills.length ? `Highlight tools relevant to this job: ${topSkills.join(", ")}.` : "Highlight tools from the job description that also appear in your resume.",
      project.name ? `Use ${project.name} as a project example showing planning, risk tracking, analysis, and delivery.` : "Add a project example showing planning, risk tracking, analysis, and delivery."
    ],
    cover_letter: `Dear ${company} Hiring Team,\n\nI am excited to apply for the ${role} position. My background in project coordination, operations support, and analytical problem solving aligns well with the needs of this role. I have experience supporting teams through scheduling, documentation, stakeholder communication, and process tracking, and I am especially interested in roles where I can improve execution and reduce operational friction.\n\nWhat draws me to this opportunity is the chance to contribute to practical, cross-functional work while continuing to grow in project management and operations. I would welcome the opportunity to discuss how my experience and work ethic can support ${company}.\n\nSincerely,\n${profile.fullName || ""}`.trim(),
    interview_talking_points: [
      "Describe a time you coordinated multiple stakeholders and kept work moving under deadlines.",
      "Explain how you track risks, open items, and follow-ups in a project or operations workflow.",
      "Prepare one example of improving a process, reducing manual work, or increasing accuracy.",
      scoreBreakdown.location_remote_fit >= 8 ? "Mention your fit for the role's location or remote setup." : "Be ready to explain your location flexibility.",
      scoreBreakdown.visa_friendliness < 5 ? "Prepare a concise, truthful explanation of F-1 OPT work authorization." : "Keep work authorization explanation concise and factual."
    ]
  };
}

export function scoreJob(job, bundle, keywords = []) {
  const profile = bundle?.profile || {};
  const resumeWords = words(profileText(bundle));
  const jobText = `${job.title} ${job.company} ${job.location} ${job.description} ${(job.tags || []).join(" ")}`;
  const jobWords = words(jobText);
  const reasons = [];
  const concerns = [];

  if (/senior|lead|principal|staff/i.test(job.title) && /intern|assistant|junior|entry/i.test(profile.currentTitle || profile.desiredTitle || "")) {
    concerns.push("Seniority may be too high");
  }

  const locationText = `${job.location} ${job.description}`;
  const visa = visaRiskForJob(job);
  concerns.push(...visa.concerns);

  const targetRoleHits = hitList(job.title, [profile.desiredTitle, profile.currentTitle, ...(bundle?.targetRoles || [])].filter(Boolean), 4);
  const roleFamilyHit = /project coordinator|assistant project manager|program coordinator|implementation coordinator|operations coordinator|business operations|risk analyst|real estate operations|project manager|operations analyst/i.test(jobText);
  const roleTitle = points((targetRoleHits.length ? 18 : 0) + (roleFamilyHit ? 7 : 0), 25);
  if (targetRoleHits.length) reasons.push(`Role/title match: ${targetRoleHits.join(", ")}`);
  if (roleFamilyHit) reasons.push("Matches target project/operations/risk role family");

  let experienceLevel = 8;
  if (/entry level|junior|associate|coordinator|assistant|0-2 years|1-3 years|early career/i.test(jobText)) experienceLevel = 20;
  else if (/2-4 years|3-5 years|mid level/i.test(jobText)) experienceLevel = 13;
  if (/senior|lead|principal|staff|manager,|director/i.test(job.title)) experienceLevel = Math.min(experienceLevel, 6);
  if (experienceLevel >= 13) reasons.push("Experience level appears reachable");

  const pmHits = hitList(jobText, ["project management", "project coordination", "stakeholder", "timeline", "schedule", "milestone", "deliverable", "cross-functional", "implementation", "program"]);
  const projectManagement = points(pmHits.length * 3, 15);
  if (pmHits.length) reasons.push(`Project keywords: ${pmHits.join(", ")}`);

  const opsHits = hitList(jobText, ["operations", "business operations", "risk", "process", "workflow", "reporting", "analysis", "compliance", "vendor", "real estate"]);
  const operationsRiskBusiness = points(opsHits.length * 3, 15);
  if (opsHits.length) reasons.push(`Operations/risk/business keywords: ${opsHits.join(", ")}`);

  const skillHits = [...resumeWords].filter((word) => word.length > 2 && jobWords.has(word)).slice(0, 10);
  const toolsMatch = points(skillHits.length * 2, 10);
  if (skillHits.length) reasons.push(`Resume/tool terms: ${skillHits.slice(0, 8).join(", ")}`);

  const targetLocationFit = (bundle?.targetLocations || []).some((location) => includesAny(locationText, [location]) || (location === "Bay Area" && /bay area|san francisco|san jose|oakland|palo alto|menlo park|mountain view|sunnyvale|santa clara/i.test(locationText)));
  const locationRemote = points((targetLocationFit ? 8 : 0) + (/remote/i.test(locationText) ? 2 : 0), 10);
  if (targetLocationFit || /remote/i.test(locationText)) reasons.push("Location/remote fit");

  const visaFriendliness = visa.visaRisk === "low" ? 5 : visa.visaRisk === "medium" ? 2 : 0;

  const breakdown = {
    role_title_relevance: roleTitle,
    experience_level_fit: experienceLevel,
    project_management_keywords: projectManagement,
    operations_risk_business_keywords: operationsRiskBusiness,
    tools_match: toolsMatch,
    location_remote_fit: locationRemote,
    visa_friendliness: visaFriendliness
  };
  let finalScore = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  if (visa.disqualifying) finalScore = Math.min(finalScore, 35);
  finalScore = Math.max(0, Math.min(100, Math.round(finalScore)));
  const scored = {
    score: finalScore,
    recommendation: recommendationFor(finalScore, concerns),
    visa_risk: visa.visaRisk,
    sponsorship_filter: visa.sponsorshipFilter,
    concerns,
    reasons: reasons.length ? reasons : ["Limited match information"],
    score_breakdown: breakdown,
    score_explanation: `Role/title ${roleTitle}/25, experience ${experienceLevel}/20, project management ${projectManagement}/15, operations/risk/business ${operationsRiskBusiness}/15, tools ${toolsMatch}/10, location/remote ${locationRemote}/10, visa ${visaFriendliness}/5.`
  };
  return { ...scored, application_prep: generateApplicationPrep({ ...job, ...scored }, bundle, breakdown) };
}

export async function scoreJobsWithLocalAi(jobs, bundle, keywords = [], ollamaRequest) {
  const model = bundle?.ollamaModel;
  if (!model || !ollamaRequest || !jobs.length) return jobs;
  const topJobs = jobs.slice(0, 30);
  const prompt = [
    "/no_think",
    "Score each job from 0 to 100 for fit against the candidate profile. Return JSON only.",
    "Candidate context: early-career project management / operations / risk management, F-1 OPT.",
    "Use this exact rubric: 25 role/title relevance, 20 experience level fit, 15 project management keywords, 15 operations/risk/business keywords, 10 tools match, 10 location/remote fit, 5 visa friendliness.",
    "Filter/penalize jobs clearly requiring US citizenship, security clearance, or no sponsorship now or in the future.",
    "For jobs scoring above 80, include customized resume bullet suggestions, a short cover letter draft, and interview talking points based on the profile.",
    `Keywords: ${JSON.stringify(keywords.slice(0, 20))}`,
    `Profile summary: ${profileText(bundle).slice(0, 3500)}`,
    `Jobs: ${JSON.stringify(topJobs.map((job) => ({ id: job.id, title: job.title, company: job.company, location: job.location, description: String(job.description || "").slice(0, 700), source: job.source })))}`
  ].join("\n\n");
  const schema = {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            score: { type: "number" },
            reason: { type: "string" },
            concerns: { type: "array", items: { type: "string" } },
            recommendation: { type: "string", enum: ["apply", "maybe", "skip"] },
            visa_risk: { type: "string", enum: ["low", "medium", "high"] },
            score_breakdown: {
              type: "object",
              properties: {
                role_title_relevance: { type: "number" },
                experience_level_fit: { type: "number" },
                project_management_keywords: { type: "number" },
                operations_risk_business_keywords: { type: "number" },
                tools_match: { type: "number" },
                location_remote_fit: { type: "number" },
                visa_friendliness: { type: "number" }
              }
            },
            application_prep: {
              type: "object",
              properties: {
                resume_bullets: { type: "array", items: { type: "string" } },
                cover_letter: { type: "string" },
                interview_talking_points: { type: "array", items: { type: "string" } }
              }
            }
          },
          required: ["id", "score", "reason", "concerns", "recommendation", "visa_risk"]
        }
      }
    },
    required: ["scores"]
  };
  const result = await ollamaRequest("chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: false, format: schema, messages: [{ role: "user", content: prompt }], options: { temperature: 0, num_ctx: 8192 } })
  });
  const parsed = JSON.parse(result.message?.content || "{}");
  const byId = new Map((parsed.scores || []).map((item) => [String(item.id), item]));
  return jobs.map((job) => {
    const ai = byId.get(String(job.id));
    if (!ai) return job;
    const visa = visaRiskForJob(job);
    const concerns = [...new Set([...(job.concerns || []), ...(visa.concerns || []), ...(ai.concerns || [])].filter(Boolean))];
    let score = Math.max(0, Math.min(100, Math.round(Number(ai.score) || job.score || 0)));
    if (visa.disqualifying) score = Math.min(score, 35);
    return {
      ...job,
      score,
      reasons: [ai.reason || "AI fit score"],
      concerns,
      recommendation: visa.disqualifying ? "skip" : (ai.recommendation || job.recommendation),
      visa_risk: visa.visaRisk === "high" ? "high" : (ai.visa_risk || job.visa_risk),
      sponsorship_filter: visa.sponsorshipFilter,
      score_breakdown: ai.score_breakdown || job.score_breakdown,
      score_explanation: ai.reason || job.score_explanation,
      application_prep: score > 80 ? (ai.application_prep || job.application_prep || generateApplicationPrep({ ...job, score }, bundle, ai.score_breakdown || job.score_breakdown)) : null
    };
  });
}
