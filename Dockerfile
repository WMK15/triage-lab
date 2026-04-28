FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY triage-nurse/ .

RUN pip install --no-cache-dir .

EXPOSE 8080

CMD ["python", "-m", "triage_nurse.triage_env"]
