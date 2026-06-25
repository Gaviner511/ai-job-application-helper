import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from .job_scorer import score_job, visa_risk
from .safety import rate_limit


def _json_get(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "JobApplicationHelper/0.18"})
    with urllib.request.urlopen(req, timeout=30) as response:
        text = response.read().decode("utf-8", errors="ignore")
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start:end + 1]
    return json.loads(text)


def generate_keywords(profile):
    roles = profile.get("targetRoles", [])
    text = " ".join(roles + [profile.get("profile", {}).get("currentTitle", ""), profile.get("profile", {}).get("desiredTitle", "")])
    defaults = ["Project Coordinator", "Operations Coordinator", "Risk Analyst", "Program Coordinator", "Implementation Coordinator"]
    words = [item for item in roles + defaults if item]
    for token in ["project management", "operations", "risk management", "implementation", "real estate operations"]:
        if token in text.lower():
            words.append(token)
    return list(dict.fromkeys(words))[:12]


def _normalize_remotive(payload):
    jobs = []
    for job in payload.get("jobs", []):
        jobs.append({
            "id": f"remotive:{job.get('id')}",
            "title": job.get("title", ""),
            "company": job.get("company_name", ""),
            "location": job.get("candidate_required_location", "Remote"),
            "salary": job.get("salary", ""),
            "url": job.get("url", ""),
            "posting_date": job.get("publication_date", ""),
            "date_found": datetime.now(timezone.utc).isoformat(),
            "description": _strip_html(job.get("description", "")),
            "source": "Remotive",
        })
    return jobs


def _normalize_arbeitnow(payload):
    jobs = []
    for job in payload.get("data", []):
        jobs.append({
            "id": f"arbeitnow:{job.get('slug') or job.get('url')}",
            "title": job.get("title", ""),
            "company": job.get("company_name", ""),
            "location": str(job.get("location") or "Remote"),
            "salary": "",
            "url": job.get("url", ""),
            "posting_date": datetime.fromtimestamp(int(job.get("created_at", 0)), timezone.utc).isoformat() if job.get("created_at") else "",
            "date_found": datetime.now(timezone.utc).isoformat(),
            "description": _strip_html(job.get("description", "")),
            "source": "Arbeitnow",
        })
    return jobs


def _board_jobs(board):
    board = (board or "").strip()
    if not board or ":" not in board:
        return []
    kind, slug = board.split(":", 1)
    kind, slug = kind.lower().strip(), slug.strip()
    if kind == "greenhouse":
        payload = _json_get(f"https://boards-api.greenhouse.io/v1/boards/{urllib.parse.quote(slug)}/jobs?content=true")
        return [{
            "id": f"greenhouse:{slug}:{job.get('id')}",
            "title": job.get("title", ""),
            "company": slug,
            "location": (job.get("location") or {}).get("name", "Unspecified"),
            "salary": "",
            "url": job.get("absolute_url", ""),
            "posting_date": job.get("updated_at", ""),
            "date_found": datetime.now(timezone.utc).isoformat(),
            "description": _strip_html(job.get("content", "")),
            "source": "Greenhouse",
        } for job in payload.get("jobs", [])]
    if kind == "lever":
        payload = _json_get(f"https://api.lever.co/v0/postings/{urllib.parse.quote(slug)}?mode=json")
        return [{
            "id": f"lever:{slug}:{job.get('id')}",
            "title": job.get("text", ""),
            "company": slug,
            "location": (job.get("categories") or {}).get("location", "Unspecified"),
            "salary": "",
            "url": job.get("hostedUrl") or job.get("applyUrl", ""),
            "posting_date": datetime.fromtimestamp(int(job.get("createdAt", 0)) / 1000, timezone.utc).isoformat() if job.get("createdAt") else "",
            "date_found": datetime.now(timezone.utc).isoformat(),
            "description": _strip_html(job.get("descriptionPlain") or job.get("description", "")),
            "source": "Lever",
        } for job in payload]
    if kind == "ashby":
        payload = _json_get(f"https://api.ashbyhq.com/posting-api/job-board/{urllib.parse.quote(slug)}")
        return [{
            "id": f"ashby:{slug}:{job.get('id')}",
            "title": job.get("title", ""),
            "company": slug,
            "location": str(job.get("location") or job.get("locationName") or "Unspecified"),
            "salary": job.get("compensationTierSummary", ""),
            "url": job.get("jobUrl") or job.get("applyUrl") or f"https://jobs.ashbyhq.com/{slug}/{job.get('id')}",
            "posting_date": job.get("publishedAt", ""),
            "date_found": datetime.now(timezone.utc).isoformat(),
            "description": _strip_html(job.get("descriptionHtml") or job.get("descriptionPlain", "")),
            "source": "Ashby",
        } for job in payload.get("jobs", []) if job.get("isListed", True)]
    return []


def _strip_html(text):
    import re
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(text or ""))).strip()


def _location_match(job, location):
    import re
    text = f"{job.get('location','')} {job.get('description','')}".lower()
    location = (location or "").lower()
    if not location:
        return True
    if location == "bay area":
        return bool(re.search(r"bay area|san francisco|san jose|oakland|palo alto|mountain view|sunnyvale|santa clara", text))
    if location == "remote":
        return bool(re.search(r"remote|anywhere|worldwide|work from home", text))
    return location in text


def _salary_values(job):
    salary_text = str(job.get("salary", "") or "")
    description = str(job.get("description", "") or "")
    snippets = [salary_text] if salary_text else []
    snippets.extend(match.group(0) for match in re.finditer(r"(salary|compensation|pay range|base pay|annual pay|hourly pay|hourly rate|rate)[\s\S]{0,160}", description, re.I))
    values = []
    money_pattern = re.compile(r"(\$?\s*\d{2,3}(?:[,.]\d{3})?\s*(?:k|K|000)?|\$\s*\d{1,3})(?:\s*(?:-|to|–|—)\s*(\$?\s*\d{2,3}(?:[,.]\d{3})?\s*(?:k|K|000)?|\$\s*\d{1,3}))?")

    def parse_amount(raw, context):
        text = str(raw or "").strip()
        if not text:
            return None
        has_currency = "$" in text
        has_k = bool(re.search(r"k|K|000", text))
        digits_text = re.sub(r"[$,\s]", "", text).replace("k", "").replace("K", "")
        try:
            amount = float(digits_text)
        except ValueError:
            return None
        if re.search(r"k", text, re.I):
            amount *= 1000
        if "000" in text and "," not in text:
            amount *= 1000
        if not has_currency and not has_k and amount < 1000:
            return None
        if has_currency and amount < 200 and re.search(r"\b(hour|hourly|hr)\b", context, re.I):
            amount *= 2080
        if amount < 1000 and (has_currency or has_k):
            amount *= 1000
        return amount

    for snippet in snippets:
        for match in money_pattern.finditer(snippet):
            first = parse_amount(match.group(1), snippet)
            second = parse_amount(match.group(2), snippet)
            if first:
                values.append(first)
            if second:
                values.append(second)
    return [value for value in values if 20000 <= value <= 400000]


def _salary_match(job, salary_min=0, salary_max=0):
    if not salary_min and not salary_max:
        return True
    values = _salary_values(job)
    if not values:
        return True
    job_min, job_max = min(values), max(values)
    desired_min = salary_min or 0
    desired_max = salary_max or float("inf")
    return job_max >= desired_min and job_min <= desired_max


def search_public_jobs(profile, location="", days=7, delay=1.0, boards=None, salary_min=0, salary_max=0):
    keywords = generate_keywords(profile)
    jobs = []
    for keyword in keywords[:5]:
        rate_limit(delay)
        try:
            payload = _json_get("https://remotive.com/api/remote-jobs?search=" + urllib.parse.quote(keyword))
            jobs.extend(_normalize_remotive(payload))
        except Exception:
            pass
    rate_limit(delay)
    try:
        jobs.extend(_normalize_arbeitnow(_json_get("https://www.arbeitnow.com/api/job-board-api")))
    except Exception:
        pass
    for board in boards or []:
        rate_limit(delay)
        try:
            jobs.extend(_board_jobs(board))
        except Exception:
            pass
    seen = set()
    filtered = []
    for job in jobs:
        key = (job.get("title"), job.get("company"), job.get("url"))
        if key in seen or not job.get("url"):
            continue
        seen.add(key)
        _, _, disqualifying = visa_risk(job)
        if disqualifying:
            continue
        if not _location_match(job, location):
            continue
        if not _salary_match(job, salary_min, salary_max):
            continue
        filtered.append(score_job(job, profile, keywords))
    return sorted(filtered, key=lambda item: item.get("score", 0), reverse=True)
