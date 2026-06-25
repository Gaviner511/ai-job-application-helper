import logging
import time
from pathlib import Path

LOG_PATH = Path("job_agent.log")


def setup_logging():
    logging.basicConfig(
        filename=LOG_PATH,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )


def rate_limit(seconds=1.0):
    time.sleep(seconds)


def safe_slug(value):
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in str(value)).strip("-")

