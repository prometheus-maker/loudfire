const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
let tab, host, timer;

function show(s) {
  if (!s) return;
  $("pct").textContent = Math.round(s.level * 100) + "%";
  $("bar").style.width = Math.min(100, s.peak * 100) + "%";
  const m = $("msg"); m.className = "msg";
  if (!s.players) m.textContent = s.level === 1 ? "" : "No audio or video on this page yet. It will boost them when they appear.";
  else if (s.needsClick) { m.textContent = "Click anywhere on the page once, then the boost starts."; m.className = "msg warn"; }
  else if (s.skippedCount && !s.boosted) { m.textContent = `Can't boost here: ${s.skipped.join(", ")}. Left at normal volume, so nothing goes silent.`; m.className = "msg warn"; }
  else if (s.skippedCount) m.textContent = `Boosting ${s.boosted} of ${s.players} players. ${s.skippedCount} left as is (${s.skipped.join(", ")}).`;
  else m.textContent = s.level === 1 ? `${s.players} player${s.players > 1 ? "s" : ""} found.` : `Boosting ${s.boosted} player${s.boosted > 1 ? "s" : ""}.`;
}

async function set(level) {
  $("pct").textContent = level + "%";
  try { show(await api.runtime.sendMessage({ cmd: "set", tabId: tab.id, level: level / 100 })); }
  catch (e) { $("msg").textContent = "This page can't be boosted (browser pages and add-on stores are protected)."; $("msg").className = "msg warn"; }
  if ($("remember").checked) save(level / 100);
}

async function save(level) {
  const { sites = {} } = await api.storage.local.get("sites");
  sites[host] = level; await api.storage.local.set({ sites });
}

async function init() {
  [tab] = await api.tabs.query({ active: true, currentWindow: true });
  // Test hook: popup.html?other opens as a tab in tests, so it targets the most recent other tab.
  if (location.search.includes("other")) {
    const tabs = await api.tabs.query({ currentWindow: true });
    tab = tabs.filter((t) => t.id !== tab.id).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  }
  try { host = new URL(tab.url).hostname; } catch { host = ""; }
  $("host").textContent = host;
  const { sites = {} } = await api.storage.local.get("sites");
  if (host in sites) {
    $("remember").checked = await api.permissions.contains({ origins: [`*://${host}/*`] });
    $("slider").value = Math.round(sites[host] * 100); $("pct").textContent = $("slider").value + "%";
  }
  try { show(await api.runtime.sendMessage({ cmd: "status", tabId: tab.id })); } catch {}
  timer = setInterval(async () => { try { show(await api.runtime.sendMessage({ cmd: "status", tabId: tab.id })); } catch {} }, 250);
}

$("slider").addEventListener("input", (e) => set(Number(e.target.value)));
$("reset").addEventListener("click", () => { $("slider").value = 100; set(100); });
$("remember").addEventListener("change", async (e) => {
  if (e.target.checked) {
    // Asked only for this one site, and only when you tick the box.
    const ok = await api.permissions.request({ origins: [`*://${host}/*`] });
    if (!ok) { e.target.checked = false; return; }
    save(Number($("slider").value) / 100);
  } else {
    const { sites = {} } = await api.storage.local.get("sites"); delete sites[host];
    await api.storage.local.set({ sites });
    api.permissions.remove({ origins: [`*://${host}/*`] });
  }
});
init();
