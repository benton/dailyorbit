# RAG Strategy: Query-Rewriting with Hybrid Retrieval

## 1. Overview

Daily Orbit v1.4 introduces a natural language query interface powered by Retrieval-Augmented Generation (RAG). Users can ask questions about the FCC filing corpus — applications, comments, attachments, news articles, and company data — and receive grounded, cited answers synthesized from the application's indexed documents.

## 2. Motivation

### 2.1. User Need

The target users — attorneys, paralegals, and business strategists — need to rapidly answer questions that cut across multiple document types and time periods. Examples:

- "What objections were raised to Hughes Network Systems' recent Ka-band application?"
- "Which companies have filed for NGSO constellation authority in the last 6 months?"
- "Summarize the FCC's concerns in the EchoStar/Hughes transfer of control proceeding."

These questions currently require manual navigation across Application, Comment, and News views, plus reading individual attachments. A RAG interface lets users get synthesized answers with source citations in seconds.

### 2.2. Why RAG (Not Just Search)

The existing search infrastructure (BM25 full-text + Titan V2 vector similarity) returns ranked document chunks, but the user must still read and synthesize across results. RAG closes the loop: it retrieves relevant chunks, then uses an LLM to synthesize a coherent, cited answer. This is especially valuable when the answer spans multiple filings or requires connecting information across document types (e.g., an application's technical parameters mentioned in an attachment with opposition arguments from a comment).

### 2.3. Why Query-Rewriting (Not Vanilla or Agentic RAG)

Three RAG architectures were considered:

| Approach | How retrieval works | Pros | Cons |
|---|---|---|---|
| **Vanilla RAG** | User query embedded directly → vector similarity search → top-K chunks → LLM answer | Simplest, lowest latency | Poor recall on domain jargon, file numbers, multi-part questions |
| **Query-rewriting RAG** | LLM rewrites user query into 1–2 optimized search queries → hybrid retrieval → LLM answer | Handles acronyms, legal terms, decomposed questions; moderate complexity | One extra LLM call per query |
| **Agentic/tool-use RAG** | LLM decides which APIs to call and generates structured requests → multi-step retrieval → LLM answer | Most flexible, can target specific data sources | Higher latency, more tokens, harder to debug and test |

**Query-rewriting RAG** is the right starting point for Daily Orbit because:

1. **Domain vocabulary is dense.** Users may write "Ka-band earth station STA" or "SAT-LOA filing for NGSO." A rewriting step expands abbreviations, resolves subsystem codes, and normalizes company name variants — dramatically improving retrieval recall.
2. **Multi-part questions are common.** "What did SpaceX file last month, and did anyone oppose it?" requires decomposition into separate retrieval queries before synthesis.
3. **Existing search API is already capable.** The hybrid BM25 + vector search covers both exact-match and semantic retrieval. We don't need the LLM to decide *which* API to call — we need it to formulate *better queries* for the one we have.
4. **Upgrade path is clear.** If users need multi-hop reasoning or cross-source joins, query-rewriting can be promoted to agentic tool-use without rearchitecting the retrieval layer.

## 3. Document Corpus Characteristics

The retrieval system must handle several structurally different document types, each with distinct chunking and relevance considerations.

### 3.1. Application Metadata

- **Structure:** Highly structured fields (file number, applicant, dates, status, subsystem, application type).
- **Size:** Small per-record (a few hundred characters of combined fields).
- **Retrieval pattern:** Exact match on file numbers and applicant names; filtered by subsystem, type, date range.
- **Chunking:** No chunking needed — each application is a single retrievable unit. Metadata fields should be concatenated into a searchable text representation.

### 3.2. Comments

- **Structure:** Semi-structured. Each comment has metadata (filer, date, proceeding) plus a text body that ranges from one paragraph to several pages.
- **Size:** Typically 100–5,000 words.
- **Retrieval pattern:** Semantic similarity on the comment body; filtered by associated application.
- **Chunking:** Short comments (< 1,000 tokens) are single chunks. Longer comments should be split at paragraph boundaries with overlap, retaining the comment's metadata (filer, application file number) on each chunk.

### 3.3. Attachments (PDF/Document Text)

- **Structure:** Unstructured extracted text from PDFs — technical exhibits, legal briefs, engineering analyses. Quality varies (OCR artifacts, table formatting loss).
- **Size:** 1 page to 200+ pages. The long tail is significant.
- **Retrieval pattern:** Semantic similarity; often the most substantively important content but buried in long documents.
- **Chunking:** Fixed-size chunks (512–1024 tokens) with ~100 token overlap, split at sentence boundaries. Each chunk carries attachment metadata (filename, parent application file number, page range estimate). Large attachments may need hierarchical summarization in a future iteration.

### 3.4. News Articles

- **Structure:** Semi-structured. Title, author, publication date, source, full text (markdown), LLM summary, company attribution.
- **Size:** Typically 500–3,000 words.
- **Retrieval pattern:** Semantic similarity on full text; exact match on company names and tags; date filtering.
- **Chunking:** Most articles fit in a single chunk. Articles exceeding ~1,500 tokens should be split at paragraph boundaries. The existing `summary` field can serve as a compressed retrieval target for broad relevance matching.

### 3.5. Company Data

- **Structure:** Structured entity data (name, aliases, parent company, description, ownership history).
- **Size:** Small per-record.
- **Retrieval pattern:** Exact match on company name and aliases; used primarily for filtering and grounding, not as direct answer content.
- **Chunking:** No chunking — each company is a single retrievable unit with aliases expanded.

## 4. Architecture

### 4.1. Query Flow

```
User question
    │
    ▼
┌─────────────────────────┐
│  1. Query Rewriting      │  LLM call: system prompt + user question
│     (Bedrock)            │  → 1–2 optimized search queries
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  2. Hybrid Retrieval     │  For each rewritten query:
│     BM25 + Vector        │  • BM25 full-text search (DuckDB FTS)
│                          │  • Vector similarity search (Titan V2)
│                          │  • Merge results by reciprocal rank fusion
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  3. Rerank (optional)    │  Score merged results by relevance
│                          │  to the original user question
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  4. Answer Generation    │  LLM call: system prompt + top-K chunks
│     (Bedrock)            │  with source metadata + user question
│                          │  → Grounded answer with citations
└─────────────────────────┘
```

### 4.2. Query Rewriting (Step 1)

A lightweight LLM call transforms the user's natural language question into 1–2 search queries optimized for the hybrid retrieval system. The rewriting prompt instructs the model to:

- Expand acronyms and abbreviations (e.g., "STA" → "Special Temporary Authority")
- Normalize company names to known aliases where possible
- Decompose multi-part questions into independent retrieval queries
- Preserve file numbers and other exact identifiers verbatim
- Add relevant domain context (e.g., expanding "Ka-band" to include frequency ranges if useful)

The output is structured JSON: an array of query objects, each with a `text` field and optional `filters` (date range, subsystem, company, document type).

### 4.3. Hybrid Retrieval (Step 2)

For each rewritten query:

1. **BM25 search** via the existing DuckDB FTS index — excels at exact terms, file numbers, legal phrases.
2. **Vector search** via Titan V2 embeddings in the `embedding` table — excels at semantic similarity, paraphrased concepts.
3. **Reciprocal Rank Fusion (RRF)** merges the two ranked lists into a single ranking. RRF is simple, parameter-light, and empirically strong: `score(d) = Σ 1/(k + rank_i(d))` where `k` is typically 60.

Optional filters from the rewritten query (date range, subsystem, document type) are applied as SQL predicates before scoring.

### 4.4. Reranking (Step 3)

After RRF, the top ~20 results are optionally reranked using either:

- **Cross-encoder reranking** via a dedicated model (e.g., Cohere Rerank on Bedrock, if available), or
- **LLM-based reranking** where a lightweight prompt scores each chunk's relevance to the original question on a 1–5 scale.

This step is optional at launch. Start without it, measure retrieval quality, and add reranking if precision is insufficient.

### 4.5. Answer Generation (Step 4)

The final LLM call receives:

- **System prompt:** Role definition (FCC filing analyst), citation format instructions, honesty constraints (say "I don't know" rather than hallucinate).
- **Retrieved chunks:** Top-K results (target: 5–10 chunks, ~3,000–6,000 tokens total), each tagged with source metadata:
  - Document type (application, comment, attachment, news)
  - Source identifier (file number, comment ID, attachment filename, article URL)
  - Date
  - Relevance score (for transparency, not shown to user)
- **User question:** The original, unmodified question.

The model produces a natural language answer with inline citations in a consistent format (e.g., `[SAT-LOA-20240701-00011]`, `[SpaceNews, 2025-12-15]`) that link back to the corresponding detail views in the application.

## 5. Citation and Grounding Requirements

Given the legal and business context of this application, citation quality is non-negotiable:

1. **Every factual claim must cite a source.** The answer generation prompt enforces this.
2. **Citations must be verifiable.** Each citation links to a specific document view in the application (Application View, attachment download, news article).
3. **No hallucinated sources.** The system prompt instructs the model to only cite documents present in the provided context. If the retrieved context is insufficient, the model should say so explicitly.
4. **Source diversity indicator.** Answers should note when evidence comes from a single source vs. multiple corroborating sources, helping users gauge confidence.

## 6. Quality and Evaluation

### 6.1. Retrieval Quality Metrics

- **Recall@K:** What fraction of relevant documents appear in the top K results? Measured against a manually curated evaluation set of ~50 question/relevant-document pairs.
- **Mean Reciprocal Rank (MRR):** How high does the first relevant result rank?

### 6.2. Answer Quality Metrics

- **Faithfulness:** Does the answer only contain claims supported by the retrieved chunks? (LLM-as-judge evaluation.)
- **Citation accuracy:** Does each citation actually support the claim it's attached to? (Manual spot-check.)
- **Completeness:** Does the answer address all parts of the user's question? (LLM-as-judge evaluation.)

### 6.3. Evaluation Set

Before launch, build a curated set of ~50 representative questions spanning:
- Single-application factual lookups
- Cross-application comparative questions
- Temporal questions ("What changed since...?")
- Company-centric questions
- Questions requiring attachment content
- Questions that *should* return "insufficient data"

## 7. Implementation Sequence

1. **Query rewriting endpoint** — LLM prompt + structured output parsing
2. **Hybrid retrieval integration** — Wire BM25 + vector search with RRF merging
3. **Answer generation endpoint** — LLM prompt with retrieved context + citation format
4. **API route** — `POST /api/query` accepting `{ question: string }`, returning `{ answer: string, sources: Source[] }`
5. **Frontend chat interface** — Query input, streaming answer display, clickable source citations
6. **Evaluation harness** — Automated retrieval + answer quality scoring against the curated set
7. **Reranking (if needed)** — Add cross-encoder or LLM reranking based on evaluation results
