#!/usr/bin/env bash
# Uploads a store zip to the Chrome Web Store (API v2) and submits it for review.
# Usage: cws-publish.sh <app> <zip>. Needs CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID.
set -euo pipefail

app="$1"
zip="$2"

# Store item ids match the fixed extension ids, kept by key.pem on the first upload.
case "$app" in
  rekord) item=flkicdahoghegnlgpkmdcemlooblblcd ;;
  klipkord) item=iapgbifdchhmidblniddncnagghloepi ;;
  motikord) item=pppjklpibpnndjfddhcedbdicfdalchl ;;
  *) echo "::error::No store item id for '$app'. Add it to .github/scripts/cws-publish.sh."; exit 1 ;;
esac

for name in CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN CWS_PUBLISHER_ID; do
  if [ -z "${!name:-}" ]; then
    echo "::error::Secret $name is not set. See README, Releases."
    exit 1
  fi
done

# Prints one value from the JSON on stdin, or nothing when it is missing or not JSON.
field() { node -e "let v;try{const r=JSON.parse(require('fs').readFileSync(0,'utf8'));v=$1}catch{}process.stdout.write(v==null?'':String(v))"; }

token=$(curl -fsS https://oauth2.googleapis.com/token \
  -d client_id="$CWS_CLIENT_ID" -d client_secret="$CWS_CLIENT_SECRET" \
  -d refresh_token="$CWS_REFRESH_TOKEN" -d grant_type=refresh_token | field r.access_token)
if [ -z "$token" ]; then
  echo "::error::Google gave no access token. Make a new CWS_REFRESH_TOKEN."
  exit 1
fi
echo "::add-mask::$token"

base="https://chromewebstore.googleapis.com"
name="publishers/$CWS_PUBLISHER_ID/items/$item"
auth=(-H "Authorization: Bearer $token")

# Calls the API; on an HTTP error prints Google's message (it never holds the token) and stops.
api() {
  local out code
  out=$(curl -sS -w '\n%{http_code}' "${auth[@]}" "$@")
  code="${out##*$'\n'}"
  out="${out%$'\n'*}"
  if [ "$code" -ge 400 ]; then
    echo "::error::Chrome Web Store answered $code: $(printf '%s' "$out" | field 'r.error&&r.error.message')" >&2
    exit 1
  fi
  printf '%s' "$out"
}

res=$(api -X POST -H "Content-Type: application/zip" --data-binary @"$zip" "$base/upload/v2/$name:upload")
state=$(printf '%s' "$res" | field r.uploadState)
for _ in $(seq 1 30); do
  [ "$state" = "IN_PROGRESS" ] || break
  sleep 10
  res=$(api "$base/v2/$name:fetchStatus")
  state=$(printf '%s' "$res" | field r.lastAsyncUploadState)
done
echo "Upload state: $state"
if [ "$state" != "SUCCEEDED" ]; then
  echo "::error::Upload of $app did not succeed ($state). An item still in review cannot take a new package."
  exit 1
fi

result=$(api -X POST -H "Content-Type: application/json" -d '{"publishType":"DEFAULT_PUBLISH"}' "$base/v2/$name:publish")
echo "Submitted $app for review. Item state: $(printf '%s' "$result" | field r.state)"
printf '%s' "$result" | field "(r.warningInfo&&r.warningInfo.warnings||[]).map(w=>'Warning: '+w.reason+' '+w.description).join('\n')"
echo
