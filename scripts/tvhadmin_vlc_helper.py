#!/usr/bin/env python3
"""
TVHadmin local helper — launches VLC when the browser cannot (Pi / Pale Moon).

Listen on 127.0.0.1 only. TVHadmin calls:
  GET http://127.0.0.1:8765/play?url=<encoded-stream-url>

Usage:
  python3 tvhadmin_vlc_helper.py [port]

Requires: vlc in PATH

Backspace toggle (needs python3-evdev, wmctrl, xdotool, x11-utils; user in group input):
  watching VLC  -> press F in VLC (leave fullscreen), raise Pale Moon, focus TVHadmin menu
  on the menu   -> bring VLC back and press F (fullscreen again)
"""
from __future__ import print_function

try:
    import grp
except ImportError:
    grp = None
import json
import os
import re
import select
import shutil
import subprocess
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, unquote, urlparse

DEFAULT_PORT = 8765
BIND = "127.0.0.1"
APP_WM_CLASS = "tvhremote"

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


# ---------------------------------------------------------------- logging

_ui_log = None


def set_ui_log(callback):
    """Register a thread-safe callback(line) for the desktop app log window."""
    global _ui_log
    _ui_log = callback


def _safe_stderr_write(text):
    stream = getattr(sys, "__stderr__", None) or sys.stderr
    if stream is None:
        return
    try:
        stream.write(text)
        stream.flush()
    except Exception:
        pass


def log_event(message):
    line = "[%s] %s" % (time.strftime("%H:%M:%S"), message)
    if _ui_log:
        try:
            _ui_log(line)
        except Exception as exc:
            _safe_stderr_write("UI log failed: %s\n" % exc)
    if _ui_log is None or os.environ.get("TVHADMIN_LOG_STDERR") == "1":
        _safe_stderr_write(line + "\n")


# ---------------------------------------------------------------- commands

def have(tool):
    return shutil.which(tool) is not None


def _run(cmd, timeout=2):
    try:
        return subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def _ok(cmd, timeout=2):
    r = _run(cmd, timeout)
    return r is not None and r.returncode == 0


def _out(cmd, timeout=2):
    r = _run(cmd, timeout)
    if r is None or r.returncode != 0:
        return ""
    return r.stdout.decode("utf-8", errors="ignore")


def is_wayland():
    return (
        os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland"
        or bool(os.environ.get("WAYLAND_DISPLAY"))
    )


# ---------------------------------------------------------------- windows

def list_windows():
    """[(id_hex, wm_class_lower, full_line_lower)] from wmctrl -lx."""
    wins = []
    for line in _out(["wmctrl", "-lx"]).splitlines():
        parts = line.split(None, 3)
        if len(parts) < 3:
            continue
        wins.append((parts[0], parts[2].lower(), line.lower()))
    return wins


def _is_vlc_class(cls):
    return cls == "vlc.vlc" or cls.startswith("vlc.") or cls.endswith(".vlc")


def vlc_window_ids():
    return [wid for wid, cls, line in list_windows() if _is_vlc_class(cls)]


def vlc_window_exists():
    if vlc_window_ids():
        return True
    return _ok(["pgrep", "-x", "vlc"])


def find_browser_window():
    extra = os.environ.get("TVHADMIN_WM_TITLE", "").strip().lower()
    wins = [w for w in list_windows() if APP_WM_CLASS not in w[2] and not _is_vlc_class(w[1])]
    checks = []
    if extra:
        checks.append(lambda l: extra in l)
    checks += [
        lambda l: ("pale moon" in l or "palemoon" in l) and "tvhadmin" in l,
        lambda l: "pale moon" in l or "palemoon" in l,
        lambda l: "tvhadmin" in l,
        lambda l: "firefox" in l or "chromium" in l,
    ]
    for check in checks:
        for wid, cls, line in wins:
            if check(line):
                return wid
    return None


def active_window_id():
    out = _out(["xdotool", "getactivewindow"]).strip()
    if not out:
        return None
    try:
        return "0x%08x" % int(out)
    except ValueError:
        return None


def _same_window(a, b):
    try:
        return int(a, 16) == int(b, 16)
    except (TypeError, ValueError):
        return False


def window_is_fullscreen(wid):
    out = _out(["xprop", "-id", wid, "_NET_WM_STATE"])
    if not out:
        return None
    return "_NET_WM_STATE_FULLSCREEN" in out


def activate_window(wid):
    if _ok(["wmctrl", "-ia", wid]):
        return True
    try:
        return _ok(["xdotool", "windowactivate", "--sync", str(int(wid, 16))], timeout=3)
    except ValueError:
        return False


def pick_vlc_window():
    """Prefer the VLC window that is focused, then a fullscreen one, then the newest."""
    ids = vlc_window_ids()
    if not ids:
        return None
    active = active_window_id()
    for wid in ids:
        if active and _same_window(wid, active):
            return wid
    for wid in ids:
        if window_is_fullscreen(wid):
            return wid
    return ids[-1]


def any_vlc_fullscreen():
    states = [window_is_fullscreen(w) for w in vlc_window_ids()]
    known = [s for s in states if s is not None]
    if not known:
        return None
    return any(known)


def press_key_in_focused_window(key):
    if have("xdotool") and not is_wayland():
        return _ok(["xdotool", "key", "--clearmodifiers", key])
    if have("wtype"):
        return _ok(["wtype", key])
    if have("xdotool"):
        return _ok(["xdotool", "key", "--clearmodifiers", key])
    return False


def _wlr_focus(*matches):
    if not have("wlrctl"):
        return False
    for m in matches:
        if _ok(["wlrctl", "toplevel", "focus", m]):
            return True
    return False


_vlc_fullscreen = True


def vlc_press_f():
    """Focus VLC and press F (VLC's fullscreen toggle)."""
    global _vlc_fullscreen
    wid = pick_vlc_window()
    if wid:
        activate_window(wid)
    elif not _wlr_focus("app_id:vlc"):
        return False
    time.sleep(0.25)
    ok = press_key_in_focused_window("f")
    if ok:
        _vlc_fullscreen = not _vlc_fullscreen
    return ok


def raise_browser_window():
    wid = find_browser_window()
    if wid and activate_window(wid):
        return True
    return _wlr_focus("app_id:palemoon", "app_id:Pale moon", "title:Pale Moon")


def hide_vlc():
    ok = False
    for wid in vlc_window_ids():
        if _ok(["wmctrl", "-ir", wid, "-b", "add,hidden"]):
            ok = True
        try:
            if _ok(["xdotool", "windowminimize", str(int(wid, 16))]):
                ok = True
        except ValueError:
            pass
    return ok


def unhide_vlc():
    for wid in vlc_window_ids():
        _ok(["wmctrl", "-ir", wid, "-b", "remove,hidden"])
        try:
            _ok(["xdotool", "windowmap", str(int(wid, 16))])
        except ValueError:
            pass


def leave_vlc_for_menu():
    """Press F in VLC so it leaves fullscreen, then bring Pale Moon to the front."""
    fs = any_vlc_fullscreen()
    if fs is None:
        fs = _vlc_fullscreen
    pressed_f = False
    if fs:
        pressed_f = vlc_press_f()
        time.sleep(0.4)
    if fs and not pressed_f:
        hide_vlc()
    raised = raise_browser_window()
    if not raised:
        hide_vlc()
        raised = raise_browser_window()
    return pressed_f, raised


def restore_vlc_video():
    """Bring VLC back in front and press F so it is fullscreen again."""
    unhide_vlc()
    fs = any_vlc_fullscreen()
    if fs is None:
        fs = _vlc_fullscreen
    if fs:
        wid = pick_vlc_window()
        return bool(wid and activate_window(wid)) or _wlr_focus("app_id:vlc")
    return vlc_press_f()


def _ensure_vlc_fullscreen_after_play(want_fullscreen):
    """With --one-instance, a running VLC keeps its old (windowed) state; fix it up."""
    global _vlc_fullscreen
    deadline = time.time() + 6
    while time.time() < deadline:
        if vlc_window_ids():
            break
        time.sleep(0.3)
    time.sleep(1.0)
    unhide_vlc()
    wid = pick_vlc_window()
    if wid:
        activate_window(wid)
    fs = any_vlc_fullscreen()
    if fs is None:
        _vlc_fullscreen = want_fullscreen
        return
    _vlc_fullscreen = fs
    if want_fullscreen and not fs:
        vlc_press_f()


# ---------------------------------------------------------------- VLC process

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
    threading.Thread(
        target=_ensure_vlc_fullscreen_after_play,
        args=(fullscreen,),
        daemon=True,
    ).start()


def stop_vlc():
    _ok(["pkill", "-TERM", "-x", "vlc"])


# ---------------------------------------------------------------- Backspace toggle

_state_lock = threading.Lock()
_hotkey_action = None
_tv_ui_mode = "video"
_busy = False
_last_press_ts = 0.0
HOTKEY_DEBOUNCE_SEC = 0.6
_hotkeys_enabled = False
_server = None


def set_hotkey_action(action):
    global _hotkey_action
    with _state_lock:
        _hotkey_action = action


def consume_hotkey_action():
    global _hotkey_action
    with _state_lock:
        action = _hotkey_action
        _hotkey_action = None
        return action


def set_tv_ui_mode(mode):
    global _tv_ui_mode
    if mode in ("video", "menu"):
        _tv_ui_mode = mode


def _do_toggle():
    global _tv_ui_mode, _busy
    try:
        if _tv_ui_mode == "menu" and vlc_window_exists():
            _tv_ui_mode = "video"
            ok = restore_vlc_video()
            set_hotkey_action("video")
            log_event("Backspace -> video (VLC in front=%s)" % ok)
            return
        _tv_ui_mode = "menu"
        if vlc_window_exists():
            pressed_f, raised = leave_vlc_for_menu()
            log_event(
                "Backspace -> menu (pressed F in VLC=%s, Pale Moon in front=%s)"
                % (pressed_f, raised)
            )
        else:
            raised = raise_browser_window()
            log_event("Backspace -> menu (no VLC running, Pale Moon in front=%s)" % raised)
        set_hotkey_action("menu")
        if not raised:
            log_event("Could not find the Pale Moon window — see the checks at the top of this log")
    except Exception as exc:
        log_event("Backspace error: %s" % exc)
    finally:
        _busy = False


def on_backspace(event_ts=None):
    global _busy, _last_press_ts
    ts = event_ts if event_ts else time.time()
    if ts - _last_press_ts < HOTKEY_DEBOUNCE_SEC:
        return
    _last_press_ts = ts
    if _busy:
        log_event("Backspace ignored (still switching)")
        return
    _busy = True
    log_event("Backspace pressed (currently on %s)" % _tv_ui_mode)
    threading.Thread(target=_do_toggle, daemon=True).start()


def _evdev_hotkey_loop():
    global _hotkeys_enabled
    try:
        import evdev
        from evdev import ecodes, list_devices
    except ImportError:
        log_event("Backspace hotkey OFF: python3-evdev not installed (sudo apt install python3-evdev)")
        return

    devices = []
    for path in list_devices():
        try:
            dev = evdev.InputDevice(path)
            keys = dev.capabilities().get(ecodes.EV_KEY, [])
            if ecodes.KEY_BACKSPACE in keys:
                devices.append(dev)
        except OSError:
            continue

    if not devices:
        log_event(
            "Backspace hotkey OFF: no keyboard readable. Run: sudo usermod -aG input $USER  then reboot"
        )
        return

    _hotkeys_enabled = True
    log_event("Backspace hotkey ON (%s)" % ", ".join(d.name for d in devices))
    while True:
        try:
            ready, _, _ = select.select(devices, [], [], 1.0)
        except (OSError, ValueError):
            time.sleep(1.0)
            continue
        for dev in ready:
            try:
                for event in dev.read():
                    if (
                        event.type == ecodes.EV_KEY
                        and event.value == 1
                        and event.code == ecodes.KEY_BACKSPACE
                    ):
                        on_backspace(event.timestamp())
            except (OSError, BlockingIOError):
                continue


def start_global_hotkey_listener():
    if os.environ.get("TVHADMIN_HOTKEYS", "1") in ("0", "false", "no"):
        log_event("Backspace hotkey disabled (TVHADMIN_HOTKEYS=0)")
        return
    threading.Thread(target=_evdev_hotkey_loop, name="tvhadmin-hotkeys", daemon=True).start()


def environment_report():
    """Log what the Backspace toggle needs, so problems are visible in the app."""
    if is_wayland():
        log_event(
            "WARNING: Wayland desktop detected. Window switching works best on X11: "
            "sudo raspi-config -> Advanced Options -> Wayland -> X11, then reboot"
        )
        if not (have("wlrctl") and have("wtype")):
            log_event("  (on Wayland also install: sudo apt install wlrctl wtype)")
    if not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
        log_event("WARNING: no desktop display — start this from the Pi desktop, not over SSH")
    missing = [t for t in ("vlc", "wmctrl", "xdotool", "xprop") if not have(t)]
    if missing:
        pkgs = {"xprop": "x11-utils"}
        log_event(
            "MISSING: %s  ->  sudo apt install %s"
            % (", ".join(missing), " ".join(pkgs.get(t, t) for t in missing))
        )
    try:
        input_gid = grp.getgrnam("input").gr_gid if grp else None
        if input_gid is not None and input_gid not in os.getgroups():
            log_event("WARNING: user not in group 'input' -> sudo usermod -aG input $USER, then reboot")
    except KeyError:
        pass
    if have("wmctrl") and not is_wayland():
        if find_browser_window():
            log_event("Found Pale Moon window: OK")
        else:
            log_event("Pale Moon window not found yet (open TVHadmin in Pale Moon)")


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        else:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _play(self, url, title=None, fullscreen=True):
        url = (url or "").strip()
        if not url:
            self._json(400, {"ok": False, "error": "missing url"})
            return
        if not url_is_allowed(url):
            self._json(403, {"ok": False, "error": "url not allowed"})
            return
        try:
            launch_vlc(url, title=title, fullscreen=fullscreen)
        except FileNotFoundError:
            self._json(500, {"ok": False, "error": "vlc not found in PATH"})
            return
        except Exception as exc:
            self._json(500, {"ok": False, "error": str(exc)})
            return
        set_tv_ui_mode("video")
        log_event("Playing in VLC: %s" % (title or url[:80]))
        self._json(200, {"ok": True})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        if path == "/play":
            url = unquote(qs["url"][0]) if qs.get("url") else ""
            title = unquote(qs["title"][0]) if qs.get("title") else None
            fullscreen = qs.get("fullscreen", ["1"])[0] not in ("0", "false", "no")
            self._play(url, title=title, fullscreen=fullscreen)
            return
        if path == "/stop":
            stop_vlc()
            self._json(200, {"ok": True})
            return
        if path == "/raise":
            self._json(200, {"ok": raise_browser_window()})
            return
        if path == "/hotkey-pending":
            self._json(200, {"ok": True, "action": consume_hotkey_action()})
            return
        if path == "/health":
            self._json(
                200,
                {
                    "ok": True,
                    "service": "tvhadmin-vlc-helper",
                    "hotkeys": _hotkeys_enabled,
                    "mode": _tv_ui_mode,
                },
            )
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path == "/play":
            url, title = "", None
            length = int(self.headers.get("Content-Length") or 0)
            if 0 < length < 8192:
                try:
                    body = json.loads(self.rfile.read(length).decode("utf-8"))
                    url = body.get("url") or ""
                    title = body.get("title")
                except Exception:
                    pass
            self._play(url, title=title)
            return
        self._json(404, {"ok": False, "error": "not found"})


class ReuseHTTPServer(HTTPServer):
    allow_reuse_address = True


def port_in_use_error(err):
    return getattr(err, "errno", None) in (98, 48) or getattr(err, "winerror", None) == 10048


def run_helper(port=DEFAULT_PORT):
    global _server
    try:
        server = ReuseHTTPServer((BIND, port), Handler)
    except OSError as exc:
        if port_in_use_error(exc):
            log_event("Port %s already in use — the helper is probably already running" % port)
            raise SystemExit(1)
        raise
    _server = server
    environment_report()
    start_global_hotkey_listener()
    log_event("Listening on http://%s:%s" % (BIND, port))
    server.serve_forever()


def stop_helper():
    if _server:
        threading.Thread(target=_server.shutdown, daemon=True).start()


def hotkeys_enabled():
    return _hotkeys_enabled


def main():
    port = DEFAULT_PORT
    args = [a for a in sys.argv[1:] if a.isdigit()]
    if args:
        port = int(args[0])
    os.environ.setdefault("TVHADMIN_LOG_STDERR", "1")
    try:
        run_helper(port)
    except KeyboardInterrupt:
        log_event("Stopped")


if __name__ == "__main__":
    main()
