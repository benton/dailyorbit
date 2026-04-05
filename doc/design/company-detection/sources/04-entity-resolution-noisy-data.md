# Entity Resolution: Identifying Real-World Entities in Noisy Data

- **Source:** https://medium.com/data-science/entity-resolution-identifying-real-world-entities-in-noisy-data-3e8c59f4f41c
- **Retrieved:** 2026-04-05

## Overview

Entity resolution, also called record linkage or deduplication, identifies and merges duplicate or related records that lack unique identifiers within or across datasets. The process improves data quality and enables better decision-making across industries.

## The Entity Resolution Framework

The standard approach consists of four sequential steps:

### 1. Blocking

Divides datasets into smaller, manageable blocks containing records with similar attributes. This reduces the comparison space significantly. Three primary techniques:

- **Standard Blocking**: Partitions data based on specific attributes (simple but noise-sensitive)
- **Token Blocking**: Creates blocks using word tokens and n-grams, offering high recall at lower precision
- **Sorted Neighborhood**: Sorts records and applies a sliding window, balancing precision and recall

### 2. Block Processing

Refines blocks to minimize unnecessary comparisons through:

- **Block Purging**: Removes excessively large blocks likely dominated by redundant comparisons
- **Meta-blocking**: Converts blocks into graphs, pruning low-weight edges to eliminate superfluous pairs
- **Union Operations**: Combines multiple independent blocking results

### 3. Entity Matching

Compares candidate pairs by measuring attribute similarity and determining matches through thresholds. Two approaches:

- **Rule-based**: Averages field-specific similarity scores and applies predetermined thresholds
- **Machine Learning**: Trains models (like logistic regression) on labeled data for improved accuracy

### 4. Clustering

Groups matched records into clusters representing distinct real-world entities using single-pass algorithms:

- **Connected Components**: Merges clusters when connected nodes are found
- **Center Clustering**: Designates initial nodes as cluster centers
- **Merge-Center Clustering**: Allows multiple centers, merging clusters through connected centers

## Benchmark Dataset Implementation

The article demonstrates these techniques using MusicBrainz song data deliberately corrupted with duplicates and errors. The workflow involves:

1. Data loading and preprocessing (standardizing text fields)
2. Implementing blocking strategies
3. Computing similarity scores on attributes using cosine similarity and exact matching
4. Applying clustering algorithms
5. Evaluating results using Rand Index and Adjusted Rand Index metrics

## Key Evaluation Metrics

- **Rand Index**: Proportion of correctly clustered pairs
- **Adjusted Rand Index**: Corrected for random chance agreement

## Practical Takeaway

Token blocking produced the highest match volume in the demonstration, while sorted neighborhood achieved the highest matching rate. The choice depends on dataset characteristics and scalability requirements. Machine learning approaches outperformed rule-based methods when training data was available, though rule-based techniques remained competitive with fewer resource constraints.
