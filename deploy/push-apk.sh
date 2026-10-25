#!/usr/bin/env bash
# Puts a new Android build on the website: https://splitify.iambuzzdev.in/download/
#   deploy/push-apk.sh <64-bit.apk> <32-bit.apk>
# Both come from EAS (eas.json profiles website-64bit and website-32bit). The version is read from
# apps/client/app.json, so bump it there before building. Phones running an older version are
# offered this one (src/ui/UpdateBanner.tsx reads latest.json).
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -eq 2 ] || { echo "Usage: deploy/push-apk.sh <64-bit.apk> <32-bit.apk>"; exit 1; }
APK64=$1 APK32=$2
TARGET=${SPLITIFY_SSH:-ubuntu@13.203.57.144}
KEY=${SPLITIFY_KEY:-$HOME/.ssh/splitify-key.pem}
SITE=${SPLITIFY_SITE:-https://splitify.iambuzzdev.in}
DIR=/srv/splitify/downloads
VERSION=$(node -p 'require("./apps/client/app.json").expo.version')
MIN_ANDROID=${MIN_ANDROID:-7}

# Each file must hold only its own kind of chip code, or the website would hand out the wrong one.
only_abi() {
  local abis
  abis=$(unzip -Z1 "$1" 'lib/*' 2>/dev/null | cut -d/ -f2 | sort -u | tr '\n' ' ')
  [ "$abis" = "$2 " ] || { echo "$1 should hold only $2 code, but has: ${abis:-none}"; exit 1; }
}
only_abi "$APK64" arm64-v8a
only_abi "$APK32" armeabi-v7a

F64="splitify-$VERSION-64bit.apk"
F32="splitify-$VERSION-32bit.apk"
mb() { node -e 'console.log(Math.round(require("fs").statSync(process.argv[1]).size / 1048576 * 10) / 10)' "$1"; }
LATEST=$(node -e 'console.log(JSON.stringify({ version: process.argv[1], minAndroid: process.argv[2], apk64: { file: process.argv[3], mb: +process.argv[4] }, apk32: { file: process.argv[5], mb: +process.argv[6] } }))' \
  "$VERSION" "$MIN_ANDROID" "$F64" "$(mb "$APK64")" "$F32" "$(mb "$APK32")")
echo "Uploading Splitify $VERSION: $LATEST"

ssh -i "$KEY" "$TARGET" "sudo install -d -m 0755 -o \$(id -un) $DIR"
scp -q -i "$KEY" "$APK64" "$TARGET:$DIR/$F64"
scp -q -i "$KEY" "$APK32" "$TARGET:$DIR/$F32"
# The stable names the landing page links to, then latest.json last, so nothing points at a half-copied file.
ssh -i "$KEY" "$TARGET" "set -e; cd $DIR
  chmod 644 $F64 $F32
  ln -sfn $F64 splitify-android.apk
  ln -sfn $F32 splitify-android-32bit.apk
  printf '%s\n' '$LATEST' > latest.json.tmp && chmod 644 latest.json.tmp && mv latest.json.tmp latest.json
  # Keep this version and the one before it.
  ls -1t splitify-*-64bit.apk | tail -n +3 | xargs -r rm --
  ls -1t splitify-*-32bit.apk | tail -n +3 | xargs -r rm --"

for f in splitify-android.apk splitify-android-32bit.apk latest.json; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/download/$f")
  [ "$code" = 200 ] || { echo "$SITE/download/$f answered $code"; exit 1; }
done
echo "Done: $SITE/download/latest.json"
