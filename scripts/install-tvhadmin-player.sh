#!/bin/sh
# Install the one-window TVHadmin Player (menus + built-in VLC) on a Raspberry Pi.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/tvhadmin_player.py"
DESKTOP_DST="$HOME/.local/share/applications/tvhadmin-player.desktop"
AUTOSTART="$HOME/.config/autostart/tvhadmin-player.desktop"

echo "Installing packages (needs sudo)…"
sudo apt-get install -y \
  python3-gi python3-gi-cairo gir1.2-gtk-3.0 \
  python3-vlc vlc vlc-plugin-visualization python3-evdev python3-tk \
  wmctrl xdotool x11-utils || true

if apt-cache show gir1.2-webkit2-4.1 >/dev/null 2>&1; then
  sudo apt-get install -y gir1.2-webkit2-4.1 || true
else
  sudo apt-get install -y gir1.2-webkit2-4.0 || true
fi

chmod +x "$APP" "$DIR/start-vlc-helper.sh" "$DIR/tvhadmin_vlc_app.py" 2>/dev/null || true
mkdir -p "$HOME/.local/share/applications" "$HOME/.config/autostart"

{
  echo "[Desktop Entry]"
  echo "Type=Application"
  echo "Name=TVHadmin"
  echo "Comment=Watch TV — menus and VLC in one app"
  echo "Exec=python3 $APP"
  echo "Path=$DIR"
  echo "Icon=applications-multimedia"
  echo "Terminal=false"
  echo "Categories=AudioVideo;Player;"
  echo "StartupNotify=true"
} > "$DESKTOP_DST"

if [ "$1" = "--autostart" ]; then
  cp "$DESKTOP_DST" "$AUTOSTART"
  echo "Will start at login: $AUTOSTART"
fi

echo ""
echo "Menu entry: TVHadmin"
echo "Start now:  python3 $APP"
echo "  or:       sh $DIR/start-vlc-helper.sh --player"
echo ""
echo "Uses TVHeadend at http://127.0.0.1:9981/static/TVHadmin-JS/"
echo "Override with:  export TVHADMIN_URL=http://127.0.0.1:9981/static/TVHadmin-JS/now.html"
echo "X11 works best: sudo raspi-config → Advanced Options → Wayland → X11, then reboot"
echo "Backspace: add your user to group input, then reboot:"
echo "  sudo usermod -aG input \$USER"
