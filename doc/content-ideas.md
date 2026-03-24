# The Daily Orbit — Content Ideas

Brainstormed content blocks for the newspaper-style front page. These are candidates for v2.0.0 and beyond — not all will ship at once.

---

## 1. Hard News — Scraped & Lightly Processed

Low-cost, high-value blocks built on existing data or cheap scrapes.

### "Today's Filings" (live ticker)
Already exists. The newspaper's breaking news wire — refreshes by the minute. Style as a scrolling ticker or "LATE EDITION" sidebar.

### "Yesterday's Record" (daily filing recap)
Already exists. Reframe as the lead story table — "The Docket: [Business Day]'s Filings at a Glance." Zero LLM cost.

### "The Federal Register" — FCC Public Notices
Scrape `fcc.report/IBFS/Filing-List/Public-Notices.rss` (roadmap v2.1.x). Pure scrape — new public notices, accepted-for-filing notices. The regulatory "headlines" of the paper.

### "The Wire" — RSS News Headlines
Already scraped from SpaceNews, Via Satellite, etc. Top 5-10 headlines with source attribution. Summaries already exist. Minimal new cost.

---

## 2. Generated Analysis — LLM-Powered Columns

Cost Bedrock tokens but add unique value. Key principle: **generate once per day/week, cache aggressively.**

### "3 Miles Up" — Daily News Digest
2-3 paragraph AI-written summary of the day's most notable filings + news. Input: today's filings + recent news summaries. One Bedrock call/day. **Front-page lead article.**

### "Over the Horizon" — Rotating Weekly Editorial
Weekly column with rotating AI "editors," each with a distinct voice and angle:
- **Competitive dynamics** persona ("Who's gaining ground?")
- **Regulatory trends** persona ("What is the FCC signaling?")
- **Technology angles** persona ("What does this mean for spectrum?")

One Bedrock call/week. Could rotate on a fixed schedule (Mon = competitive, Wed = regulatory, Fri = tech).

### "The Orbital Forecast" — Weekly Trend Analysis
Brief analytical piece: "This week, Earth Station amendments were up 40% vs. the 90-day average, driven by [Company X]'s frequency coordination push." Input: filing volume stats + company attribution. One call/week.

### "Company Spotlight" — Weekly Profile
Rotate through top filers. Brief profile: recent filing activity, pending applications, competitive context. One call/week. Data is all in-house.

---

## 3. Fun / Atmospheric — Cheap Flavor

Make it *feel* like a newspaper without breaking the bank.

### "Washington Weather"
Free weather API for Washington, DC. Old-timey style: "Fair skies over the District, 72°F. Barometric pressure steady." Costs nothing.

### "Satellite Weather"
NOAA space weather data (solar flux, geomagnetic activity). "Solar conditions: quiet. Kp index: 2." Relevant to the industry AND delightful. Free APIs exist.

### "On This Day in Spectrum History"
Pre-generate ~365 historical blurbs about telecom/satellite milestones. One-time batch cost, then just a date lookup. "March 24, 1962 — The FCC grants the first commercial communications satellite license to AT&T for Telstar."

### "The Classifieds" — Tongue-in-Cheek
Fake humorous classified ads generated from real data: "FOR SALE: One (1) slightly used Earth Station authorization, Ka-band, East Coast pointing. Inquire within." Generate a batch weekly, rotate daily.

### Market Data Sidebar
Scrape stock prices for major public companies in the Company table (SES, EchoStar, Viasat, Iridium, etc.). Free APIs (Yahoo Finance, Alpha Vantage free tier). Newspaper-style stock ticker. **Directly useful** to the attorney audience.

---

## 4. Interactive / Premium Hooks

### "Ask the Editor"
Premium Q&A feature — user submits a question, gets AI answer via RAG against the full dataset. With consent, anonymized Q&A appears next day as "Letters to the Editor." Cost per-query, borne by premium user.

### "The Crossword"
Wordcloud-based crossword from the week's most frequent terms in filings/news. Weekly feature. One generation call/week.

---

## 5. Cost & Frequency Matrix

| Block | Source | Frequency | Bedrock Cost |
|---|---|---|---|
| Today's Filings | DB query | Live | $0 |
| Yesterday's Record | DB query | Daily | $0 |
| The Wire (RSS News) | Existing scrape | Daily | $0 |
| Federal Register Notices | New RSS scrape | Daily | $0 |
| Washington/Space Weather | Free API | Daily | $0 |
| Market Ticker | Free API | Daily | $0 |
| On This Day | Pre-generated | Daily (lookup) | ~$0 |
| **3 Miles Up** (digest) | LLM generation | Daily | ~$0.02-0.05/day |
| **Orbital Forecast** | LLM + stats | Weekly | ~$0.03/week |
| **Company Spotlight** | LLM + DB | Weekly | ~$0.03/week |
| **Over the Horizon** | LLM generation | Weekly | ~$0.05/week |
| **The Classifieds** | LLM batch | Weekly (rotate daily) | ~$0.02/week |
| Ask the Editor | RAG + LLM | On-demand (premium) | ~$0.05/query |
| The Crossword | LLM generation | Weekly | ~$0.02/week |

**Estimated monthly LLM cost for all generated content: ~$2-3/month** (excluding premium on-demand queries).

---

## 6. Imagery

All images are AI-generated or pre-built static assets. No scraped images are used, avoiding any consent or licensing issues. All imagery uses a consistent **steel engraving / crosshatch line drawing** style to match the early-1900s newspaper aesthetic.

Reference images are collected in `doc/design/`.

### Front Page Engraving — Daily Hero Image

One large illustration per day, generated at ~9am ET from the "3 Miles Up" daily summary prompt. The image depicts a scene or concept reflecting the day's top story — satellites, regulatory buildings, spectrum waves, corporate maneuvering — all rendered as a period-appropriate line drawing.

- **Style:** Steel engraving / crosshatch, black ink on transparent or parchment background
- **Resolution:** 1024×768 or similar (screen-only, no print)
- **Cost:** ~$0.01/day via Titan Image Generator v2 (~$0.30/month)
- **Prompt derivation:** Free — reuse the daily summary as image prompt input

### Fake Daily Advertisement

One tongue-in-cheek display ad per day. Primarily **typographic** (CSS-styled ornamental borders, vintage typefaces) with occasional small illustrations. Matches the real ads visible in the Bombay Chronicle and The Echo references — patent medicines, shipping lines, "Nestlé's Swiss Milk" style.

- **Text ads:** Zero image cost, pure CSS/HTML with vintage ornaments
- **Illustrated ads:** Generated weekly in batch (7 at once), ~$0.056/week
- **Recommendation:** Mostly typographic, occasionally illustrated. Funnier that way.

### Weekly Editorial Cartoon

One per week, tied to the "Over the Horizon" editorial. A single-panel editorial cartoon in crosshatch style — the visual equivalent of a Punch magazine illustration.

- **Cost:** ~$0.01/week (~$0.04/month)

### "(not) Portrait" Library — Generic Headshots

Pre-generate a library of ~50-100 generic line-drawing headshot portraits in Victorian engraving style (see `doc/design/ThisIsNotElonMusk.jpg` for the exact aesthetic). Varied by apparent age, gender, hair style — but deliberately not resembling any real person.

**Usage:** When a news article or filing mentions a notable person (FCC Chairman, CEO, etc.), display a deterministic-but-arbitrary portrait from the library. Hash the person's name to an index so they always get the same fictional "face." Caption with a playful disclaimer:

> *(artist's impression — not a likeness of [Name])*

or the cheeky shorthand:

> *(not) Chairman [Name]*

**Why this works:**
- Legally safe — no likeness rights issues
- Editorially honest — clearly and humorously labeled
- Running visual gag — readers learn to recognize "their" fictional portrait
- Deterministic — same person always gets the same face

**Library composition:**
- ~60 "standard" dignified portraits (suits, ties, varied demographics)
- ~20 "distinguished" portraits (monocles, top hats, enormous mustaches, pearl necklaces)
- ~20 "institutional" vignettes (a building labeled "FCC HQ," a satellite dish, a gavel, a briefcase)

**One-time generation cost:** 100 images × ~$0.008 = **~$0.80 total**

### Ornamental Section Headers

Pre-generate ~10-15 decorative section header vignettes in the style of `doc/design/REgularColumnHeading.jpg` — ornate borders with thematic illustrations (satellite dishes instead of steam trains, radio towers instead of factories). Used as static assets for recurring columns.

**One-time cost:** ~$0.12 total

### Image Cost Summary

| Image Type | Frequency | Monthly Cost |
|---|---|---|
| Front page engraving | Daily | ~$0.30 |
| Fake ad illustrations | ~2/week | ~$0.06 |
| Editorial cartoon | Weekly | ~$0.04 |
| **Monthly recurring total** | | **~$0.40** |
| Portrait library | One-time | ~$0.80 |
| Section headers | One-time | ~$0.12 |
| **One-time asset total** | | **~$0.92** |
