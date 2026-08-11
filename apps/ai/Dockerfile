FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MATERIAL_AI_TEMP_ROOT=/tmp/nalanda-material-ai

RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-impress fonts-dejavu-core fonts-noto-cjk util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 nalanda

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

RUN mkdir -p /tmp/nalanda-material-ai && chown -R nalanda:nalanda /tmp/nalanda-material-ai /app
USER nalanda

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
