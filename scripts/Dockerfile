FROM python:3.12-slim

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Keeps Python from buffering stdout/stderr and from writing .pyc files
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install all deps (including dev) into the project's .venv.
# Source is mounted as a volume — only pyproject.toml is needed here at build time.
COPY ../pyproject.toml uv.lock* ./
RUN uv sync --frozen

# Source code is volume-mounted at runtime — no COPY needed.
CMD ["uv", "run", "scripts/bluesky_ingestion.py"]

