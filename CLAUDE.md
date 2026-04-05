# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**BSIS (Blue Sky Intelligence System)** — real-time Bluesky (AT Protocol) firehose monitor for geopolitical intelligence, focused on Iran conflict impacts on Saudi Aramco supply chains. The system ingests posts, applies LLM-based impact scoring (0–100), and surfaces high-signal events (score ≥ 50) on a live dashboard.

## Commands

### Docker (primary way to run everything)
```bash
docker compose up --build -d   # Start all services (db, ingestion, frontend)
docker compose ps              # Check service health
docker compose logs            # View logs
docker compose down -v         # Tear down and remove volumes
```

### Frontend (Next.js in `src/`)
```bash
cd src
npm install
npm run dev     # Dev server on port 3000
npm run build   # Production build
npm start       # Run production build
```

### Python ingestion script
```bash
uv sync                              # Install Python deps
uv run scripts/bluesky_ingestion.py  # Run locally (requires .env)
```

### Testing & linting
```bash
pytest                # Run all tests
ruff check .          # Lint Python (line length 120)
ruff format .         # Format Python
```

## Architecture

Three Docker services defined in `compose.yml`:
- **db** — PostgreSQL 16, stores `intelligence_events` table
- **ingestion** — Python 3.12 background process (`scripts/bluesky_ingestion.py`)
- **frontend** — Next.js 15 app (`src/`), port 3000

### Data flow
1. **Ingestion** (`scripts/bluesky_ingestion.py`): Connects to Bluesky firehose via WebSocket → regex keyword filter → account age check (≥30 days) with 1h profile cache → URL scraping (BeautifulSoup, 2000-char limit) → SHA256-based deduplication → RAG context retrieval (`docs/saudi_aramco_context.json` via OpenAI `text-embedding-3-large`) → LLM scoring (`gpt-5.4-nano-2026-03-17`) → INSERT into PostgreSQL if score ≥ 50. Runs 5 async workers with a max queue of 50; OpenAI concurrency capped at 3.

2. **Database** (`intelligence_events` table): Stores post metadata, impact score, actionable insights, reasoning, RAG context, and full LLM input for audit. A `NOTIFY` trigger fires on INSERT.

3. **Frontend** (`src/`): Next.js API routes fetch from PostgreSQL via a singleton connection pool (`src/lib/db.ts`). `GET /api/stream` uses PostgreSQL `LISTEN/NOTIFY` to push real-time SSE updates. The main `EventsTable` component paginates (10/page) and allows deleting events.

### Key API routes
| Route | Method | Purpose |
|---|---|---|
| `/api/posts` | GET | Fetch all events |
| `/api/posts/[id]` | DELETE | Delete event by ID |
| `/api/stream` | GET | SSE stream (real-time updates) |
| `/api/health` | GET | Health check |

## Development Conventions

- **Python**: ruff, line length 120, double quotes. Docstrings required for public functions/classes.
- **TypeScript**: Prettier (enforced via pre-commit).
- **Async**: All network I/O in the ingestion script is async/await. Use exponential backoff for external API calls.
- **CI**: GitHub Actions builds Docker images and verifies all services reach `healthy` state. LLM API calls are excluded from automated tests.
- **Environment**: Copy `.env.example` to `.env`. Required vars: `POSTGRES_*`, `OPENAI_API_KEY`.
- **RAG context**: `docs/saudi_aramco_context.json` — JSON array of objects with a `text` field, loaded at startup.
