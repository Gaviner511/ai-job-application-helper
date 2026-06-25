# Job Application Helper 1.0

## What 1.0 Is

Job Application Helper 1.0 is a local-first Chrome extension for completing job applications one page at a time. It helps you build a structured profile, scan application pages, review detected matches, fill safe fields, choose values for complex fields, and tailor resumes from job descriptions.

It does not auto-submit applications and does not bulk-apply.

## Core Workflow

1. Build or import a profile in Profile Manager.
2. Open a job application page.
3. Start the floating helper.
4. Scan the page.
5. Review High Confidence, Needs Review, and Missing Info.
6. Fill approved matches or use click-to-choose for complex fields.
7. Use Resume Tailor for JD analysis and resume revision when needed.

## Basic And Advanced Modes

Basic mode keeps the UI focused on the main workflow.

Advanced mode shows local AI scan, AI vision scan, diagnostics, testing tools, and repair actions.

Change this in Settings under Experience mode.

## Safety Rules

- No automatic submission.
- No bulk applying.
- Sensitive fields require review.
- Complex dropdown/search-select fields are not silently bulk-filled.
- User review is expected before every final application submission.

## Privacy Notes

- Profile data is stored in local Chrome extension storage.
- Local AI uses Ollama on this computer.
- OpenAI Cloud is optional and requires an API key.
- Cloud AI should be used only after reviewing the Settings consent option.

## 1.0 Readiness Features

- Basic / Advanced mode.
- First-run onboarding in the helper.
- Site compatibility hints after scans.
- Profile quality checker in Profile Manager.
- Repair helper state action.
- Learning memory for saved field corrections.
- Local-first profile import/export.
- Resume Tailor with JD reading, match analysis, AI rewrite, and export.

## Recommended Release Packages

- Personal AI Edition: includes local AI and optional OpenAI Cloud features.
- Share Edition: intended for users who do not need AI setup instructions.

## Known Limits

Some application pages use custom widgets, embedded frames, or platform restrictions. When scan quality is limited, use click-to-choose and save corrections for future scans.
