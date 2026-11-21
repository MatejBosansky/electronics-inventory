# Electronics Inventory — nginx serving the app and the data folder (multi-arch: amd64, arm64, …).
FROM nginx:stable-alpine

# openssl creates the password hash when basic auth is enabled.
RUN apk add --no-cache openssl \
    && touch /etc/nginx/electronics-inventory-auth.conf

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /docker-entrypoint.d/40-electronics-inventory.sh
COPY app/ /usr/share/nginx/html/
RUN chmod 0755 /docker-entrypoint.d/40-electronics-inventory.sh

ENV PUID=1000 \
    PGID=1000
VOLUME ["/srv/data"]
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
