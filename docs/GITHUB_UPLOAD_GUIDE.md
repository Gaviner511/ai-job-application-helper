# GitHub Upload Guide

This project is ready to upload as a portfolio repository.

## Recommended Repository Settings

- Repository name: `ai-job-application-helper`
- Visibility: Public if you want recruiters to see it directly; Private if you want to review once more first.
- Do not upload generated packages, profile exports, logs, resumes, or job tracking files.

## Upload With GitHub Desktop

1. Open GitHub Desktop.
2. Choose `File` -> `Add local repository`.
3. Select this project folder.
4. Review the changed files.
5. Commit with a message like:

```text
Prepare v1.0 portfolio release
```

6. Click `Publish repository`.
7. Confirm the repository name and visibility.

## Upload With Git CLI

If Git is installed:

```bash
git status
git add .gitignore README.md SECURITY_AND_PRIVACY.md docs/PORTFOLIO_SUMMARY.md docs/GITHUB_UPLOAD_GUIDE.md profile.html scripts/package-extension.ps1
git commit -m "Prepare v1.0 portfolio release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ai-job-application-helper.git
git push -u origin main
```

Only run the remote commands after creating the GitHub repository.

## Final Privacy Check

Before publishing, search for:

- Your real resume
- Personal profile exports
- Phone numbers
- Private email addresses
- API keys
- Local Windows paths
- Generated zip files

The repository `.gitignore` already excludes the most common local files.
