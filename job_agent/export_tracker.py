import csv
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

COLUMNS = ["title", "company", "location", "score", "recommendation", "salary", "visa_risk", "score_explanation", "reasons", "concerns", "resume_bullets", "cover_letter", "interview_talking_points", "url", "date_found"]


def export_csv(jobs, path="jobs.csv"):
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        for job in jobs:
            row = {key: job.get(key, "") for key in COLUMNS}
            row["reasons"] = "; ".join(job.get("reasons", []))
            row["concerns"] = "; ".join(job.get("concerns", []))
            row["resume_bullets"] = "; ".join(job.get("application_prep", {}).get("resume_bullets", []))
            row["cover_letter"] = job.get("application_prep", {}).get("cover_letter", "")
            row["interview_talking_points"] = "; ".join(job.get("application_prep", {}).get("interview_talking_points", []))
            writer.writerow(row)
    return path


def export_xlsx(jobs, path="jobs.xlsx"):
    rows = [COLUMNS] + [[
        "; ".join(job.get(column, [])) if column in {"reasons", "concerns"} else
        "; ".join(job.get("application_prep", {}).get("resume_bullets", [])) if column == "resume_bullets" else
        job.get("application_prep", {}).get("cover_letter", "") if column == "cover_letter" else
        "; ".join(job.get("application_prep", {}).get("interview_talking_points", [])) if column == "interview_talking_points" else
        job.get(column, "")
        for column in COLUMNS
    ] for job in jobs]
    sheet_rows = []
    for row_index, row in enumerate(rows, 1):
        cells = []
        for col_index, value in enumerate(row, 1):
            ref = f"{chr(64 + col_index)}{row_index}"
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>')
        sheet_rows.append(f"<row r=\"{row_index}\">{''.join(cells)}</row>")
    sheet = f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        zf.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        zf.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="jobs" sheetId="1" r:id="rId1"/></sheets></workbook>')
        zf.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
    return path


def load_jobs(path="jobs.json"):
    import json
    return json.loads(Path(path).read_text(encoding="utf-8")) if Path(path).exists() else []

def save_jobs(jobs, path="jobs.json"):
    import json
    Path(path).write_text(json.dumps(jobs, indent=2), encoding="utf-8")
    return path
