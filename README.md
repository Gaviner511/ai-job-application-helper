# AI Job Application Helper

A local-first Chrome extension that turns a resume into a structured profile, reviews job application forms, and helps fill them safely. It is designed for human-controlled job applications: it can suggest and fill information, but it does not auto-submit applications or bulk-apply to jobs.

## Project Status

This project has gone through many iterations based on real job application workflows, but it is still an active work in progress. The current version is usable as a personal productivity tool and portfolio project, but it has not reached the level of polish, reliability, and cross-site accuracy I ultimately want.

The long-term goal is to keep improving scan accuracy, resume tailoring quality, field-matching reliability, and the overall user experience until the tool feels simple enough for everyday use across many job application platforms.

## What It Does

- Parses a resume into structured profile data.
- Stores multiple profiles and lets the user switch between them quickly.
- Scans job application pages and groups detected fields by confidence.
- Flags sensitive questions such as sponsorship, work authorization, salary, disability, veteran, and demographic fields.
- Provides a click-to-choose helper next to fields when automatic matching is uncertain.
- Supports basic and advanced modes so the UI can stay simple until deeper tools are needed.
- Reads job descriptions from the current page and helps tailor resume content.
- Exports tailored resumes as TXT, HTML, and PDF.
- Includes a job finder and scorer workflow for reviewing potential jobs before applying.

## Safety Principles

- No auto-submit.
- No bulk-apply behavior.
- Sensitive fields require review.
- The user stays in control before anything is filled.
- Local profile data stays in the browser unless the user explicitly enables an AI provider.
- The extension avoids direct scraping of restricted platforms and focuses on user-assisted workflows.

## Main Features

### Resume To Profile

The profile manager reads resume content and organizes it into common job application fields:

- Basic identity and contact information
- Education
- Work experience
- Projects
- Skills and tools
- Certifications
- Languages
- Links
- Work authorization preferences

Optional AI support can improve classification quality. The extension is designed to support both local models and cloud APIs:

- Local AI: run models on the user's own machine through tools such as Ollama. This is more privacy-friendly and avoids per-request API cost, but speed and quality depend on local hardware and model choice.
- Cloud AI: connect to a hosted AI API for stronger resume parsing, job-description analysis, and resume tailoring. This can be higher quality and faster on weaker computers, but it may involve API cost and sending selected content to an external provider.

### Application Helper

The helper scans the current application page and produces a reviewable list of fields:

- High confidence matches
- Needs review
- Missing profile data
- Sensitive fields
- Open-ended questions

Users can fill high-confidence fields, fill selected fields, or use the click-to-choose helper for individual inputs.

### Resume Tailor

The resume tailoring workspace can read the current job description, compare it with the active profile, and generate targeted suggestions. The goal is to improve the existing resume rather than rewrite it from scratch.

### Job Finder

The job finder module uses profile data to search compliant public sources, score jobs, and export reviewable results. It is a preparation and tracking tool, not an auto-application system.

## Project Structure

```text
.
|-- modules/
|   |-- resume_parser/
|   |-- profile_store/
|   |-- job_finder/
|   |-- job_scorer/
|   |-- application_helper/
|   `-- export_tracker/
|-- job_agent/
|-- scripts/
|-- icons/
|-- vendor/
|-- popup.html / popup.js
|-- profile.html / profile.js
|-- resume_tailor.html / resume_tailor.js
|-- job_finder.html / job_finder.js
|-- settings.html / settings.js
`-- manifest.json
```

## Local Installation

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on Developer Mode.
4. Click `Load unpacked`.
5. Select this project folder.
6. Pin the extension if you want quick access.

After loading, open the extension from the toolbar and choose a profile or create one from a resume.

## Optional Local AI

Local AI is optional. The extension can still scan and fill pages without it.

Recommended local setup:

1. Install Ollama.
2. Pull a model that fits your machine.
3. In extension settings, enable local AI and test the connection.

For lower-end laptops, smaller models are faster and more practical. Larger models may produce better classification but can be slow without enough memory or GPU capacity.

## Optional Cloud AI

Cloud AI can be used for higher-quality resume parsing, resume tailoring, job-description analysis, and open-ended answer drafting. API keys should only be stored locally through the extension settings. Do not commit API keys or private profile exports to the repository.

The AI layer is intentionally optional. The same extension can run in a lightweight rules-based mode, a local-model mode, or a cloud-assisted mode depending on the user's privacy, cost, and hardware preferences.

## CLI Examples

Some workflows are also available through the Python CLI:

```bash
python main.py parse-resume --resume resume.pdf
python main.py search-jobs --resume resume.pdf --location "Bay Area" --days 7
python main.py score-jobs
python main.py export
python main.py run-all --resume resume.pdf --location "Bay Area"
```

## Privacy Notes

This project is designed to be local-first. Resume text, profile data, scan results, and saved corrections should remain local unless the user explicitly chooses to use an AI service or export data.

Before publishing a fork or demo, remove:

- Real resumes
- Profile exports
- Job tracking files
- API keys
- Local logs
- Generated packages

The `.gitignore` file excludes common generated and private files.

## Limitations

- Some job sites use iframes, dynamic rendering, or custom inputs that can reduce scan accuracy.
- Dropdowns and search-select fields may still require user confirmation.
- AI-generated resume suggestions should be reviewed carefully.
- The extension intentionally stops before final application submission.

## Roadmap

This project is not finished. Future improvements include:

- More reliable scanning across complex job sites.
- Better handling for dynamic dropdowns and search-select fields.
- Higher-quality resume parsing for unusual resume formats.
- Better resume tailoring while preserving the original layout.
- More consistent UI behavior across popup, split view, tab view, and settings pages.
- Stronger testing coverage before treating the project as a polished release.

## Portfolio Summary

This project demonstrates:

- Chrome extension architecture
- DOM scanning and form-field matching
- Local-first data handling
- AI-assisted resume parsing and job matching
- Human-in-the-loop automation design
- Privacy-conscious product decisions
- UI iteration across popup, split-view, tab, and settings workflows
