#!/bin/sh
# Start TVHadmin VLC (desktop app by default, or console helper with --console).
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8765
RESTART=0
CONSOLE=0

for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=1 ;;
    --console) CONSOLE=1 ;;
    [0-9]*) PORT="$arg" ;;
  esac
done

BASE="http://127.0.0.1:$PORT"

if [ "$RESTART" = 1 ]; then
  pkill -f tvhadmin_vlc_app.py 2>/dev/null || true
  pkill -f tvhadmin_vlc_helper.py 2>/dev/null || true
  sleep 0.6
fi

if command -v curl >/dev/null 2>&1; then
  if curl -sf "$BASE/health" >/dev/null 2>&1; then
    echo "TVHadmin VLC already running at $BASE (use --restart after updates)"
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
  echo "TVHadmin VLC already running at $BASE (use --restart after updates)"
  exit 0
fi

if [ "$CONSOLE" = 1 ]; then
  export TVHADMIN_LOG_STDERR=1
  exec python3 "$DIR/tvhadmin_vlc_helper.py" "$PORT"
fi

if python3 -c "import tkinter" 2>/dev/null; then
  exec python3 "$DIR/tvhadmin_vlc_app.py" "$PORT"
fi

echo "GUI unavailable (install python3-tk). Running console helper instead."
export TVHADMIN_LOG_STDERR=1
exec python3 "$DIR/tvhadmin_vlc_helper.py" "$PORT"
