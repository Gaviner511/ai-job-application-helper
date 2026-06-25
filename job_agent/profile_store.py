import json
from pathlib import Path

TARGET_ROLES = [
    "Project Coordinator",
    "Assistant Project Manager",
    "Operations Coordinator",
    "Business Operations Analyst",
    "Risk Analyst",
    "Program Coordinator",
    "Implementation Coordinator",
    "Real Estate Operations",
]

TARGET_LOCATIONS = ["Bay Area", "New York", "New Jersey", "Remote"]

VISA_CONSTRAINTS = {
    "status": "F-1 OPT",
    "filter_citizenship": True,
    "filter_security_clearance": True,
    "filter_no_sponsorship": True,
}


def load_profile(path="profile_store.json"):
    data = json.loads(Path(path).read_text(encoding="utf-8")) if Path(path).exists() else {}
    data.setdefault("profile", {})
    data.setdefault("resumeDetails", {})
    data.setdefault("targetRoles", TARGET_ROLES)
    data.setdefault("targetLocations", TARGET_LOCATIONS)
    data.setdefault("visaConstraints", VISA_CONSTRAINTS)
    return data


def profile_text(profile):
    details = profile.get("resumeDetails", {})
    pieces = profile.get("targetRoles", []) + profile.get("targetLocations", [])
    for value in profile.get("profile", {}).values():
      if isinstance(value, str):
        pieces.append(value)
    for group in ["skillsAndTools", "experienceEntries", "projectEntries", "educationEntries", "certificationEntries"]:
        for item in details.get(group, []) or []:
            pieces.extend(str(value) for value in item.values() if value)
    if profile.get("rawText"):
        pieces.append(profile["rawText"])
    return "\n".join(pieces)

