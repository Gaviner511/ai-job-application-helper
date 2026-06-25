# Security And Privacy

This extension is designed around local-first job application assistance. It should help users move faster without hiding important decisions from them.

## What Should Stay Local

- Resume files
- Parsed profile data
- Saved field mappings
- Job search exports
- Application notes
- API keys
- Logs

## Before Publishing

Check that the repository does not include:

- Real resumes or cover letters
- Private profile exports
- Personal phone numbers, emails, or addresses
- API keys or `.env` files
- Generated zip packages
- Local logs or cache folders

## Application Safety

The helper must not:

- Submit applications automatically
- Bulk-apply to jobs
- Bypass platform restrictions
- Silently answer sensitive questions

Sensitive fields include work authorization, visa sponsorship, expected salary, disability, veteran status, demographic questions, citizenship, and clearance questions.

## AI Usage

Local AI is preferred when privacy matters. Cloud AI can be useful for higher-quality writing and job-description analysis, but the user should understand what data is being sent.

If cloud AI is enabled, API keys should be stored locally and never committed to Git.
