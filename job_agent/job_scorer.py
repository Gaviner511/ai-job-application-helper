import re
from .profile_store import profile_text


def visa_risk(job):
    text = f"{job.get('title','')} {job.get('description','')}".lower()
    concerns = []
    disqualifying = False
    risk = "low"
    if re.search(r"us citizen|u\.s\. citizen|citizenship required|only us citizens", text):
        concerns.append("Requires US citizenship")
        disqualifying = True
        risk = "high"
    if re.search(r"security clearance|active clearance|secret clearance|top secret|ts/sci|public trust", text):
        concerns.append("Requires security clearance or public trust")
        disqualifying = True
        risk = "high"
    if re.search(r"no sponsorship|will not sponsor|unable to sponsor|now or in the future|sponsorship.*not available", text):
        concerns.append("Clearly says no sponsorship now or in the future")
        disqualifying = True
        risk = "high"
    if risk == "low" and re.search(r"work authorization|sponsorship|authorized to work", text):
        risk = "medium"
        concerns.append("Mentions work authorization or sponsorship")
    return risk, concerns, disqualifying


def score_job(job, profile, keywords):
    text = f"{job.get('title','')} {job.get('company','')} {job.get('location','')} {job.get('description','')}"
    lower = text.lower()
    reasons = []
    concerns = []
    title = job.get("title", "")
    target_roles = profile.get("targetRoles", []) + [profile.get("profile", {}).get("currentTitle", ""), profile.get("profile", {}).get("desiredTitle", "")]
    role_hits = [role for role in target_roles if role and role.lower() in title.lower()]
    role_family = bool(re.search(r"project coordinator|assistant project manager|program coordinator|implementation coordinator|operations coordinator|business operations|risk analyst|real estate operations|project manager|operations analyst", lower))
    role_points = min(25, (18 if role_hits else 0) + (7 if role_family else 0))
    if role_hits:
        reasons.append("Role/title match: " + ", ".join(role_hits[:3]))
    if role_family:
        reasons.append("Target role family match")

    experience_points = 8
    if re.search(r"entry level|junior|associate|coordinator|assistant|0-2 years|1-3 years|early career", lower):
        experience_points = 20
        reasons.append("Entry-level friendly")
    elif re.search(r"2-4 years|3-5 years|mid level", lower):
        experience_points = 13
    if re.search(r"senior|lead|principal|staff|director", title, re.I):
        experience_points = min(experience_points, 6)
        concerns.append("Seniority may be too high")

    pm_hits = [term for term in ["project management", "project coordination", "stakeholder", "timeline", "schedule", "milestone", "deliverable", "cross-functional", "implementation", "program"] if term in lower]
    pm_points = min(15, len(pm_hits) * 3)
    if pm_hits:
        reasons.append("Project keywords: " + ", ".join(pm_hits[:6]))

    ops_hits = [term for term in ["operations", "business operations", "risk", "process", "workflow", "reporting", "analysis", "compliance", "vendor", "real estate"] if term in lower]
    ops_points = min(15, len(ops_hits) * 3)
    if ops_hits:
        reasons.append("Operations/risk/business keywords: " + ", ".join(ops_hits[:6]))

    resume_words = set(re.findall(r"[a-z0-9+#.-]{3,}", profile_text(profile).lower()))
    job_words = set(re.findall(r"[a-z0-9+#.-]{3,}", lower))
    overlap = sorted(resume_words & job_words)[:10]
    tools_points = min(10, len(overlap) * 2)
    if overlap:
        reasons.append("Resume terms: " + ", ".join(overlap[:8]))

    location_points = 10 if re.search(r"remote|bay area|san francisco|new york|new jersey|nyc|jersey city", lower) else 0
    if location_points:
        reasons.append("Target location fit")

    risk, visa_concerns, disqualifying = visa_risk(job)
    concerns.extend(visa_concerns)
    visa_points = 5 if risk == "low" else 2 if risk == "medium" else 0

    breakdown = {
        "role_title_relevance": role_points,
        "experience_level_fit": experience_points,
        "project_management_keywords": pm_points,
        "operations_risk_business_keywords": ops_points,
        "tools_match": tools_points,
        "location_remote_fit": location_points,
        "visa_friendliness": visa_points,
    }
    score = sum(breakdown.values())
    if disqualifying:
        score = min(score, 35)
    score = max(0, min(100, round(score)))
    recommendation = "apply" if score >= 72 and not disqualifying else "maybe" if score >= 50 and not disqualifying else "skip"
    scored = {**job, "score": score, "recommendation": recommendation, "visa_risk": risk, "reasons": reasons or ["Limited match information"], "concerns": concerns, "score_breakdown": breakdown, "score_explanation": f"Role/title {role_points}/25, experience {experience_points}/20, project management {pm_points}/15, operations/risk/business {ops_points}/15, tools {tools_points}/10, location/remote {location_points}/10, visa {visa_points}/5."}
    if score > 80:
        scored["application_prep"] = {
            "resume_bullets": [
                f"Tailor one bullet to show project coordination and stakeholder follow-up for {job.get('title','this role')}.",
                "Emphasize measurable operations impact, process improvement, documentation, and execution tracking.",
                "Highlight tools and analytical skills that overlap with the job description.",
            ],
            "cover_letter": f"Dear {job.get('company','Hiring')} Team,\n\nI am excited to apply for the {job.get('title','role')} position. My background in project coordination, operations support, and analytical problem solving aligns with this opportunity. I would welcome the chance to contribute to practical execution, stakeholder communication, and process improvement for your team.\n\nSincerely,",
            "interview_talking_points": [
                "A time you coordinated multiple stakeholders under deadlines.",
                "How you track risks, follow-ups, and open project items.",
                "A process improvement or operational accuracy example.",
            ],
        }
    return scored
