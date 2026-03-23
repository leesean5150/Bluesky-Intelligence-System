# BSIS — Post-Mortem & System Proposal

## Problem Understanding & Breakdown

The client requires a continuous, automated intelligence feed that monitors Bluesky social media for geopolitical events affecting Saudi Aramco's supply chain, specifically the ongoing Iran conflict. Four core constraints shaped every design decision:

1. **Real-time ingestion**: Intelligence is only actionable when it arrives ahead of the market. A batch pipeline would defeat the purpose, so the system must track the live firehose with minimal lag.

2. **Signal-to-noise balance**: The Bluesky public firehose emits thousands of posts per minute. Filtering must be strict enough to surface quality sources but tunable so operators can widen the net for exploration without a code change. An overly rigid filter risks dropping a credible source that doesn't fit the mould; an overly loose one wastes LLM budget on noise.

3. **Actionable, targeted output**: A generic news summary has no business value. The deliverable is an impact score (0–100) and a set of specific, actionable insights linking the breaking post to Aramco's operational exposure.

4. **Budget ceiling**: The system must run continuously for under $300/month with an MVP LLM spend under $5. This demands aggressive pre-filtering before any LLM token is spent.

---

## Architectural Choices

### Monolithic three-service composition

A microservice split would be over-engineering for a single business function. Three services (PostgreSQL, a Python async ingestion process, and a Next.js frontend) are orchestrated via Docker Compose. This provides a shared internal network and isolates dependencies. Crucially, Docker Compose handles system resilience by utilizing restart policies (restart: unless-stopped). If the ingestion service encounters a fatal crash or an unhandled WebSocket disconnect, the container automatically restarts, minimizing downtime for the live firehose.

Next.js was chosen over a separate API layer because its file-system routing collapses the backend API and the React frontend into one deployable artifact. PostgreSQL's mature `LISTEN/NOTIFY` mechanism provides real-time push from the database to the browser without a separate message broker.

### Event-driven, async-first ingestion

`AsyncFirehoseSubscribeReposClient` opens a single persistent WebSocket to the AT Protocol relay. Incoming records are handed off to an `asyncio.Queue` (capped at 50) and consumed by 5 async workers. CPU-bound work (BeautifulSoup HTML parsing) is offloaded to a thread via `asyncio.to_thread` to avoid blocking the event loop. To maintain high throughput during database inserts, the workers share an asynchronous database connection pool, eliminating the overhead of reinitializing connections for every post.

### Six-stage filter pipeline

Each stage is a gate; a post that fails any stage is dropped (except for trusted DID checks) before the next, more expensive stage runs:

| Stage | Mechanism |
|---|---|
| 1. Keyword regex | `ARAMCO_KEYWORDS` compiled regex on post text |
| 2. SHA-256 deduplication | Hash of URL or post text, checked against DB |
| 3. Trusted DID bypass | Hard-accept set of known verified accounts |
| 4. Label rejection | Hard-reject `spam`/`impersonation` labels from AT Protocol profile |
| 5. Composite trust score | Weighted score: domain trust (0.30) + account age (0.30) + follower ratio (0.40) ≥ threshold |
| 6. LLM impact scoring | `gpt-5.4-nano-2026-03-17` with RAG context, only if score ≥ 50 stored |

The composite score threshold (`FILTER_SCORE_THRESHOLD`, default 0.5) is an environment variable, allowing operators to tighten or loosen quality gates without touching code. Profiles are cached for 1 hour (TTL cache, 10k entries) to avoid redundant AT Protocol API calls for profile details.

Moreover, the pipeline is designed to expect and gracefully handle API failures and messy data:
1. Exponential Backoff: Calls to the LLM API are wrapped with retry logic (using python's inbuilt backoff decorator) with exponential backoff. This ensures transient rate limits or OpenAI server errors do not crash the pipeline or permanently drop high-value posts.
2. CLeaning and Sanitzation: Parsing logic between LLM calls and webscrape requests to ensure clean sanitized data that allow for information to be readily extracted.
3. Graceful Degradation: Broad exception catching is implemented around the parsing and LLM scoring modules. If a specific post causes a parsing error or schema validation failure, the error is logged gracefully, and the worker moves on to the next item in the queue rather than halting the process.
4. Error prevention: Finally, OpenAI API concurrency is capped at 3 via a semaphore to stay within rate limits and budget.

### RAG grounding

At startup, `docs/saudi_aramco_context.json` is vectorised with `text-embedding-3-large` and held in memory as a NumPy matrix. For each post that passes the filter, cosine similarity retrieves the top-2 context chunks. These are injected into the LLM prompt as **static background**, explicitly separated from the breaking post, with instructions to never attribute context facts to the post. This prevents hallucinated connections while still giving the model the geographic and operational vocabulary to reason about Aramco exposure.

---

## Mapping to Client Business Value

| Client Need | System Response |
|---|---|
| Proactive, continuous intelligence | Persistent WebSocket firehose; `restart: unless-stopped` on the ingestion service |
| Real-time dashboard | PostgreSQL `NOTIFY` trigger → SSE stream → live React table update without polling |
| Trusted, reputable sources only | Tiered filter: hard-reject spam labels, domain trust scoring, follower ratio |
| Actionable, targeted insights | LLM prompt instructs analyst role with Aramco-specific framing; output is scored and has a list of action items and stakeholders |
| Transparency | Direct URL references to the original Bluesky post, allowing analysts to verify claims and mitigate the risk of LLM hallucinations.  |
| Audit trail for LLM output | Full LLM input, retrieved RAG chunks, and raw reasoning stored per event in DB |
| Budget discipline | Pre-LLM filter eliminates redundant streamed data; nano-class model used; OpenAI concurrency capped |

---

## Plan for Scaling to Production

1. **Horizontal vs vertical scaling**: The frontend (stateless Next.js) scales horizontally behind a load balancer. The ingestion script is single-instance by design (one WebSocket consumer) and scales vertically — increase workers and queue size as throughput demands, tuned against observed peak firehose volume.

2. **Worker auto-sizing**: The current fixed `MAX_WORKERS=5` is a conservative default. Production sizing requires profiling the p95 latency per post through the pipeline (scrape + embedding + LLM) and choosing a worker count that keeps queue depth near zero under peak load without exhausting OpenAI rate limits.

3. **Kubernetes for production orchestration**: Replace Docker Compose with Kubernetes: a `StatefulSet` for Postgres with a persistent volume claim and replication, a `Deployment` for the frontend with horizontal pod autoscaling, and a single-replica `Deployment` for the ingestion pod which kubernetes restarts automatically on failure.

4. **Persistent message queue**: The current in-process `asyncio.Queue` drops posts when full (queue size 50). At scale, replace this with a durable broker (Kafka or Redis Streams) so burst traffic is absorbed without data loss and the ingestion worker can be restarted mid-batch without losing queued items.

5. **Richer deduplication**: SHA-256 on URL/text catches exact duplicates. Near-duplicate detection (paraphrases, quote-tweets) would require semantic similarity — either an embedding similarity threshold checked against a vector store (pgvector) or a Locality Sensitive Hashing index.

6. **Higher-quality RAG**: The current flat cosine retrieval is sufficient for an MVP. Production benefits from hybrid search (BM25 + dense retrieval) and scheduled context refresh via Apache Airflow to keep the Saudi Aramco knowledge base current with evolving geopolitical facts. Additionally, implementing GraphRAG would allow the system to model the relationships between emerging geopolitical stakeholders and Aramco's operational network, providing significantly stronger, relationally-aware context alongside the proposed standard RAG solution.

7. **Data Flywheel**: The data procurement pipeline can also integrate high-confidence, verified Bluesky posts, serving as a platform for new up to date information even as the application runs in production.

8. **Keyword and domain scaling**: The current regex and `endswith` loops are O(n) over small sets. At hundreds of keywords or trusted domains, replace with Aho-Corasick trie (keywords) and a hash set with suffix normalisation (domains) for faster matching.

9. **Database Migration**: Production requires a robust schema migration framework, ensuring that every database change is strictly version-controlled and safely applied during automated CI/CD pipelines, and provides a clear rollback path if a deployment fails.

---

## Implementation Challenges

### 1. Configurable filtering without per-user scraper instances

Making the filter tunable (threshold, weights, keyword list) while keeping a single ingestion process is a design tension. The current solution externalises key parameters as environment variables, which works for a single operator. For a multi-tenant deployment where different analysts want different sensitivity levels, each configuration would technically need its own worker pool, as a shared worker cannot apply different filters per user concurrently. A practical workaround would be RBAC with configuration bound to roles, with a dispatcher layer that routes posts to per-role queues, but this would significantly increase infrastructure complexity and is deferred beyond MVP.


## Mocks/LLM Assistance

The development process for this application made used of claude code and gemini cli, both of which have markdown files that have been pushed to the repository. The models were leveraged as design partners and code accelerators under a strict, human-in-the-loop review process:
1. Planning of the architecture started with clear constraints and expectations to the LLMs, as well as continued iterations. There were scenarios where the LLM made poor judgements of the architecture based on the user requirements, like defaulting to a microservice approach or using polling instead of streaming of the webdata, but also improved the code, like suggesting to use pool connection for the workers, and using domains or classification labels to filter bluesky posts.
2. Libraries and methods that were available were sourced from the LLMs, and documentation was double checked when exceptions were raised.
3. Frontend boilerplate and React components were generated using Claude Code, but had strict contraints like keeping the UI minimal, having a dropdown for extended content, as well as pagination to keep the page looking clean.
4. Last point to note would be that no code was auto accepted from prompting, and every line of code that was generated was manually checked to prevent hallucinations and poor code quality.