This system ingests live Bluesky data, filters out noise, identifies key geopolitical stakeholders/influencers, and provides actionable insights regarding the ongoing Iran conflict — specifically predicting how it affects Saudi Aramco supply chains and market stability.

## Architecture
This project uses a **monolithic architecture**:
- **Background Ingestion Script (`scripts/bluesky_ingestion.py`):** Connects to the Bluesky firehose via WebSocket, filters posts through a multi-tier pipeline, and stores high-signal events in a Postgres database.
- **Monolithic Next.js Application (`src/`):** Handles all business logic, data retrieval, and rendering. Displays events in a live-updating dashboard using Server-Sent Events (SSE) backed by PostgreSQL `LISTEN/NOTIFY`.

## Ingestion Filter Pipeline
Posts from the firehose pass through the following stages in order:

1. **Keyword filter** — Regex match on post text for terms: `aramco`, `samref`, `yanbu`, `ras tanura`, `oil facility`. Non-matching posts are dropped immediately.
2. **Deduplication** — SHA256-based event ID checked against the database.
3. **Secondary filters (tiered):**
   - *Hard accept:* Trusted DIDs bypass all further checks.
   - *Hard reject:* Accounts with Ozone moderation labels `spam` or `impersonation` are dropped.
   - *Composite score:* Weighted score across three signals must meet `FILTER_SCORE_THRESHOLD` (default `0.5`):
     - **Domain trust** (weight 0.30) — Trusted news/energy domains score 1.0; custom domains 0.7; `bsky.social` 0.4.
     - **Account age** (weight 0.30) — Gradient from 0.0 (<7 days) to 1.0 (≥1 year).
     - **Follower ratio** (weight 0.40) — `followers / following`; ratio ≥1.0 scores 1.0, low ratios indicate spam.
4. **Web scraping** — External URLs in posts are fetched and parsed (2000-char limit).
5. **RAG context retrieval** — Post text is embedded and matched against `docs/saudi_aramco_context.json` for relevant background.
6. **LLM analysis** — Scored by `gpt-5.4-nano` (0–100 impact score). Posts scoring below `IMPACT_SCORE_THRESHOLD` (default `50`) are discarded.

## Infrastructure & Setup
All services are dockerized, using Docker Compose as the orchestration engine to ensure the ingestion script is resilient and self-healing.

### Local Development
```bash
cp .env.example .env
# Fill in OPENAI_API_KEY and any other values
docker compose up --build -d
```
Monitor service health with `docker compose ps`.

### Environment Variables
| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | Required for LLM analysis and embeddings |
| `FILTER_SCORE_THRESHOLD` | `0.5` | Minimum composite account score to pass secondary filters |
| `TIMEZONE` | `Asia/Singapore` | Timezone for timestamps |
| `POSTGRES_*` | see `.env.example` | Database connection |

### CI/CD Pipeline
A GitHub Actions workflow runs on every push. It:
1. Builds all Docker images.
2. Starts Postgres, the ingestion script, and the frontend.
3. Verifies all services reach a `healthy` state.

LLM API calls are excluded from the automated test suite for cost and stability reasons.
