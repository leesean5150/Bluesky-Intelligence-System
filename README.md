This system must ingest live Bluesky data, filter out noise, identify key geopolitical stakeholders/influencers, and provide actionable insights regarding the ongoing Iran conflict.

## Architecture
This project uses a **monolithic architecture**:
- **Background Ingestion Script:** In the `scripts` folder, code connects to the Bluesky network through a websocket to populate a Postgres database if the post hits the specified criteria. The data passes through an AI semantic filter using an LLM to predict market stability impact, utilizing extra context from a JSON file in the `docs` folder.
- **Monolithic Next.js Application:** The `src` folder will contain code for a Next.js application handling **all business logic**, data retrieval, and data filtering from the Postgres database. It will render the data in a live-updating dashboard.

## Infrastructure & Setup
All services are dockerized, using Docker Compose as the orchestration engine to ensure the ingestion script is resilient and self-healing.

### Local Development
To start the database and the background ingestion script:
```bash
cp .env.example .env
docker compose up --build -d
```
You can monitor the health of the services using `docker compose ps`.

### CI/CD Pipeline
A GitHub Actions workflow is configured to run on every push to any branch. This pipeline automatically:
1. Builds the Docker images.
2. Starts the Postgres database and ingestion script.
3. Verifies that both services reach a `healthy` state, ensuring foundational infrastructure integrity before merging.

Code-level resilience is a must through robust error handling. Code needs to demonstrate strong SDLC practices and programming best practices.