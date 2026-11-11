#!/usr/bin/env bash
# تحديث النظام على الخادم بعد كل دفع إلى GitHub (يُستدعى يدوياً أو من GitHub Actions)
set -euo pipefail
cd "${APP_DIR:-/opt/raseed}"
BRANCH=${1:-main}
echo "==> نسخة احتياطية قبل التحديث"
bash deploy/backup.sh || true
echo "==> سحب آخر تحديث من $BRANCH"
git fetch origin "$BRANCH" && git checkout "$BRANCH" && git reset --hard "origin/$BRANCH"
echo "==> إعادة البناء والتشغيل (الترحيل يجري تلقائياً عند بدء الخادم)"
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null
sleep 5
curl -fsS http://127.0.0.1:${WEB_PORT:-8080}/api/health && echo " ✅ النظام يعمل"
