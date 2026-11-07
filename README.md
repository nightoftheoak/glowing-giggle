# Plano, TX temperature record

A small weather dashboard that records the real daily high and low temperature (°F) in Plano, TX,
keeps that record permanently in this repository, and compares today against the past 20 years.
It is built to show how local temperatures are changing over time, and especially **when autumn
arrives each year**.

## What the dashboard shows

| Section | What it answers |
|---|---|
| **Today vs. the past 20 years** | Live temperature, today's forecast high/low vs. the 20-year normal for this date, the warmest and coldest this date has been, and where today ranks. |
| **On this day, every year** | Pick any date (Halloween, Christmas, … one click) and see the high and low on that date for every year, with a trend line and a table. |
| **When does spring warm-up arrive?** | The date warm weather arrived each year, with a trend in days per decade. Five measures: a sustained warm-up (first 7-day stretch with an average at or above a temperature you choose, 70°F by default), last freeze, and the first 80°F+, 90°F+ and 100°F+ highs. |
| **When does autumn arrive?** | The date autumn arrived each year, with a trend in days per decade. Four measures: a sustained cool-down (first 7-day stretch with an average below a temperature you choose, 70°F by default), last 90°F+ day, first low ≤ 50°F, first freeze. |
| **Long-term averages** | Yearly, seasonal (including Sep–Nov autumn) or October average temperature, shown as warmer or cooler than the 20-year average. |
| **Every day vs. normal** | A heatmap with one row per year and one column per day, so warm Octobers and late summers stand out. |
| **Daily log** | Every recorded day with how far it was from normal. A CSV download is included. |

## How the record is kept

- `scripts/update_data.py` (Python standard library only) fetches daily temperatures from the free
  [Open-Meteo](https://open-meteo.com/) historical archive for Plano (33.02°N, 96.70°W). No API key is needed.
- The first run fills in every day from **2006-01-01** to yesterday. Later runs add only the new days.
- The archive runs about 5 days behind. Until it catches up, recent days come from Open-Meteo's
  recent-observations feed and are marked **provisional**. Once the archive has a day, it is marked
  **final** and the script never changes it again.
- `.github/workflows/update-weather.yml` runs the script every morning and commits any changes to
  `data/plano_daily.csv` (the main record) and `data/plano_daily.js` (the same data, formatted for the dashboard).

### Data source caveat
Open-Meteo's archive comes from ERA5 reanalysis, which blends weather-station readings, satellite data and a
weather model on a grid of about 9 km. It is consistent over time, which suits trend analysis, but a single day can
be a degree or two off from the official DFW Airport or a backyard thermometer.

## Setup

1. **Enable the daily update:** on GitHub, open the **Actions** tab, select *Update Plano temperatures* and click
   **Run workflow** once. The first run backfills 20 years of data, which takes about a minute. After that it runs daily.
   Scheduled runs happen only on the repository's default branch, and Actions needs write permission
   (Settings → Actions → General → Workflow permissions → *Read and write*).
2. **View the dashboard:**
   - Locally: clone the repo and open `index.html` in a browser. A server isn't needed.
   - Hosted: in Settings → Pages, set **Source** to **GitHub Actions**. The *Deploy dashboard to GitHub Pages*
     workflow publishes the site on every push to `main` and after each daily data update.
     (For a private repository, Pages needs a paid GitHub plan, and the published site is public.)

To run the update yourself: `python3 scripts/update_data.py`.
To keep a longer history (the archive goes back to 1940): `BACKFILL_START=1940-01-01 python3 scripts/update_data.py`.
The "normal" comparisons always use the 20 years before the current year.
