# Conversation Token Management Strategy

## Problem

When a chatbot maintains multi-turn conversation history, each new request must include prior context for the LLM to produce coherent responses. As conversations grow, the accumulated tokens approach the model's context window limit and increase per-request cost. A token management strategy determines how the system selects which prior context to include in each request.

## Approaches

### 1. Full-History Window

Send the entire conversation — every user and assistant message — to the LLM on every turn.

**How it works:** The message array grows monotonically. No messages are ever dropped or modified.

**Advantages:**
- Zero information loss: the LLM has perfect recall of the entire conversation
- Trivially simple to implement — no summarization logic, no window tracking
- Deterministic: the same conversation always produces the same context

**Disadvantages:**
- Token cost grows with conversation length (input tokens increase every turn even if the question is short)
- Eventually hits the model's context window limit, at which point the request fails
- Long conversations may dilute the model's attention on the most recent question

**Best for:** Domain-specific Q&A where conversations are naturally short (5–20 turns).

---

### 2. Sliding Window (Fixed N Turns)

Keep only the most recent N message pairs. Older messages are silently dropped from the request.

**How it works:** A fixed-size FIFO buffer of messages. When a new turn is added and the buffer exceeds N pairs, the oldest pair is removed. All messages remain in the database; only the LLM request is truncated.

**Advantages:**
- Bounded, predictable token cost per request
- Simple to implement — just slice the message array
- No additional LLM calls for summarization

**Disadvantages:**
- "Amnesia" — the bot loses all context from dropped turns. Users notice when they reference something from the beginning of the conversation and the bot has no idea.
- The window size N is a crude control: too small and context is lost frequently; too large and you're back to the cost problem of full history.
- Abrupt information cliff — turn N+1 is fully present, turn N+2 is completely gone.

**Best for:** High-volume, low-depth interactions (customer support, simple Q&A) where early context rarely matters.

---

### 3. Summarization-Based Compression

When the conversation approaches the context limit, use an LLM call to compress the older portion into a concise summary, then prepend that summary as a system message.

**How it works:** A token budget is defined (e.g., 80% of the model's context window). Before each request, the system counts tokens in the full history. If the count exceeds the budget, the oldest messages are passed to a summarization LLM call. The resulting summary replaces those messages in the request context. The original messages remain in the database.

**Variants:**
- **On-demand summarization:** Summarize only when the budget is exceeded.
- **Rolling summary:** Update a running summary every K turns, regardless of budget pressure.
- **Hierarchical summarization:** Maintain summaries at multiple granularities (per-turn, per-topic, per-conversation).

**Advantages:**
- Preserves key facts from the full conversation in compressed form
- Bounded token cost (the summary is much shorter than the original messages)
- Graceful degradation — old context is compressed, not deleted

**Disadvantages:**
- Lossy — the summarizer decides what is "important," and may drop details the user considers critical
- Adds latency and cost for the summarization LLM call
- Summary quality varies by model and conversation complexity
- Introduces a second failure mode (summarization errors)

**Best for:** Long-running conversations where early context matters but cost must be controlled.

---

### 4. Hybrid: Full Recent + Summarized Old

Combine approaches 1 and 3. Keep the most recent N turns verbatim, and maintain a rolling summary of everything before that.

**How it works:** The conversation is split into two zones:
- **Recent zone** (last N message pairs): included verbatim in every request.
- **Archive zone** (everything before that): compressed into a rolling summary that is updated periodically or when the recent zone shifts.

The LLM request includes: system prompt, archive summary (if any), then the full recent messages.

**Advantages:**
- Recent context is lossless — the LLM can reference exact wording from recent turns
- Old context is preserved in compressed form — key facts survive
- Bounded cost: the archive summary has a fixed token budget

**Disadvantages:**
- Most complex to implement: requires token counting, summary generation, zone management
- Still lossy for old context (same limitation as approach 3)
- The boundary between zones can cause awkward transitions if a topic spans both

**Best for:** General-purpose chatbots that must handle both short and very long conversations gracefully.

---

## Decision: Full History with Hybrid Fallback

**Primary strategy: Full-History Window (Approach 1)**
**Fallback for long conversations: Hybrid (Approach 4)**

### Rationale

Daily Orbit conversations are **domain-specific Q&A about FCC filings, regulatory strategy, and competitive intelligence**. These conversations have several properties that favor full history:

1. **Naturally short.** Users ask a question, get an answer with citations, ask a follow-up or two, then start a new conversation on a different topic. Most conversations will be 5–15 turns.

2. **High reference density.** Users frequently say "what about the company from my first question?" or "compare that to the filing you mentioned earlier." Dropping early context would break these references.

3. **Domain context is expensive to re-establish.** If the LLM loses context about which filings and companies are under discussion, the RAG pipeline may retrieve different sources, producing inconsistent answers across turns.

4. **Cost is secondary to accuracy for this user base.** The target users are attorneys and business strategists who need reliable, citation-backed answers. Saving a few cents per request at the cost of "amnesia" is the wrong tradeoff.

### Implementation

- **Default behavior:** Send all messages in the conversation to the LLM on every turn.
- **Safety valve:** A configurable `maxConversationTurns` threshold (admin-configurable, default 50 turns). When a conversation exceeds this threshold, switch to hybrid mode: summarize the oldest messages beyond the most recent N turns, prepend the summary as context.
- **Token budget monitoring:** Before each request, estimate the total token count. If it would exceed 80% of the model's context window, trigger summarization regardless of turn count.
- **Summarization model:** Use a cheap, fast model (e.g., Nova Micro) for the compression call to minimize added latency and cost.
- **All messages are always persisted** in the database regardless of what is sent to the LLM. The compression is purely a request-construction optimization.

### Why Not Start With Hybrid?

Hybrid adds significant implementation complexity (token counting, summary generation and caching, zone management) for a scenario that most conversations will never hit. Starting with full history and adding the hybrid fallback as a safety valve means we ship faster, and the fallback is a well-defined future enhancement triggered by a simple threshold check.
