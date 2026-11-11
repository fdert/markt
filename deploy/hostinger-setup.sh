#!/usr/bin/env bash
# إعداد خادم Hostinger VPS (Ubuntu 22.04/24.04) لأول مرة وتشغيل نظام رصيد
# الاستخدام: sudo bash hostinger-setup.sh https://github.com/USER/raseed.git pos.example.sa admin@example.sa
set -euo pipefail
REPO=${1:?رابط مستودع GitHub مطلوب}
DOMAIN=${2:?النطاق مطلوب، مثل pos.example.sa}
EMAIL=${3:?البريد مطلوب لشهادة SSL}
APP_DIR=/opt/raseed

echo "==> تحديث النظام وتثبيت المتطلبات"
apt-get update -y && apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw nginx certbot python3-certbot-nginx

if ! command -v docker >/dev/null; then
  echo "==> تثبيت Docker"
  curl -fsSL https://get.docker.com | sh
fi

echo "==> الجدار الناري"
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable

echo "==> جلب الكود"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull; else git clone "$REPO" "$APP_DIR"; fi
cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "==> إنشاء ملف البيئة .env"
  cat > .env <<ENV
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)
APP_URL=https://$DOMAIN
DOMAIN=$DOMAIN
WEB_PORT=8080
EMAIL=$EMAIL
ENV
  chmod 600 .env
fi

echo "==> تشغيل الحاويات"
docker compose up -d --build

echo "==> إعداد Nginx كوكيل عكسي"
cat > /etc/nginx/sites-available/raseed <<NGX
server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 20m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGX
ln -sf /etc/nginx/sites-available/raseed /etc/nginx/sites-enabled/raseed
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> شهادة SSL من Let's Encrypt"
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect || echo "تنبيه: تأكد أن النطاق يشير إلى IP الخادم ثم أعد: certbot --nginx -d $DOMAIN"

echo "==> النسخ الاحتياطي اليومي لقاعدة البيانات (02:30 بتوقيت الرياض)"
mkdir -p /opt/raseed-backups
cat > /etc/cron.d/raseed-backup <<CRON
CRON_TZ=Asia/Riyadh
30 2 * * * root cd $APP_DIR && bash deploy/backup.sh >> /var/log/raseed-backup.log 2>&1
CRON

echo "✅ تم. افتح https://$DOMAIN لإعداد المتجر وإنشاء حساب المالك."
