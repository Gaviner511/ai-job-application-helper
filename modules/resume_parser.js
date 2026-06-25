const STOP_WORDS = new Set([
  "and", "or", "the", "with", "for", "from", "this", "that", "using", "including",
  "experience", "skills", "tools", "summary", "project", "work", "education"
]);

export function profileText(bundle) {
  const profile = bundle?.profile || {};
  const details = bundle?.resumeDetails || {};
  const pieces = [
    ...(bundle?.targetRoles || []),
    ...(bundle?.targetLocations || []),
    bundle?.visaConstraints?.status,
    profile.currentTitle,
    profile.desiredTitle,
    profile.professionalSummary,
    profile.skills,
    profile.currentCompany,
    profile.school,
    profile.degree,
    profile.major,
    ...(details.skillsAndTools || []).flatMap((item) => [item.name, item.category]),
    ...(details.experienceEntries || []).flatMap((item) => [item.title, item.company, item.description]),
    ...(details.projectEntries || []).flatMap((item) => [item.name, item.technologies?.join(" "), item.description]),
    ...(details.educationEntries || []).flatMap((item) => [item.degree, item.major, item.school]),
    ...(details.certificationEntries || []).flatMap((item) => [item.name, item.issuer])
  ];
  return pieces.filter(Boolean).join("\n");
}

export function generateHeuristicKeywords(bundle, limit = 12) {
  const profile = bundle?.profile || {};
  const details = bundle?.resumeDetails || {};
  const weighted = new Map();
  const add = (term, weight = 1) => {
    const cleaned = String(term || "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned || cleaned.length < 2) return;
    weighted.set(cleaned, (weighted.get(cleaned) || 0) + weight);
  };

  add(profile.desiredTitle, 8);
  add(profile.currentTitle, 7);
  for (const role of bundle?.targetRoles || []) add(role, 9);
  add(profile.major, 4);
  add(profile.degree, 2);
  for (const item of details.experienceEntries || []) add(item.title, 6);
  for (const item of details.projectEntries || []) add(item.name, 3);
  for (const item of details.skillsAndTools || []) add(item.name, 5);

  const text = profileText(bundle).toLowerCase();
  for (const phrase of text.match(/\b[a-z][a-z0-9+#./-]{2,}(?:\s+[a-z][a-z0-9+#./-]{2,}){0,2}\b/g) || []) {
    const words = phrase.split(/\s+/).filter((word) => !STOP_WORDS.has(word));
    if (!words.length) continue;
    add(words.join(" "), words.length > 1 ? 2 : 1);
  }

  return [...weighted.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term)
    .filter((term, index, all) => all.findIndex((other) => other.toLowerCase() === term.toLowerCase()) === index)
    .slice(0, limit);
}
