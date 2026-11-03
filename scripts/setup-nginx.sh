#!/usr/bin/env bash
# Serves the app at /meany/ on mudberry like /chatty/ (cross-origin isolation headers on every
# response, no-cache pages, immutable assets), and sends the old /chatty-voice/ paths there.
# Backs up the config, tests it, and reloads only if the test passes; run again and it does nothing.
set -euo pipefail
DEPLOY_HOST="${DEPLOY_HOST:-mudberry}"
ssh "$DEPLOY_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
F=/etc/nginx/sites-available/mudberry.conf
if grep -q "location ^~ /meany/" "$F"; then echo "nginx already serves /meany/"; exit 0; fi
BACKUP=~/mudberry.conf.backup-$(date +%Y%m%d%H%M%S)
cp "$F" "$BACKUP"
python3 - "$F" <<'EOF'
import re, sys
p = sys.argv[1]; s = open(p).read()
marker = "    # Include static file handling"
assert s.count(marker) == 1, "marker not found once"
# The old /chatty-voice/ block (added by the first version of this script) goes
s = re.sub(r"    # Chatty Voice \(client-side app\).*?\n    location ~?\^?~? ?/chatty-voice/ \{.*?\n    \}\n\n", "", s, flags=re.S)
s = re.sub(r"    location = /chatty-voice \{\n        return 301 /chatty-voice/;\n    \}\n", "", s)
block = """    # Meany (Chatty Voice, a client-side app), served like Chatty: cross-origin isolation on every response
    location = /meany {
        return 301 /meany/;
    }
    location ^~ /meany/ {
        include snippets/chatty-isolation.conf;
        add_header Cache-Control "no-cache" always;
        try_files $uri $uri/ /meany/index.html;

        # Hashed build output: cache forever
        location ^~ /meany/assets/ {
            include snippets/chatty-isolation.conf;
            add_header Cache-Control "public, max-age=31536000, immutable" always;
            try_files $uri =404;
        }
    }
    # Its old address
    location ^~ /chatty-voice {
        return 301 /meany/;
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
sleep 1
curl -s -o /dev/null -D - https://www.mudberry.com/meany/ | grep -i -E '^HTTP|cross-origin' | tr -d '\r'
curl -s -o /dev/null -w "old address: %{http_code} -> %{redirect_url}\n" https://www.mudberry.com/chatty-voice/
