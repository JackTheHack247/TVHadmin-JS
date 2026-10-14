#!/usr/bin/env python3
"""
TVHadmin local helper — launches VLC when the browser cannot (Pi / Pale Moon).

Listen on 127.0.0.1 only. TVHadmin calls:
  GET http://127.0.0.1:8765/play?url=<encoded-stream-url>

Usage:
  python3 tvhadmin_vlc_helper.py [port]
  ./tvhadmin_vlc_helper.py

Requires: vlc in PATH

Optional (Pi menu hotkeys): python3-evdev, wmctrl, xdotool
  Backspace while VLC is focused → minimize VLC, raise Pale Moon, TVHadmin opens menu.
  Every Backspace is logged on the helper console for debugging.
"""
from __future__ import print_function

import json
import os
import re
import select
import subprocess
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, unquote, urlparse

DEFAULT_PORT = 8765
BIND = "127.0.0.1"

STREAM_PATH = re.compile(
    r"^/(?:play/ticket/(?:stream/|dvrfile/)|stream/(?:channel|file|channelid|channelnumber|channelname)/)",
    re.I,
)


def allowed_host(hostname):
    if not hostname:
        return False
    h = hostname.lower()
    if h in ("localhost", "127.0.0.1", "::1"):
        return True
    if re.match(r"^192\.168\.\d{1,3}\.\d{1,3}$", h):
        return True
    if re.match(r"^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$", h):
        return True
    if re.match(r"^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$", h):
        return True
    return False


def url_is_allowed(url):
    try:
        u = urlparse(url)
    except Exception:
        return False
    if u.scheme not in ("http", "https"):
        return False
    if not allowed_host(u.hostname):
        return False
    path = u.path or ""
    return bool(STREAM_PATH.match(path))


def launch_vlc(url, title=None, fullscreen=True):
    cmd = [
        "vlc",
        "--one-instance",
        "--one-instance-when-started",
        "--no-playlist-enqueue",
    ]
    if fullscreen:
        cmd.append("--fullscreen")
    if title:
        safe = re.sub(r"[\r\n\x00]", " ", title).strip()[:200]
        if safe:
            cmd.append("--meta-title=" + safe)
    cmd.append(url)
    subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def stop_vlc():
    """Quit VLC (optional — TVHadmin keeps VLC running when opening the menu)."""
    try:
        subprocess.call(
            ["pkill", "-TERM", "vlc"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def raise_browser_window():
    """Bring the TVHadmin browser window to the front (VLC fullscreen hides it otherwise)."""
    titles = [
        "TVHadmin",
        "Pale Moon",
        "pale moon",
        "Firefox",
        "Chromium",
        "TVHeadend",
    ]
    extra = os.environ.get("TVHADMIN_WM_TITLE", "").strip()
    if extra:
        titles.insert(0, extra)
    for title in titles:
        try:
            if (
                subprocess.call(
                    ["wmctrl", "-a", title],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                == 0
            ):
                return True
        except FileNotFoundError:
            break
        except Exception:
            pass
    try:
        if (
            subprocess.call(
                [
                    "xdotool",
                    "search",
                    "--name",
                    "TVHadmin",
                    "windowactivate",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            == 0
        ):
            return True
    except FileNotFoundError:
        pass
    except Exception:
        pass
    return False


_hotkey_lock = threading.Lock()
_hotkey_menu_pending = False
_last_hotkey_at = 0.0
HOTKEY_DEBOUNCE_SEC = 0.5
_hotkeys_enabled = False


def set_hotkey_menu_pending():
    global _hotkey_menu_pending
    with _hotkey_lock:
        _hotkey_menu_pending = True


def consume_hotkey_menu_pending():
    global _hotkey_menu_pending
    with _hotkey_lock:
        pending = _hotkey_menu_pending
        _hotkey_menu_pending = False
        return pending


def active_window_is_vlc():
    try:
        wid = subprocess.check_output(
            ["xdotool", "getactivewindow"],
            stderr=subprocess.DEVNULL,
            timeout=1,
        ).decode("utf-8", errors="ignore").strip()
        if not wid or wid == "0":
            return False
        cls = subprocess.check_output(
            ["xprop", "-id", wid, "WM_CLASS"],
            stderr=subprocess.DEVNULL,
            timeout=1,
        ).decode("utf-8", errors="ignore").lower()
        return "vlc" in cls
    except Exception:
        pass
    try:
        name = subprocess.check_output(
            ["xdotool", "getactivewindow", "getwindowname"],
            stderr=subprocess.DEVNULL,
            timeout=1,
        ).decode("utf-8", errors="ignore").lower()
        if "vlc" in name:
            return True
        cls = subprocess.check_output(
            ["xdotool", "getactivewindow", "getwindowclassname"],
            stderr=subprocess.DEVNULL,
            timeout=1,
        ).decode("utf-8", errors="ignore").lower()
        return "vlc" in cls
    except Exception:
        pass
    return False


def vlc_window_exists():
    try:
        out = subprocess.check_output(
            ["wmctrl", "-lx"],
            stderr=subprocess.DEVNULL,
            timeout=1,
        ).decode("utf-8", errors="ignore").lower()
        return "vlc.bin" in out or ".vlc" in out or " vlc" in out
    except Exception:
        pass
    try:
        out = subprocess.check_output(
            ["xdotool", "search", "--class", "vlc"],
            stderr=subprocess.DEVNULL,
            timeout=1,
        ).decode("utf-8", errors="ignore").strip()
        return bool(out)
    except Exception:
        return False


def should_handle_menu_hotkey():
    if active_window_is_vlc():
        return True
    if os.environ.get("TVHADMIN_HOTKEY_WHEN_VLC_RUNNING") == "1" and vlc_window_exists():
        return True
    return False


def minimize_vlc():
    commands = [
        ["wmctrl", "-x", "-r", "vlc.bin", "-b", "add,hidden"],
        ["wmctrl", "-x", "-r", "vlc", "-b", "add,hidden"],
        ["wmctrl", "-r", "VLC media player", "-b", "iconic,hidden"],
    ]
    for cmd in commands:
        try:
            if (
                subprocess.call(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                == 0
            ):
                return True
        except FileNotFoundError:
            break
        except Exception:
            pass
    try:
        wids = subprocess.check_output(
            ["xdotool", "search", "--class", "vlc"],
            stderr=subprocess.DEVNULL,
            timeout=1,
        ).decode("utf-8", errors="ignore").split()
        for wid in wids:
            subprocess.call(
                ["xdotool", "windowminimize", wid],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        if wids:
            return True
    except Exception:
        pass
    return False


def on_global_backspace_key():
    global _last_hotkey_at
    sys.stderr.write("[tvhadmin-vlc-helper] Backspace key detected\n", flush=True)
    now = time.time()
    if now - _last_hotkey_at < HOTKEY_DEBOUNCE_SEC:
        sys.stderr.write(
            "[tvhadmin-vlc-helper] Backspace ignored (debounce)\n",
            flush=True,
        )
        return
    _last_hotkey_at = now
    if not should_handle_menu_hotkey():
        vlc_focus = active_window_is_vlc()
        vlc_run = vlc_window_exists()
        sys.stderr.write(
            "[tvhadmin-vlc-helper] Backspace ignored (VLC focused=%s, VLC running=%s)\n"
            % (vlc_focus, vlc_run),
            flush=True,
        )
        return
    sys.stderr.write(
        "[tvhadmin-vlc-helper] Backspace — minimize VLC, raise Pale Moon, open menu\n",
        flush=True,
    )
    minimize_vlc()
    raise_browser_window()
    set_hotkey_menu_pending()


def _evdev_hotkey_loop():
    try:
        import evdev
        from evdev import ecodes, list_devices
    except ImportError:
        return False

    key_codes = {ecodes.KEY_BACKSPACE}
    devices = []
    for path in list_devices():
        try:
            dev = evdev.InputDevice(path)
            caps = dev.capabilities()
            if ecodes.EV_KEY not in caps:
                continue
            if key_codes.intersection(caps[ecodes.EV_KEY]):
                devices.append(dev)
        except (OSError, PermissionError):
            continue

    if not devices:
        sys.stderr.write(
            "[tvhadmin-vlc-helper] Global hotkeys: no keyboard device "
            "(sudo apt install python3-evdev; add user to group input, re-login)\n",
            flush=True,
        )
        return False

    for dev in devices:
        try:
            dev.set_nonblocking(True)
        except Exception:
            pass

    global _hotkeys_enabled
    _hotkeys_enabled = True
    sys.stderr.write(
        "[tvhadmin-vlc-helper] Global hotkeys active: Backspace (logged on each press)\n",
        flush=True,
    )
    while True:
        try:
            ready, _, _ = select.select(devices, [], [], 1.0)
        except Exception:
            time.sleep(1.0)
            continue
        for dev in ready:
            try:
                for event in dev.read():
                    if event.type != ecodes.EV_KEY or event.value != 1:
                        continue
                    if event.code in key_codes:
                        on_global_backspace_key()
            except (OSError, BlockingIOError):
                continue


def start_global_hotkey_listener():
    global _hotkeys_enabled
    if os.environ.get("TVHADMIN_HOTKEYS", "1") in ("0", "false", "no"):
        sys.stderr.write("[tvhadmin-vlc-helper] Global hotkeys disabled (TVHADMIN_HOTKEYS=0)\n")
        return

    def runner():
        _evdev_hotkey_loop()

    t = threading.Thread(target=runner, name="tvhadmin-hotkeys", daemon=True)
    t.start()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[tvhadmin-vlc-helper] %s\n" % (fmt % args))

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        else:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _read_url(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        if qs.get("url"):
            return unquote(qs["url"][0])
        length = int(self.headers.get("Content-Length") or 0)
        if length and length < 8192:
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                return body.get("url") or ""
            except Exception:
                pass
        return ""

    def _play(self, url, title=None, fullscreen=True):
        url = (url or "").strip()
        if not url:
            self.send_response(400)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":false,"error":"missing url"}')
            return
        if not url_is_allowed(url):
            self.send_response(403)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":false,"error":"url not allowed"}')
            return
        try:
            launch_vlc(url, title=title, fullscreen=fullscreen)
        except FileNotFoundError:
            self.send_response(500)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":false,"error":"vlc not found in PATH"}')
            return
        except Exception as exc:
            self.send_response(500)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            msg = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
            self.wfile.write(msg)
            return
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def _read_play_args(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        url = ""
        if qs.get("url"):
            url = unquote(qs["url"][0])
        title = unquote(qs["title"][0]) if qs.get("title") else None
        fs = qs.get("fullscreen", ["1"])[0]
        fullscreen = fs not in ("0", "false", "no")
        return url, title, fullscreen

    def do_GET(self):
        if self.path.startswith("/play"):
            url, title, fullscreen = self._read_play_args()
            if not url:
                url = self._read_url()
            self._play(url, title=title, fullscreen=fullscreen)
            return
        if self.path.startswith("/stop"):
            stop_vlc()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        if self.path.startswith("/raise"):
            ok = raise_browser_window()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            msg = json.dumps({"ok": ok}).encode("utf-8")
            self.wfile.write(msg)
            return
        if self.path.startswith("/hotkey-pending"):
            pending = consume_hotkey_menu_pending()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            msg = json.dumps({"ok": True, "openMenu": pending}).encode("utf-8")
            self.wfile.write(msg)
            return
        if self.path.startswith("/health"):
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            msg = json.dumps(
                {
                    "ok": True,
                    "service": "tvhadmin-vlc-helper",
                    "hotkeys": _hotkeys_enabled,
                }
            ).encode("utf-8")
            self.wfile.write(msg)
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path.startswith("/play"):
            url = ""
            title = None
            length = int(self.headers.get("Content-Length") or 0)
            if length and length < 8192:
                try:
                    body = json.loads(self.rfile.read(length).decode("utf-8"))
                    url = body.get("url") or ""
                    title = body.get("title")
                except Exception:
                    pass
            self._play(url, title=title)
            return
        self.send_response(404)
        self.end_headers()


class ReuseHTTPServer(HTTPServer):
    allow_reuse_address = True


def port_in_use_error(err):
    if getattr(err, "errno", None) in (98, 48):
        return True
    if getattr(err, "winerror", None) == 10048:
        return True
    return False


def main():
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    try:
        server = ReuseHTTPServer((BIND, port), Handler)
    except OSError as exc:
        if port_in_use_error(exc):
            sys.stderr.write(
                "[tvhadmin-vlc-helper] Port %s is already in use on %s.\n"
                % (port, BIND)
            )
            sys.stderr.write(
                "  If the helper is already running, you do not need to start it again.\n"
                "  Check: curl -s http://127.0.0.1:%s/health\n"
                % port
            )
            sys.stderr.write(
                "  To restart after an update: pkill -f tvhadmin_vlc_helper.py\n"
                "  then run start-vlc-helper.sh again, or: sh start-vlc-helper.sh --restart\n"
            )
            raise SystemExit(1)
        raise
    start_global_hotkey_listener()
    print("TVHadmin VLC helper on http://%s:%s (Ctrl+C to stop)" % (BIND, port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)


if __name__ == "__main__":
    main()
