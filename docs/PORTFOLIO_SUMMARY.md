# Portfolio Summary

## Project Name

AI Job Application Helper

## Short Description

A local-first Chrome extension that parses resumes, builds structured candidate profiles, scans job application forms, and helps users fill applications safely with review-first automation.

## Current Status

This is an actively iterated personal project. It has gone through many versions based on real application workflows, but it is still not at the level of reliability and polish I ultimately want. I plan to continue improving scan accuracy, AI-assisted resume parsing, resume tailoring, and the overall workflow.

## Resume Bullet Options

- Built a Chrome extension that converts unstructured resumes into structured candidate profiles and assists with job application form filling through confidence-based field matching.
- Designed a human-in-the-loop autofill workflow with sensitive-field detection, manual review, saved corrections, and no auto-submit behavior.
- Integrated optional local AI through Ollama to improve resume classification, job-description analysis, and resume tailoring while preserving user control.
- Designed the AI layer to support either local models for privacy and lower running cost, or cloud APIs for stronger analysis when the user chooses.
- Implemented a job matching workflow that searches compliant public sources, scores roles against candidate profiles, and exports reviewable job trackers.
- Iterated a multi-surface UI across popup, split-view, tab, settings, and profile-management workflows to reduce friction in repetitive job applications.

## Technical Highlights

- Chrome Extension Manifest V3
- DOM scanning and dynamic form detection
- Local storage and profile management
- Confidence scoring and field classification
- Optional local/cloud AI integration
- CSV, Excel, TXT, HTML, and PDF export flows
- Privacy-first automation boundaries

## Product Principles

- User stays in control
- No auto-submit
- No bulk applying
- Sensitive information requires confirmation
- Local-first by default
