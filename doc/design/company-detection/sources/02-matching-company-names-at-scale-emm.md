# Matching Company Names at Scale: ING's Entity Matching Model

- **Source:** https://medium.com/wbaa/matching-company-names-at-scale-af20429a80c7
- **Retrieved:** 2026-04-05

## Overview

ING Bank's Wholesale Banking Advanced Analytics team has open-sourced the Entity Matching Model (EMM), a Python package designed to solve the challenge of matching company names across large datasets efficiently.

## The Core Problem

Matching company names between datasets is computationally intensive. With a ground truth set of 10 million names and an external dataset of 30 million unique names, brute-force comparison would theoretically require nearly 1,000 years of processing at typical speeds.

EMM addresses this through intelligent filtering and machine learning, enabling ING's cluster of roughly 1,000 nodes to complete such matching tasks in approximately one hour.

## Solution Architecture

The EMM pipeline consists of four components:

### 1. Preprocessing

Standardizes and cleans company names and legal entity forms before matching.

### 2. Candidate Selection ("Indexing")

Rapidly identifies promising name-pair candidates using three methods:

- Word-based cosine similarity
- Character n-gram cosine similarity
- Sorted neighbourhood indexing

This stage leverages ING's `sparse_dot_topn` library for efficient sparse matrix multiplication.

### 3. Supervised Classification (Optional)

A trained XGBoost model ranks candidates, producing either similarity scores or match probabilities.

### 4. Aggregation (Optional)

Matches groups of related company names to single ground truth entries.

## Key Features

EMM employs four feature categories for matching:

- **String metrics**: Cosine similarity, Levenshtein, Jaro distance via RapidFuzz
- **Rank features**: Compare candidate pairs for the same name
- **Legal entity forms**: Extract and match company suffixes (Ltd, PLC, Co, etc.) using Cleanco
- **Additional data**: Country, address, or other contextual information

## Implementation Options

EMM provides both Pandas and Spark implementations with identical APIs. The Pandas version suits smaller datasets with minimal dependencies, while Spark handles millions of records across distributed clusters.

## Score Selection

Two scoring approaches serve different needs:

- **String similarity scores** identify all plausible matches for manual review
- **Match probabilities** filter candidates by confidence threshold

Users can combine both—applying similarity scoring first, then probability ranking—for optimal results.

## Getting Started

```
pip install -U emm
```

Or with Spark support:

```
pip install -U emm[spark]
```

The project includes comprehensive documentation, tutorial notebooks, and a full API reference. The source code is available on GitHub through ING Bank's public repositories.
