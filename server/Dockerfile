# Electronics Inventory API: REST API + MCP server (server/inventory_server.py).
# Build from the repository root:  docker build -f server/Dockerfile .
FROM alpine:3.20

# Pillow scales down photos added through the API (WebP/JPEG/PNG).
RUN apk add --no-cache python3 py3-pillow

WORKDIR /srv/app
COPY server/ /srv/app/server/
COPY app/js/defaults.js /srv/app/app/js/defaults.js

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    INVENTORY_DATA=/srv/data
EXPOSE 8000
USER 1000:1000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8000/api/health || exit 1

CMD ["python3", "/srv/app/server/inventory_server.py", "--api-only", "--host", "0.0.0.0", "--port", "8000"]
