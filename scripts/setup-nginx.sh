#!/usr/bin/env bash
# One-time: serves /chatty-voice/ on mudberry like /chatty/ (cross-origin isolation headers on every
# response, no-cache pages, immutable assets). Backs up the config, tests it, and reloads only if
# the test passes; run again and it does nothing.
set -euo pipefail
DEPLOY_HOST="${DEPLOY_HOST:-mudberry}"
ssh "$DEPLOY_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
F=/etc/nginx/sites-available/mudberry.conf
if grep -q "location ^~ /chatty-voice/" "$F"; then echo "nginx already serves /chatty-voice/"; exit 0; fi
BACKUP=~/mudberry.conf.backup-$(date +%Y%m%d%H%M%S)
cp "$F" "$BACKUP"
python3 - "$F" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
marker = "    # Include static file handling"
assert s.count(marker) == 1, "marker not found once"
block = """    # Chatty Voice (client-side app), served like Chatty: cross-origin isolation on every response
    location = /chatty-voice {
        return 301 /chatty-voice/;
    }
    location ^~ /chatty-voice/ {
        include snippets/chatty-isolation.conf;
        add_header Cache-Control "no-cache" always;
        try_files $uri $uri/ /chatty-voice/index.html;

        # Hashed build output: cache forever
        location ^~ /chatty-voice/assets/ {
            include snippets/chatty-isolation.conf;
            add_header Cache-Control "public, max-age=31536000, immutable" always;
            try_files $uri =404;
        }
    }

"""
open(p, "w").write(s.replace(marker, block + marker))
EOF
if sudo nginx -t; then
  sudo systemctl reload nginx && echo "reloaded (backup: $BACKUP)"
else
  cp "$BACKUP" "$F"; echo "nginx -t failed: config restored from $BACKUP" >&2; exit 1
fi
REMOTE
curl -s -o /dev/null -D - https://www.mudberry.com/chatty-voice/ | grep -i -E '^HTTP|cross-origin' | tr -d '\r'
