"""Install Loudfire into a real Firefox (geckodriver), play a same-site and a cross-site tone, move the slider in the popup,
check: same-site is boosted (meter rises ~3x), cross-site is skipped and still playing. Run: tests/real.sh"""
import http.server, json, pathlib, shutil, socketserver, sys, tempfile, threading, time, zipfile
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

HOME = pathlib.Path.home(); HERE = pathlib.Path(__file__).resolve().parent; ROOT = HERE.parent
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""), flush=True)
    if not ok: fails.append(name)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(HERE / "pages"), **k)
    def log_message(self, *a): pass
srvs = []
for _ in range(2):
    s = socketserver.TCPServer(("127.0.0.1", 0), Quiet); threading.Thread(target=s.serve_forever, daemon=True).start(); srvs.append(s)
A = f"http://127.0.0.1:{srvs[0].server_address[1]}"; B = f"http://127.0.0.1:{srvs[1].server_address[1]}"  # other port = other origin

# Test copy: host permission for the local pages, because a headless test can't click the toolbar button (activeTab).
tmp = pathlib.Path(tempfile.mkdtemp()); xpi = tmp / "loudfire-test.xpi"
m = json.loads((ROOT / "manifest.json").read_text()); m["host_permissions"] = ["http://127.0.0.1/*"]
with zipfile.ZipFile(xpi, "w") as z:
    z.writestr("manifest.json", json.dumps(m))
    for p in list((ROOT / "src").rglob("*")) + list((ROOT / "icons").rglob("*")):
        if p.is_file(): z.write(p, p.relative_to(ROOT))

o = Options(); o.binary_location = str(HOME / ".local/firefox-real/firefox/firefox"); o.add_argument("-headless")
o.set_preference("media.autoplay.default", 0); o.set_preference("media.autoplay.blocking_policy", 0); o.set_preference("media.autoplay.block-webaudio", False); o.set_preference("media.cubeb.force_null_context", True)
d = webdriver.Firefox(options=o, service=Service(str(HOME / ".local/firefox-real/geckodriver"), service_args=["--allow-system-access"]))
try:
    d.install_addon(str(xpi), temporary=True)
    d.set_context(d.CONTEXT_CHROME)
    host = d.execute_script("return WebExtensionPolicy.getByID('loudfire@prometheus-maker.github.io').mozExtensionHostname")
    d.set_context(d.CONTEXT_CONTENT)
    d.get(f"{A}/player.html?{B}/tone.wav")
    d.find_element("tag name", "h1").click()  # user activation, like a real visitor
    d.execute_script("document.getElementById('same').play(); document.getElementById('other').play();")
    time.sleep(1.5)
    page = d.current_window_handle
    d.switch_to.new_window("tab"); d.get(f"moz-extension://{host}/src/popup.html?other"); time.sleep(1.5)

    def slide(v):
        d.execute_script("const s = document.getElementById('slider'); s.value = arguments[0]; s.dispatchEvent(new Event('input'));", v)
        peaks = []
        for _ in range(12):
            time.sleep(0.25)
            peaks.append(float(d.execute_script("return parseFloat(document.getElementById('bar').style.width) || 0")))
        return max(peaks), d.find_element("id", "msg").text, d.find_element("id", "pct").text
    p100, msg100, _ = slide(100)
    p300, msg300, pct = slide(300)
    print(f".. meter 100%: {p100:.1f}  300%: {p300:.1f}  msg: {msg300}")
    check("slider shows 300%", pct == "300%", pct)
    if "Click anywhere" in msg300:
        # Headless Firefox on this server never starts an AudioContext (resume() hangs even after a click), so the
        # boost itself is checked in Chrome (tests/chromium_audio.py). Here: the popup reached the page, and nothing
        # was routed into a context that can't play (that would silence the page).
        print(".. AudioContext can't start in this headless Firefox; checking the safe fallback")
        check("popup talks to the page (no error message)", "can't be boosted" not in msg300, msg300)
    else:
        check("same-site player boosted, cross-site skipped", "Boosting 1 of 2" in msg300, msg300)
        check("meter rises at 300% (2.5x+ before the limiter)", p100 > 0 and p300 >= 2.5 * p100, f"{p100:.1f} -> {p300:.1f}")
    d.switch_to.window(page)
    st = d.execute_script("const o = document.getElementById('other'), s = document.getElementById('same'); return [o.paused, o.currentTime, s.paused, s.currentTime];")
    check("both players still playing (nothing routed into silence)", st[0] is False and st[1] > 1 and st[2] is False and st[3] > 1, st)
    d.save_screenshot("/tmp/loudfire-page.png")
finally:
    d.quit()
print("\n" + ("all passed" if not fails else f"{len(fails)} failed: {fails}"))
sys.exit(1 if fails else 0)
