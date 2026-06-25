import argparse
import json
import logging
from pathlib import Path

from job_agent.export_tracker import export_csv, export_xlsx, load_jobs, save_jobs
from job_agent.job_finder import search_public_jobs
from job_agent.job_scorer import score_job
from job_agent.profile_store import load_profile
from job_agent.resume_parser import parse_resume, save_parsed_resume
from job_agent.safety import setup_logging


def cmd_parse_resume(args):
    parsed = parse_resume(args.resume)
    output = save_parsed_resume(parsed, args.output)
    print(f"Saved parsed profile to {output}")


def cmd_search_jobs(args):
    if args.resume:
        parsed = parse_resume(args.resume)
        save_parsed_resume(parsed, args.profile)
    profile = load_profile(args.profile)
    jobs = search_public_jobs(profile, location=args.location, days=args.days, boards=args.board, salary_min=args.salary_min, salary_max=args.salary_max)
    save_jobs(jobs, args.output)
    print(f"Saved {len(jobs)} scored jobs to {args.output}")


def cmd_score_jobs(args):
    profile = load_profile(args.profile)
    jobs = load_jobs(args.input)
    keywords = profile.get("targetRoles", [])
    scored = [score_job(job, profile, keywords) for job in jobs]
    save_jobs(scored, args.output)
    print(f"Saved {len(scored)} rescored jobs to {args.output}")


def cmd_export(args):
    jobs = load_jobs(args.input)
    csv_path = export_csv(jobs, args.csv)
    xlsx_path = export_xlsx(jobs, args.xlsx)
    print(f"Exported {csv_path} and {xlsx_path}")


def cmd_run_all(args):
    parsed = parse_resume(args.resume)
    save_parsed_resume(parsed, args.profile)
    profile = load_profile(args.profile)
    jobs = search_public_jobs(profile, location=args.location, days=args.days, boards=args.board, salary_min=args.salary_min, salary_max=args.salary_max)
    save_jobs(jobs, args.jobs)
    export_csv(jobs, args.csv)
    export_xlsx(jobs, args.xlsx)
    print(f"Run complete. Parsed profile, saved {len(jobs)} jobs, exported CSV/XLSX.")


def build_parser():
    parser = argparse.ArgumentParser(description="AI Job Match Agent CLI. It never auto-submits applications.")
    sub = parser.add_subparsers(dest="command", required=True)

    parse_resume_cmd = sub.add_parser("parse-resume")
    parse_resume_cmd.add_argument("--resume", required=True)
    parse_resume_cmd.add_argument("--output", default="profile_store.json")
    parse_resume_cmd.set_defaults(func=cmd_parse_resume)

    search_cmd = sub.add_parser("search-jobs")
    search_cmd.add_argument("--resume")
    search_cmd.add_argument("--profile", default="profile_store.json")
    search_cmd.add_argument("--location", default="")
    search_cmd.add_argument("--days", type=int, default=7)
    search_cmd.add_argument("--board", action="append", default=[], help="Optional ATS board, e.g. greenhouse:starburst, lever:company, ashby:company")
    search_cmd.add_argument("--salary-min", type=int, default=0)
    search_cmd.add_argument("--salary-max", type=int, default=0)
    search_cmd.add_argument("--output", default="jobs.json")
    search_cmd.set_defaults(func=cmd_search_jobs)

    score_cmd = sub.add_parser("score-jobs")
    score_cmd.add_argument("--profile", default="profile_store.json")
    score_cmd.add_argument("--input", default="jobs.json")
    score_cmd.add_argument("--output", default="jobs.json")
    score_cmd.set_defaults(func=cmd_score_jobs)

    export_cmd = sub.add_parser("export")
    export_cmd.add_argument("--input", default="jobs.json")
    export_cmd.add_argument("--csv", default="jobs.csv")
    export_cmd.add_argument("--xlsx", default="jobs.xlsx")
    export_cmd.set_defaults(func=cmd_export)

    run_all_cmd = sub.add_parser("run-all")
    run_all_cmd.add_argument("--resume", required=True)
    run_all_cmd.add_argument("--location", default="")
    run_all_cmd.add_argument("--days", type=int, default=7)
    run_all_cmd.add_argument("--board", action="append", default=[], help="Optional ATS board, e.g. greenhouse:starburst, lever:company, ashby:company")
    run_all_cmd.add_argument("--salary-min", type=int, default=0)
    run_all_cmd.add_argument("--salary-max", type=int, default=0)
    run_all_cmd.add_argument("--profile", default="profile_store.json")
    run_all_cmd.add_argument("--jobs", default="jobs.json")
    run_all_cmd.add_argument("--csv", default="jobs.csv")
    run_all_cmd.add_argument("--xlsx", default="jobs.xlsx")
    run_all_cmd.set_defaults(func=cmd_run_all)
    return parser


def main():
    setup_logging()
    parser = build_parser()
    args = parser.parse_args()
    logging.info("Running command: %s", args.command)
    args.func(args)


if __name__ == "__main__":
    main()
