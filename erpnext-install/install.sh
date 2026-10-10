#!/usr/bin/env bash
# ERPNext on Docker (frappe_docker) — run as root on the VPS (Ubuntu/Debian).
# Usage:  bash install.sh
# Prompts for the domain and passwords, so nothing is stored in this file.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "شغّل السكربت بصلاحية root"; exit 1; }

read -rp  "Domain (e.g. erp.example.com): " SITE
read -rsp "ERPNext Administrator password: " ADMIN_PW; echo
read -rsp "MariaDB root password: " DB_PW; echo
[ -n "$SITE" ] && [ -n "$ADMIN_PW" ] && [ -n "$DB_PW" ] || { echo "كل الحقول مطلوبة"; exit 1; }
case "$ADMIN_PW$DB_PW" in *\'*|*\"*|*\\*|*\$*|*\`*|*" "*) echo "تجنب الرموز ' \" \\ \$ \` والمسافات في كلمات المرور"; exit 1;; esac

echo "== 1) تحديث النظام وتثبيت Docker =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git ca-certificates
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version >/dev/null

echo "== 2) استنساخ frappe_docker =="
mkdir -p /opt && cd /opt
[ -d frappe_docker ] || git clone https://github.com/frappe/frappe_docker.git
cd frappe_docker

echo "== 3) ملف البيئة =="
cp -n example.env .env
setenv() { grep -q "^$1=" .env && sed -i "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; }
setenv DB_PASSWORD "$DB_PW"
setenv FRAPPE_SITE_NAME_HEADER "$SITE"
setenv HTTP_PUBLISH_PORT 8080
chmod 600 .env

COMPOSE="docker compose -p erpnext -f compose.yaml -f overrides/compose.mariadb.yaml -f overrides/compose.redis.yaml -f overrides/compose.noproxy.yaml"

echo "== 4) تشغيل الحاويات =="
$COMPOSE up -d

echo "== 5) انتظار الاستقرار =="
for i in $(seq 1 60); do
  $COMPOSE exec -T backend ls sites/common_site_config.json >/dev/null 2>&1 && break
  sleep 5
done

echo "== 6) إنشاء الموقع وتثبيت erpnext =="
$COMPOSE exec -T backend bench new-site "$SITE" \
  --mariadb-user-host-login-scope='%' \
  --db-root-password "$DB_PW" \
  --admin-password "$ADMIN_PW" \
  --install-app erpnext \
  --set-default

echo "== 7) فحص =="
$COMPOSE ps
sleep 5
curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "Host: $SITE" http://127.0.0.1:8080/ || true

IP=$(curl -s ifconfig.me || echo "SERVER_IP")
echo
echo "تم. افتح:  http://$SITE:8080   أو   http://$IP:8080"
echo "المستخدم: Administrator    كلمة المرور: ما أدخلته أعلاه"
