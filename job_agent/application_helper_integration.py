import webbrowser


def review_job(job):
    url = job.get("url")
    if not url:
        return False
    webbrowser.open(url)
    return True


SAFETY_NOTE = "Manual confirmation required. The helper may fill forms, but it must stop before final submit."

