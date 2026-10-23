#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu server for Splitify (run on the server with sudo). Safe to run again.
# Installs Node.js 24 LTS (NodeSource) and Caddy (official repo), both from signed apt repositories,
# adds swap, a firewall, and the folders and service user the deploy uses.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }

# The server has about 1 GB of RAM; 1 GB of swap keeps a memory spike from killing the API.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg ufw

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' > /etc/apt/sources.list.d/nodesource.list
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y nodejs caddy

# Only SSH and web traffic in (the AWS security group limits SSH to the owner's IP as well).
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# The API runs as its own user with no shell and no login. The deploy user (ubuntu) owns the files;
# the API and Caddy only read them. Secrets live in /etc/splitify, readable by the API user only.
id splitify >/dev/null 2>&1 || useradd --system --home-dir /srv/splitify --no-create-home --shell /usr/sbin/nologin splitify
install -d -m 0755 /srv/splitify
install -d -m 0755 -o ubuntu -g ubuntu /srv/splitify/api /srv/splitify/web
install -d -m 0750 -o root -g splitify /etc/splitify

node --version
caddy version
