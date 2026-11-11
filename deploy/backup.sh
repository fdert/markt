#!/usr/bin/env bash
# نسخة احتياطية مضغوطة لقاعدة البيانات مع الاحتفاظ بآخر 14 نسخة
set -euo pipefail
cd "${APP_DIR:-/opt/raseed}"
DIR=/opt/raseed-backups; mkdir -p "$DIR"
FILE="$DIR/raseed-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T db pg_dump -U raseed raseed | gzip > "$FILE"
ls -1t "$DIR"/raseed-*.sql.gz | tail -n +15 | xargs -r rm --
echo "backup: $FILE"
