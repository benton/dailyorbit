# Product Roadmap

## Short Term - Accessing all the data

- v0.1.0 [x] Data modeling and download
- v0.1.5 [x] Attachment discovery and download
- v0.1.6 [x] ICFS filing ingestion: transfer parties, service types, red light status, enriched metadata
- v0.1.7 [x] Show basic data set information and explore visualization library
- v0.2.0 [x] Basic Entity viewing and search
- v0.3.0 [x] Company entity, attribution & ownership tracking
- v0.3.5 [x] Enriched data model: Comment atttachments, timelines
- v0.4.0 [x] Attachment processing: text (markdown?) extraction
- v0.5.0 [x] Anonymous home page
- v0.6.0 [x] User authentication and profile
- v0.7.0 [x] User home page, preferences, and viewing history
- v0.8.0 [x] AI foundations: internal multi-model inference API w/cost accounting

## Medium Term - ML-driven features

- v1.0.0 [x] Summarizations: per Application, per Attachment
- v1.1.0 [x] Full text search via DuckDB BM25
- v1.2.0 [x] Vector-DB search via Bedrock embeddings
- v1.3.0 [x] News items Entity and RSS ingest of relevant news sources
- v1.4.0 [x] Ingestion pipeline admin UI
- v1.5.0 [~] News items UI - user and admin
- v1.6.0 [.] Premium feature: RAG and interrogation mode:
- v1.7.0 [ ] LLM-powered question answering / different "consultants"
- v1.8.0 [ ] RAG Search module

## Medium Term: The Daily Orbit Newspaper

- v2.0.0 [ ] Generate Newspaper layout home page
- v2.0.1 [ ] Article idea: News summary ("3 miles Up");
- v2.0.2 [ ] Article idea: "Over the Horizon" - Rotating Editorials from different "Editors" (e.g. Claude Antrhos, Gemini Baker, Rufus Bedrock);
- v2.0.3 [ ] Article idea: "Ask the Editor" - Premium Q&A feature (with user consent, share output anonymously next day in "Letters to the Editor")
- v2.0.4 [ ] Article idea: Wordcloud-based crossword puzze?
- v2.1.x [ ] More data - Track FCC notices from https://fcc.report/IBFS/Filing-List/Public-Notices.rss

## Long Term: Marketing / styling features

- v3.0.x [ ] Demo slideshow; focus on business motivation; ingestion pipeline with enrichment;
- v3.0.x [ ] Syndication from other LoE-satellite-related news sources

## Off the Wall Ideas or Nice to have

- v?.x.x [ ] ? Use DuckDB WASM to move functionality into the browser
- v?.x.x [ ] Parse GXT files
- v?.x.x [ ] Exponential backoff during ingest
- v?.x.x [ ] Document and Refine Company Entity attribution with Filings and News

## Bug fixes

- Fix page width toggle on all pages site wide - logic should be in top template - wide should strech forever with the browser window
- Attachment summary popup occurs on search results page, and Filing Details page Attachment list, but not on Home Page's Yesterdays Filings
- The left half of the Attachment summary popup is always cut off by the edge of the browser. it seems to "shift" slightly to the left of the mouseover, whereas it should "shift" right
- On the Filing details page, in the Milestones swim lane of Timeline visualization, some of the FCC-related events are really important changes of status: accepted for filing, and especially and final state: rejected, accepted, etc. We souhld make special Milestone types and put them in the legend so they're present at a glance.
- In fact, the current status of each Filing should be more prominently represented on the Filing details page in some predictable place. Consider "reifying" these Filings status states as a Typescript class with associated UI colors, desccriptions, etc.
- Filing Details page Attachment list should be sortable
- On the home page, Total Filings should also list Comments and Attachment (non Filig, non Comment) counts - but smaller than Filings because they're more important
- Can we Link M&A Activity on Home page to some visualization or list of events?
- Last 3 Months Filing Volume by Company should be Last 6 Months Filing Volume by Company (it looks too blocky and needs more data)
- On the home page, make the 3 lower full-width cards collapsable but open by default
