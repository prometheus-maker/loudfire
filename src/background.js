// Loudfire: the popup asks for a level; this injects the page script into the tab and applies it.
// Sites you ask it to remember get their level back on every visit (needs that site's permission, asked once).
const api = globalThis.browser ?? globalThis.chrome;

async function inject(tabId) {
  await api.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["src/booster.js"] }).catch(() =>
    api.scripting.executeScript({ target: { tabId }, files: ["src/booster.js"] }));
}

async function run(tabId, func, args = []) {
  const res = await api.scripting.executeScript({ target: { tabId, allFrames: true }, func, args }).catch(() =>
    api.scripting.executeScript({ target: { tabId }, func, args }));
  // Add up what every frame (page, embedded players) reports.
  const sum = { level: args[0] ?? 1, players: 0, boosted: 0, skippedCount: 0, skipped: [], peak: 0, needsClick: false };
  for (const r of res || []) {
    const s = r.result; if (!s) continue;
    sum.level = s.level; sum.players += s.players; sum.boosted += s.boosted; sum.skippedCount += s.skippedCount;
    sum.skipped.push(...s.skipped); sum.peak = Math.max(sum.peak, s.peak); sum.needsClick ||= s.needsClick;
  }
  sum.skipped = [...new Set(sum.skipped)];
  return sum;
}

async function setLevel(tabId, level) {
  await inject(tabId);
  return run(tabId, (v) => window.__loudfire.setLevel(v), [level]);
}

async function getStatus(tabId) {
  return run(tabId, () => (window.__loudfire ? window.__loudfire.status() : null));
}

api.runtime.onMessage.addListener((m) => {
  if (m.cmd === "set") return setLevel(m.tabId, m.level);
  if (m.cmd === "status") return getStatus(m.tabId);
});

api.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url || !/^https?:/.test(tab.url)) return;
  const host = new URL(tab.url).hostname;
  const { sites = {} } = await api.storage.local.get("sites");
  if (!(host in sites)) return;
  if (!(await api.permissions.contains({ origins: [`*://${host}/*`] }))) return;
  setLevel(tabId, sites[host]).catch(() => {});
});
