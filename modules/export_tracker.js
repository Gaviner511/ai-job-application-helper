function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(filename, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJobsCsv(jobs) {
  const headers = ["title", "company", "location", "score", "recommendation", "salary", "visa_risk", "score_explanation", "reasons", "concerns", "resume_bullets", "cover_letter", "interview_talking_points", "url", "date_found"];
  const normalizedRows = jobs.map((job) => headers.map((key) => escapeCsv(
    key === "reasons" ? (job.reasons || []).join("; ") :
    key === "concerns" ? (job.concerns || []).join("; ") :
    key === "resume_bullets" ? (job.application_prep?.resume_bullets || []).join("; ") :
    key === "cover_letter" ? job.application_prep?.cover_letter || "" :
    key === "interview_talking_points" ? (job.application_prep?.interview_talking_points || []).join("; ") :
    job[key]
  )).join(","));
  downloadBlob("jobs.csv", "text/csv;charset=utf-8", [headers.join(","), ...normalizedRows].join("\n"));
}

export function exportJobsExcel(jobs) {
  const headers = ["Title", "Company", "Location", "Score", "Recommendation", "Salary", "Visa Risk", "Score Explanation", "Reasons", "Concerns", "Resume Bullets", "Cover Letter", "Interview Talking Points", "URL", "Date Found"];
  const rowHtml = jobs.map((job) => `<tr>${[
    job.title,
    job.company,
    job.location,
    job.score,
    job.recommendation,
    job.salary,
    job.visa_risk,
    job.score_explanation,
    (job.reasons || []).join("; "),
    (job.concerns || []).join("; "),
    (job.application_prep?.resume_bullets || []).join("; "),
    job.application_prep?.cover_letter || "",
    (job.application_prep?.interview_talking_points || []).join("; "),
    job.url,
    job.date_found
  ].map((value) => `<td>${String(value ?? "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]))}</td>`).join("")}</tr>`).join("");
  const html = `<html><head><meta charset="utf-8"></head><body><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rowHtml}</tbody></table></body></html>`;
  downloadBlob("jobs.xlsx", "application/vnd.ms-excel;charset=utf-8", html);
}
