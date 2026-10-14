#!/bin/sh
# Install TVHadmin VLC desktop app + optional login autostart (Raspberry Pi).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/tvhadmin_vlc_app.py"
DESKTOP_SRC="$DIR/tvhadmin-vlc-app.desktop"
DESKTOP_DST="$HOME/.local/share/applications/tvhadmin-vlc-app.desktop"
AUTOSTART="$HOME/.config/autostart/tvhadmin-vlc-app.desktop"

if ! python3 -c "import tkinter" 2>/dev/null; then
  echo "Install the GUI toolkit first: sudo apt install python3-tk"
  exit 1
fi

chmod +x "$APP" "$DIR/start-vlc-helper.sh" 2>/dev/null || true
mkdir -p "$HOME/.local/share/applications" "$HOME/.config/autostart"

# Desktop entry with correct paths for this machine
{
  echo "[Desktop Entry]"
  echo "Type=Application"
  echo "Name=TVHadmin VLC"
  echo "Comment=Launch VLC from TVHadmin; Backspace returns to menu"
  echo "Exec=python3 $APP"
  echo "Path=$DIR"
  echo "Icon=applications-multimedia"
  echo "Terminal=false"
  echo "Categories=AudioVideo;Player;"
  echo "StartupNotify=true"
} > "$DESKTOP_DST"

cp "$DESKTOP_DST" "$AUTOSTART"
echo "Installed menu entry: TVHadmin VLC"
echo "Autostart on login: $AUTOSTART"
echo ""
echo "Optional packages:"
echo "  sudo apt install python3-evdev python3-tk wmctrl xdotool x11-utils"
echo "  sudo usermod -aG input \$USER   # then log out and back in"
echo ""
echo "Start now: sh $DIR/start-vlc-helper.sh"
