#!/bin/sh
# Optional: make vlc:// links from TVHadmin start VLC in fullscreen (Raspberry Pi / Linux).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP="$DIR/vlc-fullscreen-handler.desktop"
TARGET="$HOME/.local/share/applications/tvhadmin-vlc-fullscreen.desktop"
mkdir -p "$HOME/.local/share/applications"
cp "$DESKTOP" "$TARGET"
chmod +x "$TARGET"
xdg-mime default tvhadmin-vlc-fullscreen.desktop x-scheme-handler/vlc 2>/dev/null || true
echo "Installed. Play in TVHadmin should open VLC fullscreen when the browser allows vlc:// links."
echo "If Pale Moon blocks the protocol, use the terminal command shown in the yellow hint bar."
