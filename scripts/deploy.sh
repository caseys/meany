#!/usr/bin/env bash
# Build, back up the deployed copy, rsync dist/ to the server, and verify the live bundle.
# Nginx must serve /meany/ with the cross-origin isolation headers (as it does /chatty/).
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_HOST="${DEPLOY_HOST:-mudberry}"
SITE_DIR="${SITE_DIR:-www/www.mudberry.com}"
DEPLOY_URL="${DEPLOY_URL:-https://www.mudberry.com/meany/}"

echo "==> Typecheck and build"
npm run build

echo "==> Back up the deployed copy (if any)"
ssh "$DEPLOY_HOST" "cd ~/$SITE_DIR && if [ -d meany ]; then tar czf ~/meany-deployed-backup-\$(date +%Y%m%d%H%M%S).tgz meany; fi"

echo "==> Upload"
rsync -az --delete --exclude .DS_Store dist/ "$DEPLOY_HOST:$SITE_DIR/meany/"

echo "==> Verify"
local_bundle=$(grep -o '/meany/assets/index-[^"]*\.js' dist/index.html | head -1 || true)
live_bundle=$(curl -s "$DEPLOY_URL" | grep -o '/meany/assets/index-[^"]*\.js' | head -1 || true)
isolation=$(curl -s -o /dev/null -D - "$DEPLOY_URL" | grep -i -c 'cross-origin-embedder-policy' || true)
if [ -z "$local_bundle" ] || [ "$local_bundle" != "$live_bundle" ]; then
  echo "DEPLOY VERIFY FAILED: dist has '${local_bundle:-none}', live site serves '${live_bundle:-none}'" >&2
  exit 1
fi
[ "$isolation" -gt 0 ] || echo "WARNING: no Cross-Origin-Embedder-Policy header on $DEPLOY_URL (add the nginx block)" >&2
echo "Deployed: $live_bundle"
