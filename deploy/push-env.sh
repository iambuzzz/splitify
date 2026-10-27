#!/usr/bin/env bash
# Copies the API's settings from .env.local to the server (/etc/splitify/api.env), replacing the
# local-only ones with the server's. The values go over SSH straight into the file and are never printed.
# Run again after changing a key in .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET=${SPLITIFY_SSH:-ubuntu@13.203.57.144}
KEY=${SPLITIFY_KEY:-$HOME/.ssh/splitify-key.pem}
APP=${SPLITIFY_APP_URL:-https://splitify.iambuzzdev.in}

# Settings that differ on the server; everything else (database, Supabase, Resend) comes from .env.local.
SERVER_ONLY='HOST|PORT|TRUST_PROXY|CORS_ORIGINS|APP_URL|DATABASE_CA_CERT|RECEIPTS_DIR|RECEIPTS_BUCKET|PUSH_SENDER'
{
  grep -vE "^[[:space:]]*(#|$)" .env.local | grep -vE "^($SERVER_ONLY)="
  echo 'HOST=127.0.0.1'
  echo 'PORT=3001'
  echo '# Caddy sits in front, so the client address comes from its header.'
  echo 'TRUST_PROXY=1'
  echo "CORS_ORIGINS=$APP"
  echo "APP_URL=$APP"
  echo 'DATABASE_CA_CERT=/srv/splitify/api/supabase-ca.crt'
  echo '# Bill photos: the private Supabase Storage bucket (never a folder on this server).'
  echo 'RECEIPTS_BUCKET=receipts'
  echo '# Notifications go out from here only (a Mac running the API shares the database).'
  echo 'PUSH_SENDER=1'
} | ssh -i "$KEY" "$TARGET" 'sudo sh -c "umask 077 && cat > /etc/splitify/api.env.new && chown root:splitify /etc/splitify/api.env.new && chmod 0640 /etc/splitify/api.env.new && mv -f /etc/splitify/api.env.new /etc/splitify/api.env"'

echo "Settings on the server (names only):"
ssh -i "$KEY" "$TARGET" "sudo cut -d= -f1 /etc/splitify/api.env | grep -v '^#' | tr '\n' ' '; echo"
