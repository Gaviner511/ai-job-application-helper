export function openApplicationHelperForJob(job) {
  if (!job?.url) return;
  chrome.tabs.create({ url: job.url });
}

export const APPLICATION_SAFETY_NOTE = "This extension does not auto-apply. Open a job, review the application page yourself, then manually use the autofill helper.";

