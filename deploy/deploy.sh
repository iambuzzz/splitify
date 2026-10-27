#!/usr/bin/env bash
# Builds the API (one bundled file) and the web app on this Mac, puts both on the server,
# and restarts the API. Run from anywhere: deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET=${SPLITIFY_SSH:-ubuntu@13.203.57.144}
KEY=${SPLITIFY_KEY:-$HOME/.ssh/splitify-key.pem}
API=${SPLITIFY_API_URL:-https://api.splitify.iambuzzdev.in}
SSH=(ssh -i "$KEY" "$TARGET")

echo "1/4 Building the API"
rm -rf dist
node_modules/.bin/esbuild apps/api/src/index.ts --bundle --platform=node --format=esm --target=node22 \
  --outfile=dist/api/server.mjs --external:pg-native --log-level=warning \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
cp supabase/prod-ca-2021.crt dist/api/supabase-ca.crt

echo "2/4 Building the web app (API: $API)"
# Each website build gets an id; open copies compare theirs with /version.json and offer Update.
VERSION=$(node -p 'require("./apps/client/app.json").expo.version')
BUILD="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
# A value set here wins over apps/client/.env.local, which points at the local API.
(cd apps/client && EXPO_PUBLIC_API_URL="$API" EXPO_PUBLIC_WEB_BUILD="$BUILD" npx expo export --platform web --output-dir ../../dist/web >/dev/null)
grep -rqF "$BUILD" dist/web/_expo || { echo "The web build does not carry its build id"; exit 1; }
printf '{"version":"%s","build":"%s"}\n' "$VERSION" "$BUILD" > dist/web/version.json
grep -rqF "$API" dist/web/_expo || { echo "The web build does not point at $API"; exit 1; }
grep -qF 'rel="manifest"' dist/web/index.html || { echo "The web build lost its install tags (apps/client/public/index.html)"; exit 1; }
# The landing page: Caddy serves it at /. Once it has loaded, it fetches the app's scripts in the
# background (not on Save-Data connections), so "Open Splitify" opens fast.
node -e '
  const fs = require("fs");
  const scripts = [...fs.readFileSync("dist/web/index.html", "utf8").matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  if (!scripts.length) throw new Error("No app scripts found in dist/web/index.html");
  const warm = `<script>addEventListener("load",()=>setTimeout(()=>{if(navigator.connection&&navigator.connection.saveData)return;${JSON.stringify(scripts)}.forEach(h=>{const l=document.createElement("link");l.rel="prefetch";l.as="script";l.href=h;document.head.appendChild(l)})},1500))</script>`;
  const page = fs.readFileSync("apps/landing/index.html", "utf8");
  if (!page.includes("</body>")) throw new Error("apps/landing/index.html has no </body>");
  fs.writeFileSync("dist/web/landing.html", page.replace("</body>", warm + "\n</body>"));
'
# The calculator and guides (served at /split-…), their stylesheet and sitemap.xml.
node apps/landing/build-pages.mjs dist/web >/dev/null
test -s dist/web/sitemap.xml || { echo "No sitemap.xml was built"; exit 1; }

echo "3/4 Copying to the server"
rsync -az --delete -e "ssh -i $KEY" dist/api/ "$TARGET:/srv/splitify/api/"
rsync -az --delete -e "ssh -i $KEY" dist/web/ "$TARGET:/srv/splitify/web/"
rsync -az -e "ssh -i $KEY" deploy/Caddyfile deploy/splitify-api.service "$TARGET:/tmp/"

echo "4/4 Restarting"
"${SSH[@]}" 'set -e
  sudo install -m 0644 /tmp/Caddyfile /etc/caddy/Caddyfile
  sudo install -m 0644 /tmp/splitify-api.service /etc/systemd/system/splitify-api.service
  sudo systemctl daemon-reload
  sudo systemctl enable --quiet splitify-api
  sudo systemctl restart splitify-api
  sudo systemctl reload caddy
  for i in $(seq 1 20); do curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS http://127.0.0.1:3001/health >/dev/null || { sudo journalctl -u splitify-api -n 30 --no-pager; exit 1; }'
echo "Done: https://${API#https://api.} (version $VERSION, build $BUILD) and $API"
