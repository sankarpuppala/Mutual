# Mutual server — production image (docs/DEPLOYMENT.md).
# Build from the repository root:  docker build -f server/deploy/Dockerfile -t mutual-server .
FROM python:3.11-slim

# OTEL_SDK_DISABLED: fastapi depends on opentelemetry-api, which is inert without an SDK
# and exporter; neither is installed (test_no_telemetry_sdk_installed), and this keeps it so.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MUTUAL_ENV=prod \
    OTEL_SDK_DISABLED=true \
    MUTUAL_CONFIG=/data/config.yaml

# The repository layout is kept (/app/packages, /app/server) because the protocol reads
# packages/protocol-spec/constants.json relative to itself and the server resolves its
# config-relative paths from the repository root.
WORKDIR /app
COPY packages/protocol-spec packages/protocol-spec
COPY packages/protocol_py packages/protocol_py
COPY server server
RUN pip install -e packages/protocol_py -e server \
    && useradd --create-home --uid 10001 mutual \
    && mkdir -p /data && chown mutual:mutual /data

USER mutual
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"
CMD ["python", "server/deploy/start.py"]
