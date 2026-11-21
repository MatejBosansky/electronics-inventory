#!/bin/sh
# Runs as root before nginx starts (official nginx image: /docker-entrypoint.d/).
# - makes nginx write files as PUID:PGID, so the data folder on the host stays owned by you
# - prepares the data folder layout
# - enables HTTP basic auth when AUTH_USER and AUTH_PASSWORD are set
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR=/srv/data
AUTH_CONF=/etc/nginx/electronics-inventory-auth.conf
HTPASSWD=/etc/nginx/electronics-inventory.htpasswd

log() {
    echo "electronics-inventory: $*"
}

case "$PUID$PGID" in
    *[!0-9]*)
        log "PUID and PGID must be numbers (got PUID=$PUID PGID=$PGID)"
        exit 1
        ;;
esac

# Worker processes run as the "nginx" user; give it the requested ids.
sed -i "s/^nginx:x:[0-9]*:[0-9]*:/nginx:x:${PUID}:${PGID}:/" /etc/passwd
sed -i "s/^nginx:x:[0-9]*:/nginx:x:${PGID}:/" /etc/group
chown -R nginx:nginx /var/cache/nginx

mkdir -p "$DATA_DIR/images/thumbs" "$DATA_DIR/backups" "$DATA_DIR/.tmp"
if ! chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null; then
    log "warning: could not change the owner of $DATA_DIR; saving may fail if it is not writable for $PUID:$PGID"
fi
log "data folder $DATA_DIR, files owned by $PUID:$PGID"

if [ -n "${AUTH_USER:-}" ] && [ -n "${AUTH_PASSWORD:-}" ]; then
    printf '%s:%s\n' "$AUTH_USER" "$(printf '%s' "$AUTH_PASSWORD" | openssl passwd -apr1 -stdin)" > "$HTPASSWD"
    chown root:nginx "$HTPASSWD"
    chmod 640 "$HTPASSWD"
    printf 'auth_basic "Electronics Inventory";\nauth_basic_user_file %s;\n' "$HTPASSWD" > "$AUTH_CONF"
    log "basic auth enabled for user $AUTH_USER"
else
    : > "$AUTH_CONF"
    log "basic auth disabled (set AUTH_USER and AUTH_PASSWORD to enable it)"
fi
