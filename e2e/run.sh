#!/bin/sh
# End-to-end check: feeds a cat photo to the real app in headless Chrome and
# prints the result line (OK species=cat ... / FAIL ...). Needs network for the models.
set -e
cd "$(dirname "$0")/.."
[ -f e2e/cat.jpg ] || curl -sfL -A "Mozilla/5.0 (pet-catcher e2e)" -o e2e/cat.jpg \
  "https://upload.wikimedia.org/wikipedia/commons/3/3a/Cat03.jpg"
file e2e/cat.jpg | grep -q JPEG || { echo "FAIL e2e/cat.jpg is not a JPEG"; rm -f e2e/cat.jpg; exit 1; }

PORT=8765
TMP=$(mktemp -d)
python3 -m http.server $PORT > "$TMP/server.log" 2>&1 & SERVER=$!
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --user-data-dir="$TMP/profile" "http://localhost:$PORT/e2e/harness.html" > /dev/null 2>&1 & CHROME=$!
trap 'kill $SERVER $CHROME 2>/dev/null; wait 2>/dev/null; rm -rf "$TMP"' EXIT

for _ in $(seq 1 90); do
  LINE=$(grep -o 'GET /result?[^ ]*' "$TMP/server.log" || true)
  [ -n "$LINE" ] && break
  sleep 2
done
RESULT=$(python3 -c "import sys,urllib.parse;print(urllib.parse.unquote(sys.argv[1][len('GET /result?'):]))" "${LINE:-GET /result?FAIL no result after 180 s}")
echo "$RESULT"
case "$RESULT" in OK*) exit 0 ;; *) exit 1 ;; esac
