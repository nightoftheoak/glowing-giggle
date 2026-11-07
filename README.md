# Plano, TX temperature record

A small weather dashboard that records the real daily high and low temperature (°F) for the Dallas–Fort Worth
area from 1990 onward, keeps that record permanently in this repository, and compares each day with normal.
It is built to show how local temperatures are changing over time, and especially **when spring heat and
autumn cool-downs arrive each year**.

## What the dashboard shows

| Section | What it answers |
|---|---|
| **Compare against** (top of page) | What "normal" means everywhere on the page: the last 20 years (default), 1991–2020 (NOAA's official normals period), or the whole record. Your choice is remembered in your browser. |
| **Today vs. normal** | The current temperature, today's range so far and yesterday's range compared with normal for the date, the warmest and coldest this date has been, and where yesterday ranked. |
| **On this day, every year** | Pick any date (Halloween, Christmas, … one click) and see the recorded temperature range (low to high) on that date for every year, with trend lines and a table. |
| **When does spring warm-up arrive?** | The date warm weather arrived each year, with a trend in days per decade. Five measures: a sustained warm-up (first 7-day stretch with an average at or above a temperature you choose, 70°F by default), last freeze, and the first 80°F+, 90°F+ and 100°F+ highs. |
| **When does autumn arrive?** | The date autumn arrived each year, with a trend in days per decade. Four measures: a sustained cool-down (first 7-day stretch with an average below a temperature you choose, 70°F by default), last 90°F+ day, first low ≤ 50°F, first freeze. |
| **Hot days per year** | How many days each year reached 90°F (or 95°F / 100°F), with the trend, the longest streak, and how this year compares with other years by the same date. |
| **Long-term averages** | Yearly, seasonal (including Sep–Nov autumn) or October average temperature, shown as warmer or cooler than normal. |
| **Every day vs. normal** | A heatmap with one row per year and one column per day, so warm Octobers and late summers stand out. |
| **Daily log** | Every recorded day as a low-to-high range, with how far it was from normal and which station recorded it. A CSV download is included. |

## How the record is kept

- **Source:** the official daily high and low recorded by the National Weather Service at
  **Dallas/Fort Worth International Airport (KDFW)**, the official Dallas–Fort Worth climate record, about 20 miles
  south-west of Plano. Data comes from NOAA through the free [Applied Climate Information System](https://www.rcc-acis.org/)
  (ACIS), which needs no API key.
- **Why DFW:** Plano has no official station of its own. The nearest official station, McKinney airport (KTKI), only has
  records from 1998, and the stations that cover the 1990s near Plano don't line up with it. Using one station for the
  whole record keeps long-term trends free of false jumps from switching instruments. DFW's overnight lows run a few
  degrees warmer than north Collin County's, but that offset is steady, so the trends still hold.
- **Gaps:** on any day DFW didn't report, the Dallas Love Field (KDAL) reading is used, and the row's `source` column
  says `KDAL (gap fill for KDFW)`.
- `scripts/update_data.py` (Python standard library only) fills in every day from **1990-01-01** to yesterday on its
  first run. After that it adds new days.
- **Preservation:** stations sometimes correct a report within a few days, so the last 7 days are **provisional** and
  re-checked on every run. Older days are **final** and the script never changes them again.
- `.github/workflows/update-weather.yml` runs the script every morning and commits any changes to
  `data/plano_daily.csv` (the main record) and `data/plano_daily.js` (the same data, formatted for the dashboard).
- The daily average used for the warm-up and cool-down dates is NOAA's standard (high + low) ÷ 2.
- **Live readings:** the current temperature and today's range so far come from DFW's hourly observations
  (api.weather.gov). Hourly readings can miss a brief peak that the official daily high captures the next day.
- Earlier versions of this record used model estimates (Open-Meteo/ERA5) and then McKinney airport (KTKI) readings.
  Both were replaced when the source changed, and they're still in git history.

## Setup

1. **Enable the daily update:** on GitHub, open the **Actions** tab, select *Update Plano temperatures* and click
   **Run workflow** once. The first run backfills everything from 1990, which takes about a minute. After that it runs daily.
   Scheduled runs happen only on the repository's default branch, and Actions needs write permission
   (Settings → Actions → General → Workflow permissions → *Read and write*).
2. **View the dashboard:**
   - Locally: clone the repo and open `index.html` in a browser. A server isn't needed.
   - Hosted: in Settings → Pages, set **Source** to **GitHub Actions**. The *Deploy dashboard to GitHub Pages*
     workflow publishes the site on every push to `main` and after each daily data update.
     (For a private repository, Pages needs a paid GitHub plan, and the published site is public.)

To run the update yourself: `python3 scripts/update_data.py`.
To keep a longer history (DFW's record starts in 1974): `BACKFILL_START=1974-01-01 python3 scripts/update_data.py`.
