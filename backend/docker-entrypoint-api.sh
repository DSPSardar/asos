#!/bin/sh
# Named Docker volumes are often root-owned; the API runs as non-root (asos).
# Ensure upload dirs exist and are writable before dropping privileges.
set -e
mkdir -p /app/uploads/content-images /app/uploads/reports
chown -R asos:nodejs /app/uploads
exec su-exec asos:nodejs "$@"
