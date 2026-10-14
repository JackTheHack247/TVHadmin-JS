#!/usr/bin/env python3
"""
TVHadmin VLC — small desktop app for the Pi (no terminal needed).

- HTTP helper for TVHadmin (Play → VLC)
- Backspace while VLC is active → minimize VLC, open Pale Moon + menu
- Activity log in the window (each Backspace shows here)

Requires: python3-tk, python3-evdev, wmctrl, xdotool, vlc
"""
from __future__ import print_function

import os
import sys
import threading
import tkinter as tk
from tkinter import messagebox, scrolledtext, ttk

DIR = os.path.dirname(os.path.abspath(__file__))
if DIR not in sys.path:
    sys.path.insert(0, DIR)


class SafeLogStream(object):
    """File-like stream for libraries that call write(..., flush=True)."""

    def __init__(self, append_line):
        self._append = append_line

    def write(self, text, *args, **kwargs):
        if not text:
            return 0
        for part in text.splitlines():
            part = part.strip()
            if part:
                self._append(part)
        return len(text)

    def flush(self, *args, **kwargs):
        pass


class TvhadminVlcApp(object):
    def __init__(self, helper, port):
        self.helper = helper
        self.port = port
        self.helper_thread = None
        self.root = tk.Tk(className=helper.APP_WM_CLASS)
        self.root.title("TVHadmin Remote")
        self.root.minsize(420, 320)
        self.root.geometry("480x360")
        self._build_ui()
        self._poll_status()
        self.helper.set_ui_log(self._thread_safe_log)
        sys.stdout = SafeLogStream(self._thread_safe_log)
        sys.stderr = SafeLogStream(self._thread_safe_log)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self._start_helper()
        if "--show" not in sys.argv:
            self.root.after(4000, self.root.iconify)

    def _build_ui(self):
        top = ttk.Frame(self.root, padding=8)
        top.pack(fill=tk.X)

        self.status_var = tk.StringVar(value="Starting…")
        ttk.Label(top, textvariable=self.status_var).pack(anchor=tk.W)
        ttk.Label(
            top,
            text="Backspace: presses F in VLC (leave fullscreen), opens Pale Moon menu. Backspace again returns to VLC. "
            "This window minimizes itself after a few seconds; click it in the taskbar to see the log.",
            wraplength=440,
        ).pack(anchor=tk.W, pady=(4, 0))

        log_frame = ttk.LabelFrame(self.root, text="Activity", padding=6)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=8, pady=4)
        self.log = scrolledtext.ScrolledText(
            log_frame, height=12, state=tk.DISABLED, font=("DejaVu Sans Mono", 10)
        )
        self.log.pack(fill=tk.BOTH, expand=True)

        btns = ttk.Frame(self.root, padding=8)
        btns.pack(fill=tk.X)
        ttk.Button(btns, text="Hide window", command=self.root.iconify).pack(
            side=tk.LEFT
        )
        ttk.Button(btns, text="Quit", command=self._on_close).pack(side=tk.RIGHT)

    def _thread_safe_log(self, line):
        if threading.current_thread() is threading.main_thread():
            self._append_log(line)
        else:
            self.root.after(0, lambda msg=line: self._append_log(msg))

    def _append_log(self, line):
        if not line:
            return
        self.log.configure(state=tk.NORMAL)
        self.log.insert(tk.END, line + "\n")
        self.log.see(tk.END)
        self.log.configure(state=tk.DISABLED)

    def _start_helper(self):
        helper = self.helper

        def runner():
            try:
                helper.run_helper(self.port)
            except SystemExit:
                self.root.after(
                    0,
                    lambda: messagebox.showerror(
                        "TVHadmin Remote",
                        "Port %s is already in use.\n"
                        "Close the other helper or run start-vlc-helper.sh --restart"
                        % self.port,
                    ),
                )
            except Exception as exc:
                self._thread_safe_log("Helper error: %s" % exc)

        self.helper_thread = threading.Thread(
            target=runner, name="tvhadmin-http", daemon=True
        )
        self.helper_thread.start()
        self.helper.log_event("TVHadmin VLC app started")

    def _poll_status(self):
        hot = self.helper.hotkeys_enabled()
        self.status_var.set(
            "Running on port %s — Backspace hotkeys %s"
            % (self.port, "ON" if hot else "waiting…")
        )
        self.root.after(800, self._poll_status)

    def _on_close(self):
        if messagebox.askokcancel("TVHadmin Remote", "Stop the helper and quit?"):
            self.helper.stop_helper()
            self.root.destroy()

    def run(self):
        self.root.mainloop()


def main():
    import tvhadmin_vlc_helper as helper  # noqa: E402

    port = helper.DEFAULT_PORT
    for arg in sys.argv[1:]:
        if arg.isdigit():
            port = int(arg)
    app = TvhadminVlcApp(helper, port)
    app.run()


if __name__ == "__main__":
    main()
