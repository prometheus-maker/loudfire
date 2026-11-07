"""Audio check in Chrome for Testing (headless Firefox has no running AudioContext here): load the extension, play a
same-site and a cross-site tone, set 100% then 300% through the background, compare the meter.
Run: LD_LIBRARY_PATH=~/.local/chromelibs/usr/lib/aarch64-linux-gnu ~/.local/venv-browser/bin/python -I tests/chromium_audio.py"""
import http.server, json, pathlib, shutil, socketserver, sys, tempfile, threading, time
from playwright.sync_api import sync_playwright
HERE = pathlib.Path(__file__).resolve().parent; ROOT = HERE.parent
class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(HERE / "pages"), **k)
    def log_message(self, *a): pass
srv = []
for _ in range(2):
    s = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Quiet); threading.Thread(target=s.serve_forever, daemon=True).start(); srv.append(s)
A, B = (f"http://127.0.0.1:{s.server_address[1]}" for s in srv)
ext = pathlib.Path(tempfile.mkdtemp()) / "ext"; ext.mkdir()
shutil.copytree(ROOT / "src", ext / "src"); shutil.copytree(ROOT / "icons", ext / "icons")
m = json.loads((ROOT / "manifest.json").read_text()); m.pop("browser_specific_settings")
m["background"] = {"service_worker": "src/background.js"}; m["host_permissions"] = ["http://127.0.0.1/*"]
(ext / "manifest.json").write_text(json.dumps(m))
fails = []
def check(n, ok, det=""):
    print(("PASS " if ok else "FAIL ") + n + f"  ({det})", flush=True); ok or fails.append(n)
with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(tempfile.mkdtemp(), headless=True, channel="chromium",
        args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}", "--autoplay-policy=no-user-gesture-required"])
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
    p = ctx.new_page(); p.goto(f"{A}/player.html?{B}/tone.wav"); p.click("h1")
    p.evaluate("Promise.all([document.getElementById('same').play(), document.getElementById('other').play()])"); time.sleep(1)
    def level(v):
        r = sw.evaluate("""async (v) => { const tabs = await chrome.tabs.query({}); const t = tabs[tabs.length - 1];
          await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['src/booster.js'] });
          const [res] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: (x) => window.__loudfire.setLevel(x), args: [v] });
          let peak = 0;
          for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 150));
            const [s] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => window.__loudfire.status() });
            peak = Math.max(peak, s.result.peak); }
          return { ...res.result, peak }; }""", v)
        return r
    r1 = level(1); r3 = level(3)
    print(".. 100%:", r1); print(".. 300%:", r3)
    check("context running", r3["running"] == "running", r3["running"])
    check("1 of 2 boosted, cross-site skipped", r3["boosted"] == 1 and r3["skippedCount"] == 1, r3["skipped"])
    check("meter ~3x at 300% (pre-limiter)", r1["peak"] > 0 and r3["peak"] / r1["peak"] > 2.5, f"{r1['peak']:.3f} -> {r3['peak']:.3f}")
    st = p.evaluate("[document.getElementById('other').paused, document.getElementById('other').currentTime]")
    check("cross-site player still playing", st[0] is False and st[1] > 1, st)
    ctx.close()
print("all passed" if not fails else f"{len(fails)} failed")
sys.exit(1 if fails else 0)
