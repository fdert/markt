#!/usr/bin/env bash
# استعادة نسخة احتياطية: bash deploy/restore.sh /opt/raseed-backups/raseed-XXXX.sql.gz
set -euo pipefail
FILE=${1:?مسار النسخة الاحتياطية مطلوب}
cd "${APP_DIR:-/opt/raseed}"
read -r -p "سيُستبدل محتوى قاعدة البيانات الحالية. اكتب نعم للمتابعة: " ok; [ "$ok" = "نعم" ] || exit 1
docker compose stop api
docker compose exec -T db psql -U raseed -d postgres -c "DROP DATABASE IF EXISTS raseed WITH (FORCE);" -c "CREATE DATABASE raseed;"
gunzip -c "$FILE" | docker compose exec -T db psql -U raseed raseed
docker compose start api
