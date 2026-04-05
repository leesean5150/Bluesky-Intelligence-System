# Blue Sky Intelligence System

This system is designed to ingest live Bluesky data, filter out noise, identify key geopolitical stakeholders/influencers, and provide actionable insights regarding the ongoing Iran conflict. It specifically focuses on predicting how the conflict affects supply chains and market stability (e.g., Saudi Aramco).

## Project Overview

- **Core Purpose:** Real-time monitoring and analysis of Bluesky (AT Protocol) firehose for geopolitical intelligence.
- **Key Features:**
    - Live data ingestion from Bluesky via websocket (Firehose).
    - AI-driven semantic filtering and impact scoring using an LLM.
    - In-memory semantic retrieval for additional context (e.g., Saudi Aramco data).
    - Live-updating Next.js dashboard for data visualization.
    - Resilient, dockerized architecture with automatic self-healing.

## Architecture

This system follows a **monolithic architecture** where Next.js serves as the primary application layer, handling both the frontend and the business logic (including database interactions and data filtering).

1.  **Ingestion Script (`scripts/bluesky_ingestion.py`):**
    - A background process that connects to the Bluesky firehose using `atproto`.
    - Performs initial filtering based on keywords and account reputation/age.
    - Uses an LLM for impact scoring and insight generation.
    - Ingests processed events directly into the Postgres database.
2.  **Monolithic Application (`src/`):**
    - A Next.js application that handles all business logic, data fetching, and UI rendering.
    - Interacts directly with the Postgres database to retrieve, filter, and display data in the dashboard.
3.  **Infrastructure:**
    - **Postgres:** Central database for all ingested and processed data.
    - **Docker Compose:** Orchestrates the background ingestion script, the Next.js application, and the database.

## Tech Stack

- **Backend:** Python 3.12, `atproto`, `aiohttp`, `uv`.
- **Frontend:** Next.js (React/TypeScript).
- **Database:** PostgreSQL.
- **Testing:** `pytest`.
- **Linting/Formatting:** `ruff`.
- **Orchestration:** Docker Compose.

## Building and Running

### Development Setup

1.  **Environment Variables:**
    - Copy `.env.example` to `.env` and fill in the required credentials.
2.  **Python Dependencies:**
    - Ensure `uv` is installed.
    - Run `uv sync` to install dependencies and create a virtual environment.
3.  **Frontend Dependencies:**
    - (TODO: Document Next.js setup once implemented in `src/`).

### Execution

- **Docker Compose:**
    ```bash
    docker compose up --build
    ```
    This will start the Postgres database, the ingestion script, and the dashboard.
- **Running Ingestion Locally:**
    ```bash
    uv run scripts/bluesky_ingestion.py
    ```

### Testing and Quality

- **Run Tests:**
    ```bash
    pytest
    ```
- **Linting:**
    ```bash
    ruff check .
    ```
- **Formatting:**
    ```bash
    ruff format .
    ```

## Development Conventions

- **Resilience:** Code must be robust to API failures and messy data. Use comprehensive error handling and retries.
- **SDLC:** Follow strong software development lifecycle practices. Ensure all new features are covered by tests in `tests/`.
- **AsyncIO:** The ingestion pipeline is primarily asynchronous; use `async/await` for network operations.
- **Style:** Adhere to `ruff` configuration (line length 120, double quotes).

## CI/CD Pipeline

A CI/CD pipeline is triggered on every push to any branch to ensure the stability of the system.

- **Triggers:** Push to any branch.
- **Validation Steps:**
    - **Docker Health Checks:** Build and start all services using `compose.yml` and verify they reach a `healthy` state.
    - **Automated Testing:** Execute tests for the Next.js business logic, focusing on data retrieval (Read) and record removal (Delete) operations. **LLM API calls are explicitly excluded from the automated test suite to ensure stability and cost-efficiency.**
    - **Linting:** Run `ruff` for Python and `eslint` for Next.js to maintain code quality.

## Roadmap

- [ ] Implement robust ingestion logic in `scripts/bluesky_ingestion.py` (port from `notebooks/api_exploration.ipynb`).
- [ ] Set up LLM integration for semantic filtering and impact scoring.
- [ ] Create Saudi Aramco context JSON in `docs/` for semantic retrieval.
- [ ] Implement Next.js dashboard in `src/`.
- [ ] Configure Postgres schema and database migrations.
- [ ] Add comprehensive unit and integration tests.
