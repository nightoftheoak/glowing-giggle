#!/usr/bin/env python3
"""Fetch and preserve observed daily temperatures for Plano, TX.

Run daily (the GitHub Actions workflow does this). Standard library only.

Source
------
Recorded daily high and low temperatures from NOAA weather stations, served by
the Applied Climate Information System (ACIS, data.rcc-acis.org). No API key.

- Primary:  Dallas/Fort Worth International Airport (KDFW), the official
            Dallas-Fort Worth climate record. It is complete back to 1974,
            which no station nearer Plano is, and one station throughout keeps
            long-term trends free of jumps from switching instruments.
- Gap fill: Dallas Love Field (KDAL), used only for days KDFW did not report.
            Those rows say so in the `source` column.

How the record is kept
----------------------
- The first run fills every day from BACKFILL_START to yesterday.
- Days from the last 7 days are `provisional`: stations sometimes correct
  their reports, so these are re-fetched on every run.
- Older days are `final` and never rewritten, so the record is preserved.
  The one exception is a deliberate change of station: rows from any source
  other than PRIMARY/FALLBACK below are replaced (git history keeps them).
- `mean_f` is the daily average NOAA uses: (high + low) / 2.

Outputs data/plano_daily.csv (canonical) and data/plano_daily.js (same data
for the dashboard, so index.html also works when opened as a local file).
All temperatures are degrees Fahrenheit, as recorded (whole degrees).
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

CITY = "Plano, TX"
TZ = "America/Chicago"
PRIMARY = {"sid": "03927 1", "code": "KDFW", "name": "DFW International Airport", "lat": 32.8998, "lon": -97.0403}
FALLBACK = {"sid": "13960 1", "code": "KDAL", "name": "Dallas Love Field", "lat": 32.8519, "lon": -96.8555}
BACKFILL_START = dt.date.fromisoformat(os.environ.get("BACKFILL_START", "1990-01-01"))
PROVISIONAL_DAYS = 7

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "plano_daily.csv"
JS_PATH = ROOT / "data" / "plano_daily.js"
FIELDS = ["date", "high_f", "low_f", "mean_f", "status", "source"]
ACIS_URL = "https://data.rcc-acis.org/StnData"


def fetch_station(sid: str, start: dt.date, end: dt.date) -> dict[str, tuple[float, float]]:
    """Daily (high, low) in °F for one station; days with a missing value are left out."""
    body = json.dumps({"sid": sid, "sdate": start.isoformat(), "edate": end.isoformat(), "elems": "maxt,mint"}).encode()
    last_err: Exception | None = None
    for attempt in range(5):
        try:
            req = urllib.request.Request(ACIS_URL, data=body, headers={
                "Content-Type": "application/json", "User-Agent": "plano-temperature-record/2.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.load(resp)
            break
        except Exception as err:  # network hiccup: back off and retry
            last_err = err
            time.sleep(2 ** attempt * 2)
    else:
        raise RuntimeError(f"ACIS request failed for {sid}: {last_err}")
    if "error" in payload:
        raise RuntimeError(f"ACIS error for {sid}: {payload['error']}")

    def num(v: str) -> float | None:
        v = (v or "").strip().rstrip("ASTE")  # drop any trailing data flags
        try:
            return float(v)
        except ValueError:
            return None  # "M" = missing

    out = {}
    for day, hi, lo in payload.get("data", []):
        hi, lo = num(hi), num(lo)
        if hi is not None and lo is not None and hi >= lo:
            out[day] = (hi, lo)
    return out


def gap_fill_label() -> str:
    return f"{FALLBACK['code']} (gap fill for {PRIMARY['code']})"


def load_record() -> dict[str, dict]:
    if not CSV_PATH.exists():
        return {}
    with CSV_PATH.open(newline="") as fh:
        rows = {row["date"]: row for row in csv.DictReader(fh) if row.get("date")}
    # Rows from an earlier data source (Open-Meteo model estimates, then McKinney
    # airport KTKI) are replaced when the station changes; git history keeps them.
    current = {PRIMARY["code"], gap_fill_label()}
    old = [d for d, r in rows.items() if r.get("source") not in current]
    if old:
        print(f"Replacing {len(old)} days from an earlier data source with {PRIMARY['code']} records.", file=sys.stderr)
        for d in old:
            del rows[d]
    return rows


def save_record(record: dict[str, dict]) -> None:
    rows = [record[k] for k in sorted(record)]
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({f: r.get(f, "") for f in FIELDS})

    sources = sorted({r["source"] for r in rows})
    compact = [
        [r["date"], float(r["high_f"]), float(r["low_f"]), float(r["mean_f"]),
         1 if r["status"] == "provisional" else 0, sources.index(r["source"])]
        for r in rows
    ]
    meta = {
        "city": CITY,
        "timezone": TZ,
        "station": PRIMARY,
        "fallback": FALLBACK,
        "sources": sources,
        "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "columns": ["date", "high_f", "low_f", "mean_f", "provisional", "source_index"],
    }
    JS_PATH.write_text(
        "// Generated by scripts/update_data.py - do not edit by hand.\n"
        f"window.PLANO_META = {json.dumps(meta)};\n"
        f"window.PLANO_DATA = {json.dumps(compact, separators=(',', ':'))};\n"
    )


def put(record: dict, day: str, hi: float, lo: float, status: str, source: str) -> bool:
    existing = record.get(day)
    if existing and existing["status"] == "final":
        return False  # preserved history is never rewritten
    new = {"date": day, "high_f": f"{hi:.0f}", "low_f": f"{lo:.0f}", "mean_f": f"{(hi + lo) / 2:.1f}",
           "status": status, "source": source}
    if existing == new:
        return False
    record[day] = new
    return True


def main() -> int:
    today = dt.datetime.now(ZoneInfo(TZ)).date()
    yesterday = today - dt.timedelta(days=1)
    final_before = today - dt.timedelta(days=PROVISIONAL_DAYS)
    record = load_record()

    needed = []
    d = BACKFILL_START
    while d <= yesterday:
        r = record.get(d.isoformat())
        if not r or r["status"] != "final":
            needed.append(d)
        d += dt.timedelta(days=1)
    if not needed:
        print("Record already complete.")
        save_record(record)
        return 0

    start, end = needed[0], yesterday
    print(f"Fetching {PRIMARY['code']} and {FALLBACK['code']} for {start} .. {end}", file=sys.stderr)
    primary = fetch_station(PRIMARY["sid"], start, end)
    fallback = fetch_station(FALLBACK["sid"], start, end)

    changed = filled = missing = 0
    for day in needed:
        key = day.isoformat()
        status = "final" if day < final_before else "provisional"
        if key in primary:
            changed += put(record, key, *primary[key], status, PRIMARY["code"])
        elif key in fallback:
            changed += put(record, key, *fallback[key], status, gap_fill_label())
            filled += 1
        else:
            missing += 1

    save_record(record)
    finals = sum(1 for r in record.values() if r["status"] == "final")
    print(f"{changed} day(s) added/updated ({filled} gap-filled from {FALLBACK['code']}, {missing} unavailable); "
          f"{len(record)} days on record ({finals} final).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
