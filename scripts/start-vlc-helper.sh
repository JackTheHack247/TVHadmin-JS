#!/bin/sh
# Start the TVHadmin VLC helper (run on the Pi desktop, same machine as Pale Moon + VLC).
# Backspace (while VLC focused) → minimize VLC, raise Pale Moon, open TVHadmin menu (logged on console).
# Needs: python3-evdev wmctrl xdotool; user in group "input" for keyboard access.
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8765
RESTART=0

for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=1 ;;
    [0-9]*) PORT="$arg" ;;
  esac
done

BASE="http://127.0.0.1:$PORT"

if [ "$RESTART" = 1 ]; then
  pkill -f tvhadmin_vlc_helper.py 2>/dev/null || true
  sleep 0.6
fi

if command -v curl >/dev/null 2>&1; then
  if curl -sf "$BASE/health" >/dev/null 2>&1; then
    echo "TVHadmin VLC helper already running at $BASE (use --restart after updating the script)"
    exit 0
  fi
elif python3 -c "
import urllib.request, sys
try:
    urllib.request.urlopen('$BASE/health', timeout=2)
    sys.exit(0)
except Exception:
    sys.exit(1)
" 2>/dev/null; then
  echo "TVHadmin VLC helper already running at $BASE (use --restart after updating the script)"
  exit 0
fi

exec python3 "$DIR/tvhadmin_vlc_helper.py" "$PORT"
