import json
import re
from pathlib import Path


def read_resume_text(path):
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"}:
        return path.read_text(encoding="utf-8", errors="ignore")
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except Exception as exc:
            raise RuntimeError("PDF parsing needs pypdf. Install with: pip install pypdf") from exc
        reader = PdfReader(str(path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if suffix == ".docx":
        try:
            import zipfile
            import xml.etree.ElementTree as ET
            with zipfile.ZipFile(path) as docx:
                xml = docx.read("word/document.xml")
            root = ET.fromstring(xml)
            return "\n".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))
        except Exception as exc:
            raise RuntimeError("Could not read DOCX resume text.") from exc
    raise RuntimeError("Supported resume formats: PDF, DOCX, TXT, MD")


def parse_resume(path):
    text = read_resume_text(path)
    email = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text)
    phone = re.search(r"(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}", text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    name = next((line for line in lines[:8] if re.match(r"^[A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+){1,3}$", line)), "")
    skills = sorted(set(re.findall(r"\b(?:Excel|PowerPoint|SQL|Python|Tableau|Jira|Asana|Salesforce|Risk|Operations|Project Management|Scheduling|Reporting|Data Analysis)\b", text, re.I)))
    return {
        "profile": {
            "fullName": name,
            "email": email.group(0) if email else "",
            "phone": phone.group(0) if phone else "",
        },
        "resumeDetails": {
            "skillsAndTools": [{"name": item, "category": ""} for item in skills],
            "educationEntries": [],
            "experienceEntries": [],
            "projectEntries": [],
            "certificationEntries": [],
            "languageEntries": [],
        },
        "rawText": text,
    }


def save_parsed_resume(parsed, output="profile_store.json"):
    Path(output).write_text(json.dumps(parsed, indent=2), encoding="utf-8")
    return output

