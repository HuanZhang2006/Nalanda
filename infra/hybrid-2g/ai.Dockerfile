# Python AI microservice — FastAPI
# Build context = apps/ai (see docker-compose.yml: ai.build.context = ../../apps/ai)
# Assumes the entry point is app in app/main.py and dependencies are in requirements.txt
# apps/ai exists and builds, but parsing/generation are still stubs not yet wired into the NestJS production path.

FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# Common system dependencies for document parsing (image/PDF processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY . .
EXPOSE 8000
# 2 GB host: a single worker to avoid doubling memory; BullMQ delivers jobs serially for concurrency
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
