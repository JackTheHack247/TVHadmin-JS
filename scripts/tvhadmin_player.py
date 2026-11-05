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

        self.window = Gtk.Window(title="TVHadmin")
        self.window.set_wmclass("tvhadmin", "TVHadmin")
        self.window.connect("destroy", self._on_quit)
        self.window.connect("key-press-event", self._on_key)

        self.stack = Gtk.Stack()
        self.stack.set_transition_type(Gtk.StackTransitionType.NONE)
        self.window.add(self.stack)

        self.webview = WebKit2.WebView()
        settings = self.webview.get_settings()
        settings.set_enable_javascript(True)
        try:
            settings.set_enable_write_console_messages_to_stdout(True)
        except AttributeError:
            pass
        self.webview.connect("context-menu", lambda *a: True)
        self.stack.add_named(self.webview, "menu")

        self.video = Gtk.DrawingArea()
        self.video.set_hexpand(True)
        self.video.set_vexpand(True)
        self.video.connect("realize", self._on_video_realize)
        self.stack.add_named(self.video, "video")

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
        self.backend.set_playing(True)
        self.show_video()
        self.player.play()
        self.helper.log_event("Playing%s: %s" % (" (radio)" if radio else "", title or url[:80]))

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
        if key in (self.Gdk.KEY_Escape, self.Gdk.KEY_BackSpace):
            self.helper.on_backspace()
            return True
        if key == self.Gdk.KEY_F11:
            if self.window.is_fullscreen():
                self.window.unfullscreen()
            else:
                self.window.fullscreen()
            return True
        return False

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
        sys.stderr.write(
            "GTK/WebKit not installed.\n"
            "  sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 python3-vlc vlc\n"
            "(%s)\n" % exc
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
