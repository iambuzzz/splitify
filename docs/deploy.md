# Deploy

The web app and the API both run on one AWS EC2 server. Set up 2026-10-23.

| What | Where |
|---|---|
| Web app | https://splitify.iambuzzdev.in (static files at `/srv/splitify/web`, served by Caddy) |
| API | https://api.splitify.iambuzzdev.in (Caddy → `127.0.0.1:3001`, systemd service `splitify-api`) |
| Server | EC2 `t3.micro`, ap-south-1 (Mumbai, same region as Supabase), Ubuntu 26.04 LTS, Elastic IP `13.203.57.144` |
| DNS | Cloudflare zone `iambuzzdev.in`: A records `splitify` and `api.splitify` → the Elastic IP, **DNS only** (Caddy holds the Let's Encrypt certificates; Cloudflare's free certificate does not cover two-level subdomains) |
| Email | Resend domain `splitify.iambuzzdev.in` (verified 2026-10-23, region Tokyo), sender `Splitify <login@splitify.iambuzzdev.in>`; its DNS records are in the same Cloudflare zone |
| SSH | `ssh -i ~/.ssh/splitify-key.pem ubuntu@13.203.57.144` (AWS security group allows SSH from the owner's IP only) |

## Ship a change
```
deploy/deploy.sh
```
It bundles the API into one file with esbuild, builds the web app with `EXPO_PUBLIC_API_URL` set to the live API, copies both with rsync, installs the Caddyfile and service unit, restarts the API and waits for `/health`.

After changing a key in `.env.local` (Resend, Supabase, database): `deploy/push-env.sh`. It rebuilds `/etc/splitify/api.env` (mode 640, root:splitify) from `.env.local`, replacing the server-only settings (`HOST`, `PORT`, `TRUST_PROXY=1`, `CORS_ORIGINS`, `APP_URL`, `DATABASE_CA_CERT`). Values go over SSH and are never printed. (It writes with `cat` and `mv`, not `install /dev/stdin`: Ubuntu 26.04's Rust coreutils `install` fails on that when the file already exists.) Then restart: `ssh … sudo systemctl restart splitify-api`.

## Files
- `deploy/setup-server.sh`: one-time setup, safe to rerun. 1 GB swap, ufw (SSH, 80, 443), Node.js 24 LTS from NodeSource and Caddy from its official repo (both signed apt repos), the `splitify` service user and folders.
- `deploy/Caddyfile`: HTTPS for both names, one-page-app fallback to `index.html`, long cache for hashed `/_expo/static` files, `no-cache` for the rest.
- `deploy/splitify-api.service`: runs `node --env-file=/etc/splitify/api.env server.mjs` as `splitify`, restarts on failure, 600 MB memory cap, filesystem read-only.

## Look at it
- Logs: `sudo journalctl -u splitify-api -f`
- Status: `systemctl status splitify-api caddy`
- Ubuntu security updates install on their own (`unattended-upgrades`).

## Still to do
- Supabase Auth → URL Configuration: add `https://splitify.iambuzzdev.in` (only used by the fallback link email).
- No CI deploy, no monitoring or uptime alerts yet. One server, so a server failure is downtime (data is safe in Supabase).
