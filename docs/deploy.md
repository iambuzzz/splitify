# Deploy

The web app and the API both run on one AWS EC2 server. Set up 2026-10-23.

| What | Where |
|---|---|
| Web app | https://splitify.iambuzzdev.in (static files at `/srv/splitify/web`, served by Caddy). The landing page is at `/`, the app's home at `/groups` |
| Android app files | https://splitify.iambuzzdev.in/download/ (`/srv/splitify/downloads`, uploaded by `deploy/push-apk.sh`, kept apart from the web build) |
| API | https://api.splitify.iambuzzdev.in (Caddy → `127.0.0.1:3001`, systemd service `splitify-api`) |
| Server | EC2 `t3.micro`, ap-south-1 (Mumbai, same region as Supabase), Ubuntu 26.04 LTS, Elastic IP `13.203.57.144` |
| DNS | Cloudflare zone `iambuzzdev.in`: A records `splitify` and `api.splitify` → the Elastic IP, **DNS only** (Caddy holds the Let's Encrypt certificates; Cloudflare's free certificate does not cover two-level subdomains) |
| Email | Resend domain `splitify.iambuzzdev.in` (verified 2026-10-23, region Tokyo), sender `Splitify <login@splitify.iambuzzdev.in>`; its DNS records are in the same Cloudflare zone |
| SSH | `ssh -i ~/.ssh/splitify-key.pem ubuntu@13.203.57.144` (AWS security group allows SSH from the owner's IP only) |

## Ship a change
```
deploy/deploy.sh
```
It bundles the API into one file with esbuild, builds the web app with `EXPO_PUBLIC_API_URL` set to the live API, adds the landing page (`apps/landing/index.html` → `landing.html`, with the app's scripts prefetched once it has loaded) and the calculator and guide pages (`apps/landing/pages/*.html` → `/split-…`, built with `sitemap.xml` by `apps/landing/build-pages.mjs`), stamps the web build with a build id and writes `/version.json` (open copies of the website compare the two and offer **Update** in the Theme panel), copies both with rsync, installs the Caddyfile and service unit, restarts the API and waits for `/health`.

After changing a key in `.env.local` (Resend, Supabase, database): `deploy/push-env.sh`. It rebuilds `/etc/splitify/api.env` (mode 640, root:splitify) from `.env.local`, replacing the server-only settings (`HOST`, `PORT`, `TRUST_PROXY=1`, `CORS_ORIGINS`, `APP_URL`, `DATABASE_CA_CERT`). Values go over SSH and are never printed. (It writes with `cat` and `mv`, not `install /dev/stdin`: Ubuntu 26.04's Rust coreutils `install` fails on that when the file already exists.) Then restart: `ssh … sudo systemctl restart splitify-api`.

## Ship a new Android app
1. Bump `expo.version` in `apps/client/app.json` (phones on an older version then see "Splitify x.y is out").
2. Build both files on EAS (from `apps/client`):
   ```
   npx eas-cli build -p android --profile website-64bit
   npx eas-cli build -p android --profile website-32bit
   ```
   The profiles (`eas.json`) build one kind of chip each (`ORG_GRADLE_PROJECT_reactNativeArchitectures`), and `expo-build-properties` compresses the native code (`useLegacyPackaging`), which is what took the old single APK from 96 MB down.
3. Download both APKs, then `deploy/push-apk.sh <64-bit.apk> <32-bit.apk>`. It checks each file holds only its own chip code, uploads them as `splitify-<version>-64bit.apk` / `-32bit.apk`, points the stable names the landing page links to (`splitify-android.apk`, `splitify-android-32bit.apk`) at them, and writes `latest.json` (version, sizes) last. It keeps the current and the previous version.

Android App Links (`/join`, `/group` open the app) need the signing key's SHA-256 in `apps/client/public/.well-known/assetlinks.json`. Google sign-in in the app needs an **Android** OAuth client (package `in.iambuzzdev.splitify` + the key's SHA-1) in the same Google Cloud project as the web client; the app asks for an ID token for the **web** client id (`EXPO_PUBLIC_GOOGLE_CLIENT_ID`, also set in EAS for preview and production). A Play Store build signed by Google would need its fingerprints added to both.

## Notifications
- **How:** every change writes an activity event; the API on the server (`PUSH_SENDER=1`, set by `deploy/push-env.sh`) reads new events every 5 s through `app.push_take()` and sends them: phones through Expo's push service (FCM underneath), browsers through Web Push (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in `.env.local`, made with `npx web-push generate-vapid-keys`). New and changed bills are gathered for two minutes per person and group (in memory: a restart in that window drops that one batch). Lock screens show the group, a name and what happened, never amounts. Code: `apps/api/src/push.ts`, `apps/client/public/sw.js`, `apps/client/src/ui/useNotifications.ts`.
- **Never set `PUSH_SENDER=1` on a Mac:** the local API shares the live database and would take the server's events.
- **Android needs Firebase:** a Firebase project with the Android app `in.iambuzzdev.splitify`; its `google-services.json` stays out of git and goes to EAS as a file variable, read by `apps/client/app.config.js`:
  ```
  npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment preview --visibility secret
  ```
  The FCM V1 service account key (a secret JSON from Firebase → Project settings → Service accounts) is uploaded once in expo.dev → Credentials → Android → FCM V1. Without both, phones can't get a push token and the app says so.
- **iPhone:** Web Push works only in the app added to the Home Screen (iOS 16.4+); the app shows the steps in Safari.

## Files
- `deploy/setup-server.sh`: one-time setup, safe to rerun. 1 GB swap, ufw (SSH, 80, 443), Node.js 24 LTS from NodeSource and Caddy from its official repo (both signed apt repos), the `splitify` service user and folders.
- `deploy/Caddyfile`: HTTPS for both names; the landing page at `/` (unless the query has `code=` or `error=`, which are sign-in returns for the app); `/download/*` from `/srv/splitify/downloads` as APK downloads; a path with a matching `.html` file (the guides) serves that page; one-page-app fallback to `index.html` for every other path; long cache for hashed `/_expo/static` files, `no-cache` for the rest.
- `deploy/push-apk.sh`: puts a new Android build on the website (above).
- `deploy/splitify-api.service`: runs `node --env-file=/etc/splitify/api.env server.mjs` as `splitify`, restarts on failure, 600 MB memory cap, filesystem read-only.

## Look at it
- Logs: `sudo journalctl -u splitify-api -f`. A slow or failing bill-photo read from Supabase Storage logs `receipt storage read failed` with the status; the API tries each read twice (8 s each) and keeps about 40 MB of recently opened bills in memory.
- Status: `systemctl status splitify-api caddy`
- Ubuntu security updates install on their own (`unattended-upgrades`).

## Still to do
- Supabase Auth → URL Configuration: add `https://splitify.iambuzzdev.in` (only used by the fallback link email).
- No CI deploy, no monitoring or uptime alerts yet. One server, so a server failure is downtime (data is safe in Supabase).
