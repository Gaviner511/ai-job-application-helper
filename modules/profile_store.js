export async function getStoredProfileBundle() {
  const stored = await chrome.storage.local.get(["profile", "resumeDetails", "ollamaModel", "reviewedJobs"]);
  return enrichProfileBundle({
    profile: stored.profile || {},
    resumeDetails: stored.resumeDetails || {},
    ollamaModel: stored.ollamaModel || "",
    reviewedJobs: stored.reviewedJobs || []
  });
}

export async function saveReviewedJobs(jobs) {
  await chrome.storage.local.set({ reviewedJobs: jobs || [] });
}

export function hasProfileData(bundle) {
  const profile = bundle?.profile || {};
  const details = bundle?.resumeDetails || {};
  return Boolean(
    Object.values(profile).some((value) => String(value || "").trim()) ||
    Object.values(details).some((value) => Array.isArray(value) && value.length)
  );
}

export const DEFAULT_TARGET_ROLES = [
  "Project Coordinator",
  "Assistant Project Manager",
  "Operations Coordinator",
  "Business Operations Analyst",
  "Risk Analyst",
  "Program Coordinator",
  "Implementation Coordinator",
  "Real Estate Operations"
];

export const DEFAULT_TARGET_LOCATIONS = ["Bay Area", "New York", "New Jersey", "Remote"];

export const DEFAULT_VISA_CONSTRAINTS = {
  status: "F-1 OPT",
  filterCitizenship: true,
  filterSecurityClearance: true,
  filterNoSponsorship: true
};

export function enrichProfileBundle(bundle) {
  const profile = bundle.profile || {};
  return {
    ...bundle,
    targetRoles: bundle.targetRoles?.length ? bundle.targetRoles : [
      profile.desiredTitle,
      profile.currentTitle,
      ...DEFAULT_TARGET_ROLES
    ].filter(Boolean),
    targetLocations: bundle.targetLocations?.length ? bundle.targetLocations : DEFAULT_TARGET_LOCATIONS,
    visaConstraints: bundle.visaConstraints || DEFAULT_VISA_CONSTRAINTS
  };
}
