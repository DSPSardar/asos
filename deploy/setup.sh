#!/bin/bash
# ─────────────────────────────────────────────────────────────
# ASOS v1 — Ubuntu VPS Setup Script
# Tested on: Ubuntu 22.04 LTS
# Run as root: bash deploy/setup.sh
# ─────────────────────────────────────────────────────────────

set -euo pipefail

DOMAIN=${1:-"yourdomain.com"}
APP_EMAIL=${2:-"admin@yourdomain.com"}
ASOS_DIR="/opt/asos"

echo "
╔══════════════════════════════════════════╗
║     ASOS v1 — Server Setup               ║
║     Domain: $DOMAIN
╚══════════════════════════════════════════╝
"

# ── 1. System update ──────────────────────────────────────────
echo "→ Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  curl wget git ufw fail2ban \
  ca-certificates gnupg lsb-release

# ── 2. Docker installation ────────────────────────────────────
echo "→ Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

if ! command -v docker-compose &>/dev/null; then
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
fi

echo "  Docker version: $(docker --version)"
echo "  Compose version: $(docker-compose --version)"

# ── 3. Firewall setup ─────────────────────────────────────────
echo "→ Configuring firewall (UFW)..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable
echo "  Firewall active"

# ── 4. Fail2ban ───────────────────────────────────────────────
echo "→ Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port    = 22
EOF
systemctl enable fail2ban
systemctl restart fail2ban

# ── 5. Create deploy directory ────────────────────────────────
echo "→ Creating ASOS directory: $ASOS_DIR"
mkdir -p "$ASOS_DIR"
mkdir -p "$ASOS_DIR/nginx/ssl"
mkdir -p "$ASOS_DIR/logs"

# ── 6. Clone / copy project ───────────────────────────────────
echo "→ Copy your project files to $ASOS_DIR"
echo "  Run: rsync -av ./ root@YOUR_SERVER_IP:$ASOS_DIR/"

# ── 7. SSL Certificate (Let's Encrypt) ────────────────────────
echo "→ Obtaining SSL certificate for $DOMAIN..."
apt-get install -y -qq certbot

# Initial cert (before nginx is running)
certbot certonly --standalone \
  --agree-tos \
  --non-interactive \
  --email "$APP_EMAIL" \
  -d "$DOMAIN" \
  -d "app.$DOMAIN" \
  -d "api.$DOMAIN" || {
    echo "  ⚠ SSL cert failed — you may need to point DNS first"
    echo "  Run manually: certbot certonly --standalone -d $DOMAIN -d app.$DOMAIN -d api.$DOMAIN"
  }

# Auto-renewal cron
(crontab -l 2>/dev/null; echo "0 0 1 * * certbot renew --quiet && docker-compose -f $ASOS_DIR/docker-compose.yml restart nginx") | crontab -

# ── 8. Environment file ───────────────────────────────────────
if [ ! -f "$ASOS_DIR/.env.production" ]; then
  cp "$ASOS_DIR/.env.production.example" "$ASOS_DIR/.env.production"
  # Generate secrets automatically
  JWT_SECRET=$(openssl rand -hex 64)
  JWT_REFRESH=$(openssl rand -hex 64)
  PG_PASS=$(openssl rand -hex 32)
  REDIS_PASS=$(openssl rand -hex 24)

  sed -i "s/CHANGE_ME_strong_random_password_here/$PG_PASS/g"      "$ASOS_DIR/.env.production"
  sed -i "s/CHANGE_ME_redis_password/$REDIS_PASS/g"                 "$ASOS_DIR/.env.production"
  sed -i "s/CHANGE_ME_min_64_chars.*/$JWT_SECRET/"                  "$ASOS_DIR/.env.production"
  sed -i "s/CHANGE_ME_different_64_chars.*/$JWT_REFRESH/"           "$ASOS_DIR/.env.production"
  sed -i "s/yourdomain.com/$DOMAIN/g"                               "$ASOS_DIR/.env.production"

  echo ""
  echo "  ✅ .env.production created with auto-generated secrets"
  echo "  ⚠  Still need to fill in:"
  echo "     - WHATSAPP_APP_SECRET"
  echo "     - WHATSAPP_VERIFY_TOKEN"
  echo "     - ANTHROPIC_API_KEY"
  echo "     - STRIPE_SECRET_KEY (if billing enabled)"
fi

# ── 9. Nginx config ───────────────────────────────────────────
sed -i "s/yourdomain.com/$DOMAIN/g" "$ASOS_DIR/nginx/nginx.conf"

# ── 10. Start services ────────────────────────────────────────
echo "→ Starting ASOS services..."
cd "$ASOS_DIR"
docker-compose --env-file .env.production pull
docker-compose --env-file .env.production up -d migrate
sleep 5
docker-compose --env-file .env.production up -d

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ASOS v1 Setup Complete!                 ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Dashboard: https://app.$DOMAIN"
echo "  API:       https://api.$DOMAIN"
echo "  Health:    https://api.$DOMAIN/health"
echo ""
echo "  WA Webhook URL (set in Meta Dev Console):"
echo "  https://api.$DOMAIN/webhooks/whatsapp"
echo ""
echo "  Seed demo data:"
echo "  docker exec asos_api node prisma/seed.js"
echo ""
echo "  View logs:"
echo "  docker-compose -f $ASOS_DIR/docker-compose.yml logs -f api"
