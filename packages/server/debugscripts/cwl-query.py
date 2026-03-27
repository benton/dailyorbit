#!/usr/bin/env python3
"""
CloudWatch Logs Insights query runner for daily-orbit.

Reads query definitions from cwl-queries.json and runs them via the AWS CLI.

Usage:
    ./cwl-query.py <query-name> [--hours N] [--arg VALUE] [--format json|csv]
    ./cwl-query.py --list

Examples:
    ./cwl-query.py errors
    ./cwl-query.py slow --hours 1
    ./cwl-query.py path --arg /api/filings --hours 6
    ./cwl-query.py search --arg "backup" --hours 48 --format csv
    ./cwl-query.py status-codes --hours 24
"""

import argparse
import csv
import json
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


def load_queries() -> dict:
    queries_file = Path(__file__).parent / "cwl-queries.json"
    with open(queries_file) as f:
        return json.load(f)


def aws(*args: str) -> dict:
    """Run an AWS CLI command and return parsed JSON."""
    cmd = ["aws", *args, "--output", "json"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"AWS CLI error (exit {result.returncode}):\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)


def run_query(log_group: str, query: str, hours: int) -> list[dict]:
    """Start a Logs Insights query, poll until complete, return rows."""
    end = int(datetime.now(timezone.utc).timestamp())
    start = int((datetime.now(timezone.utc) - timedelta(hours=hours)).timestamp())

    # Collapse multiline queries — the API parser chokes on | at line start
    query = " ".join(line.strip() for line in query.splitlines() if line.strip())

    resp = aws(
        "logs", "start-query",
        "--log-group-name", log_group,
        "--start-time", str(start),
        "--end-time", str(end),
        "--query-string", query,
    )
    query_id = resp["queryId"]
    print(f"query_id={query_id}", file=sys.stderr)

    while True:
        time.sleep(1)
        resp = aws("logs", "get-query-results", "--query-id", query_id)
        status = resp["status"]
        if status not in ("Running", "Scheduled"):
            break

    if status != "Complete":
        print(f"Query failed: {status}", file=sys.stderr)
        sys.exit(1)

    stats = resp.get("statistics", {})
    matched = stats.get("recordsMatched", "?")
    scanned = stats.get("recordsScanned", "?")
    print(f"matched={matched} scanned={scanned}", file=sys.stderr)

    rows = []
    for result in resp["results"]:
        row = {
            f["field"]: f["value"]
            for f in result
            if not f["field"].startswith("@")
        }
        if row:
            rows.append(row)
    return rows


def format_json(rows: list[dict]) -> None:
    json.dump(rows, sys.stdout, indent=2)
    print()


def format_csv(rows: list[dict]) -> None:
    if not rows:
        return
    fields = list(dict.fromkeys(k for row in rows for k in row))
    writer = csv.DictWriter(sys.stdout, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)


def main() -> None:
    config = load_queries()
    query_names = list(config["queries"].keys())

    parser = argparse.ArgumentParser(
        description="Run CloudWatch Logs Insights queries for daily-orbit"
    )
    parser.add_argument(
        "query",
        nargs="?",
        choices=query_names,
        help="Query to run",
    )
    parser.add_argument("--hours", type=int, help="Hours of history to search")
    parser.add_argument("--arg", help="Argument for parameterized queries (path, search)")
    parser.add_argument("--format", choices=["json", "csv"], default="json", dest="fmt")
    parser.add_argument("--list", action="store_true", help="List available queries")
    args = parser.parse_args()

    if args.list or not args.query:
        print("Available queries:\n")
        for name, q in config["queries"].items():
            needs_arg = "{arg}" in q["query"]
            suffix = f"  (--arg required)" if needs_arg else ""
            print(f"  {name:16s} {q['description']}{suffix}")
        return

    qdef = config["queries"][args.query]
    query_str = qdef["query"]
    hours = args.hours or qdef["defaultHours"]

    if "{arg}" in query_str:
        if not args.arg:
            print(f"Error: '{args.query}' requires --arg <value>", file=sys.stderr)
            sys.exit(1)
        query_str = query_str.replace("{arg}", args.arg)

    log_group = config["logGroup"]
    print(f"==> {args.query} | last {hours}h | {log_group}", file=sys.stderr)

    rows = run_query(log_group, query_str, hours)

    if not rows:
        print("No results.", file=sys.stderr)
        return

    if args.fmt == "csv":
        format_csv(rows)
    else:
        format_json(rows)


if __name__ == "__main__":
    main()
