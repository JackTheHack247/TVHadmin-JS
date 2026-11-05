#!/usr/bin/env python3
"""TVHadmin Player — one app: menus in a web view, VLC playback in the same window.

Run on the Pi desktop (no Pale Moon):
    python3 scripts/tvhadmin_player.py

Packages:
    sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 \\
        python3-vlc vlc vlc-plugin-visualization python3-evdev
    (on older Pi OS use gir1.2-webkit2-4.0)
"""
from __future__ import print_function

import os
import sys
import threading
import time

DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(DIR)
if DIR not in sys.path:
    sys.path.insert(0, DIR)

DEFAULT_TVH = os.environ.get("TVHADMIN_TVH", "http://127.0.0.1:9981")
START_PAGE = os.environ.get("TVHADMIN_PAGE", "now.html")
MENU_W = 640
MENU_H = 480

ONBOARD_BOOTSTRAP = """
(function() {
  window.TVH_PLAYER = 1;
  var c = {};
  try {
    c = JSON.parse(decodeURIComponent(localStorage.getItem('TVHadmin') || '%7B%7D'));
  } catch (e) {}
  c.SCREEN = 'onboard';
  c.PREVIEW_PLAYER = 'external';
  c.VLC_HELPER = '1';
  localStorage.setItem('TVHadmin', encodeURIComponent(JSON.stringify(c)));
})();
"""


def load_gtk():
    import gi

    gi.require_version("Gtk", "3.0")
    try:
        gi.require_version("WebKit2", "4.1")
    except ValueError:
        gi.require_version("WebKit2", "4.0")
    from gi.repository import Gdk, GLib, Gtk, WebKit2

    try:
        from gi.repository import GdkX11  # noqa: F401
    except ImportError:
        GdkX11 = None
    return Gtk, Gdk, GLib, WebKit2, GdkX11


def load_vlc():
    try:
        import vlc
        return vlc
    except ImportError:
        return None


def tvhadmin_url():
    for arg in sys.argv[1:]:
        if arg.startswith("--url="):
            return arg.split("=", 1)[1]
    env = os.environ.get("TVHADMIN_URL", "").strip()
    if env:
        return env
    return "%s/static/TVHadmin-JS/%s" % (DEFAULT_TVH.rstrip("/"), START_PAGE)


class PlayBackend(object):
    def __init__(self, app):
        self.app = app
        self._playing = False
        self._lock = threading.Lock()

    def play(self, url, title=None, fullscreen=True, small_screen=False, radio=False):
        with self._lock:
            self._playing = True
        self.app.idle(self.app.play_media, url, title or "", radio)

    def stop(self):
        with self._lock:
            self._playing = False
        self.app.idle(self.app.stop_media)

    def show_menu(self):
        self.app.idle(self.app.show_menu)

    def show_video(self):
        self.app.idle(self.app.show_video)

    def is_playing(self):
        with self._lock:
            return self._playing

    def set_playing(self, value):
        with self._lock:
            self._playing = bool(value)

    def seek(self, seconds):
        self.app.idle(self.app.seek_media, seconds)


class PlayerApp(object):
    def __init__(self, helper, port):
        Gtk, Gdk, GLib, WebKit2, GdkX11 = load_gtk()
        self.Gtk = Gtk
        self.Gdk = Gdk
        self.GLib = GLib
        self.WebKit2 = WebKit2
        self.GdkX11 = GdkX11
        self.vlc_mod = load_vlc()
        self.helper = helper
        self.port = port
        self.backend = PlayBackend(self)
        self.player = None
        self.instance = None
        self._xid_ready = False
        self._is_recording = False
        self._show_cursor = "--show-cursor" in sys.argv

        self.window = Gtk.Window(title="TVHadmin")
        self.window.set_wmclass("tvhadmin", "TVHadmin")
        self.window.set_default_size(MENU_W, MENU_H)
        try:
            self.window.override_background_color(Gtk.StateFlags.NORMAL, Gdk.RGBA(0, 0, 0, 1))
        except Exception:
            pass
        self.window.connect("destroy", self._on_quit)
        self.window.connect("key-press-event", self._on_key)
        self.window.connect("realize", self._hide_cursor)

        self.stack = Gtk.Stack()
        self.stack.set_transition_type(Gtk.StackTransitionType.NONE)
        self.stack.set_size_request(MENU_W, MENU_H)
        holder = Gtk.Box()
        holder.set_halign(Gtk.Align.CENTER)
        holder.set_valign(Gtk.Align.CENTER)
        holder.pack_start(self.stack, False, False, 0)
        self.window.add(holder)

        ucm = WebKit2.UserContentManager()
        try:
            script = WebKit2.UserScript.new(
                ONBOARD_BOOTSTRAP,
                WebKit2.UserContentInjectedFrames.ALL_FRAMES,
                WebKit2.UserScriptInjectionTime.START,
                None,
                None,
            )
            ucm.add_script(script)
        except Exception:
            pass
        try:
            self.webview = WebKit2.WebView.new_with_user_content_manager(ucm)
        except TypeError:
            self.webview = WebKit2.WebView()
        self.webview.set_size_request(MENU_W, MENU_H)
        try:
            self.webview.set_zoom_level(1.0)
        except Exception:
            pass
        settings = self.webview.get_settings()
        settings.set_enable_javascript(True)
        try:
            settings.set_enable_write_console_messages_to_stdout(True)
        except AttributeError:
            pass
        self.webview.connect("context-menu", lambda *a: True)
        self.webview.connect("load-failed", self._on_load_failed)
        self.webview.connect("load-changed", self._on_load_changed)
        self.stack.add_named(self.webview, "menu")

        self.video = Gtk.DrawingArea()
        self.video.set_size_request(MENU_W, MENU_H)
        self.video.set_hexpand(True)
        self.video.set_vexpand(True)
        self.video.connect("realize", self._on_video_realize)
        self.stack.add_named(self.video, "video")
        self.GLib.timeout_add(800, self._hide_cursor)

        self._make_vlc()
        helper.set_play_backend(self.backend)
        helper.set_ui_log(lambda line: print(line, file=sys.__stderr__))

        threading.Thread(target=self._run_helper, daemon=True).start()
        self.window.show_all()
        if "--windowed" not in sys.argv:
            self.window.fullscreen()
        self.GLib.timeout_add(300, self._open_ui)

    def idle(self, fn, *args):
        self.GLib.idle_add(lambda: (fn(*args) or False))

    def _run_helper(self):
        try:
            self.helper.run_helper(self.port)
        except SystemExit:
            self.idle(self._port_busy)
        except Exception as exc:
            self.helper.log_event("Helper error: %s" % exc)

    def _port_busy(self):
        self.helper.log_event("Port %s busy — another helper is running. Close it and try again." % self.port)
        return False

    def _make_vlc(self):
        if not self.vlc_mod:
            self.helper.log_event("python3-vlc missing — install: sudo apt install python3-vlc vlc")
            return
        args = [
            "--intf", "dummy",
            "--no-osd",
            "--no-video-title-show",
            "--no-qt-privacy-ask",
            "--quiet",
        ]
        try:
            self.instance = self.vlc_mod.Instance(args)
            self.player = self.instance.media_player_new()
            events = self.player.event_manager()
            events.event_attach(self.vlc_mod.EventType.MediaPlayerEndReached, self._on_ended)
            events.event_attach(self.vlc_mod.EventType.MediaPlayerEncounteredError, self._on_vlc_error)
        except Exception as exc:
            self.helper.log_event("Could not start libVLC: %s" % exc)
            self.player = None

    def _on_video_realize(self, widget):
        self._bind_window()
        self._xid_ready = True
        self._hide_cursor()

    def _blank_cursor(self):
        if self._show_cursor:
            return False
        display = self.window.get_display()
        cur = None
        try:
            cur = self.Gdk.Cursor.new_from_name(display, "none")
        except Exception:
            cur = None
        if cur is None:
            try:
                cur = self.Gdk.Cursor.new_for_display(display, self.Gdk.CursorType.BLANK_CURSOR)
            except Exception:
                return False
        for widget in (self.window, self.webview, self.video):
            gdk_win = widget.get_window()
            if gdk_win is not None:
                gdk_win.set_cursor(cur)
        return False

    def _hide_cursor(self, *args):
        self.GLib.idle_add(self._blank_cursor)
        return False

    def _on_load_changed(self, view, event):
        if self._show_cursor:
            return
        if event != self.WebKit2.LoadEvent.FINISHED:
            return
        try:
            view.run_javascript(
                "document.documentElement.style.cursor='none';"
                "var s=document.createElement('style');"
                "s.textContent='html,body,*{cursor:none !important}';"
                "document.documentElement.appendChild(s);",
                None, None, None,
            )
        except TypeError:
            view.run_javascript(
                "document.documentElement.style.cursor='none';"
            )
        self._hide_cursor()

    def _bind_window(self):
        if not self.player:
            return
        win = self.video.get_window()
        if win is None:
            return
        try:
            xid = win.get_xid()
        except Exception:
            self.helper.log_event("Need X11 to draw video in this window (raspi-config: Wayland -> X11)")
            return
        try:
            self.player.set_xwindow(xid)
        except Exception as exc:
            self.helper.log_event("VLC window bind failed: %s" % exc)

    def _open_ui(self):
        url = tvhadmin_url()
        self.helper.log_event("Opening %s" % url)
        self.webview.load_uri(url)
        self.show_menu()
        return False

    def _on_load_failed(self, view, load_event, uri, error):
        msg = error.message if error else "connection failed"
        self.helper.log_event("Could not open %s (%s)" % (uri, msg))
        html = """<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;background:#222;color:#eee">
<h1>TVHeadend is not running</h1>
<p>The player opened, but nothing is listening at <code>%s</code>.</p>
<p>On the Pi, in a terminal:</p>
<pre style="background:#111;padding:12px">sudo systemctl start tvheadend
sudo systemctl status tvheadend</pre>
<p>Then close this app and start it again.</p>
<p>If TVHeadend is on another device:</p>
<pre style="background:#111;padding:12px">export TVHADMIN_TVH=http://PI-IP-ADDRESS:9981
python3 scripts/tvhadmin_player.py</pre>
<p style="color:#888">Detail: %s</p>
</body></html>""" % (uri, msg)
        view.load_html(html, "about:blank")
        return True

    def play_media(self, url, title, radio):
        if not self.player:
            self.helper.log_event("No built-in VLC — cannot play")
            return
        if not self._xid_ready:
            self.video.realize()
            self._bind_window()
        media = self.instance.media_new(url)
        if title:
            media.add_option(":meta-title=%s" % title.replace(":", " "))
        if radio:
            media.add_option(":audio-visual=visual")
            media.add_option(":effect-list=spectrum")
        self.player.set_media(media)
        self._bind_window()
        self._is_recording = "dvrfile" in (url or "").lower() or "/dvr/" in (url or "").lower()
        self.backend.set_playing(True)
        self.show_video()
        self.player.play()
        self.helper.log_event("Playing%s: %s" % (" (radio)" if radio else "", title or url[:80]))

    def seek_media(self, seconds):
        if not self.player:
            return False
        try:
            length = self.player.get_length()
            t = self.player.get_time()
            if t < 0:
                t = 0
            nt = int(t + float(seconds) * 1000)
            if length > 0:
                nt = max(0, min(nt, max(0, length - 500)))
            else:
                nt = max(0, nt)
            self.player.set_time(nt)
        except Exception as exc:
            self.helper.log_event("Seek failed: %s" % exc)
        return False

    def _run_js(self, code):
        try:
            self.webview.run_javascript(code, None, None, None)
        except TypeError:
            try:
                self.webview.run_javascript(code)
            except Exception:
                pass

    def stop_media(self):
        if self.player:
            try:
                self.player.stop()
            except Exception:
                pass
        self.backend.set_playing(False)
        self.show_menu()

    def show_menu(self):
        self.stack.set_visible_child_name("menu")
        try:
            self.window.get_window().raise_()
        except Exception:
            pass
        return False

    def show_video(self):
        if not self.backend.is_playing():
            return False
        self.stack.set_visible_child_name("video")
        self._bind_window()
        return False

    def _on_ended(self, event):
        self.idle(self.stop_media)

    def _on_vlc_error(self, event):
        self.helper.log_event("VLC error — check the stream / aerial")

    def _on_key(self, widget, event):
        key = event.keyval
        Gdk = self.Gdk
        if key in (Gdk.KEY_Escape, Gdk.KEY_BackSpace):
            self.helper.on_backspace()
            return True
        if key == Gdk.KEY_F11:
            if self.window.is_fullscreen():
                self.window.unfullscreen()
            else:
                self.window.fullscreen()
            return True
        if self.stack.get_visible_child_name() != "video":
            return False
        arrows = {
            Gdk.KEY_Up: "ArrowUp",
            Gdk.KEY_KP_Up: "ArrowUp",
            Gdk.KEY_Down: "ArrowDown",
            Gdk.KEY_KP_Down: "ArrowDown",
            Gdk.KEY_Left: "ArrowLeft",
            Gdk.KEY_KP_Left: "ArrowLeft",
            Gdk.KEY_Right: "ArrowRight",
            Gdk.KEY_KP_Right: "ArrowRight",
        }
        name = arrows.get(key)
        if not name:
            return False
        if self._is_recording:
            secs = {"ArrowLeft": -30, "ArrowRight": 30, "ArrowUp": 60, "ArrowDown": -60}[name]
            self.seek_media(secs)
        else:
            self._run_js("handle_watch_key('%s')" % name)
        return True

    def _on_quit(self, *args):
        try:
            self.stop_media()
        except Exception:
            pass
        self.helper.set_play_backend(None)
        self.helper.stop_helper()
        self.Gtk.main_quit()

    def run(self):
        self.Gtk.main()


def main():
    try:
        load_gtk()
    except Exception as exc:
        if sys.platform == "win32":
            sys.stderr.write(
                "This player is for the Raspberry Pi, not Windows.\n"
                "Copy the project to the Pi, then run:\n"
                "  sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 gir1.2-webkit2-4.0 python3-vlc vlc\n"
                "  python3 scripts/tvhadmin_player.py\n"
            )
        else:
            sys.stderr.write(
                "GTK/WebKit not installed (needed to draw the menus).\n"
                "On the Pi run:\n"
                "  sudo apt update\n"
                "  sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 python3-vlc vlc\n"
                "  sudo apt install gir1.2-webkit2-4.1 || sudo apt install gir1.2-webkit2-4.0\n"
                "Then start it again:\n"
                "  python3 %s\n"
                "Detail: %s\n" % (os.path.abspath(__file__), exc)
            )
        sys.exit(1)
    import tvhadmin_vlc_helper as helper

    port = helper.DEFAULT_PORT
    for arg in sys.argv[1:]:
        if arg.isdigit():
            port = int(arg)
    PlayerApp(helper, port).run()


if __name__ == "__main__":
    main()
