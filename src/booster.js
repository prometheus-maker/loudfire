/* Loudfire page script. Injected only when you move the slider (or on a site you asked it to remember).
   Each <audio>/<video> is routed through Web Audio: source -> gain -> limiter -> speakers.
   Routing is one-way (an element can't be un-routed), so it only routes media that will stay audible:
   - same-origin, blob: and MediaSource media, or media loaded with CORS (crossorigin attribute);
   - never DRM media (mediaKeys) or another site's media without CORS: Web Audio would output silence there,
     which is how most volume boosters end up muting Netflix, Bandcamp or Imgur.
   Skipped elements keep playing at normal volume. */
(() => {
  if (window.__loudfire) return;
  const ctxs = { ctx: null, gain: null, limiter: null, meter: null };
  const routed = new WeakSet();
  const skipped = new Map(); // element -> reason
  let level = 1;

  function graph() {
    if (ctxs.ctx) return ctxs;
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor(); // soft ceiling so 600% doesn't clip into noise
    limiter.threshold.value = -3; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.003; limiter.release.value = 0.25;
    const meter = ctx.createAnalyser(); meter.fftSize = 2048;
    gain.connect(limiter); limiter.connect(ctx.destination); gain.connect(meter);
    Object.assign(ctxs, { ctx, gain, limiter, meter });
    return ctxs;
  }

  function safeReason(el) {
    if (el.mediaKeys) return "protected (DRM) video";
    const src = el.currentSrc || el.src || "";
    if (!src || src.startsWith("blob:") || src.startsWith("data:") || src.startsWith("mediasource:")) return null;
    let u;
    try { u = new URL(src, location.href); } catch { return "unreadable address"; }
    if (u.origin === location.origin) return null;
    if (el.crossOrigin) return null; // loaded with CORS: Web Audio may read it
    return "audio from another site that doesn't allow it";
  }

  function route(el) {
    if (routed.has(el)) return;
    const why = safeReason(el);
    if (why) { skipped.set(el, why); return; }
    try {
      const { ctx, gain } = graph();
      ctx.createMediaElementSource(el).connect(gain);
      routed.add(el); skipped.delete(el);
    } catch (e) {
      skipped.set(el, "the page already uses this audio");
    }
  }

  function scan() { if (ctxs.ctx && ctxs.ctx.state === "running") document.querySelectorAll("audio, video").forEach(route); }

  // A suspended AudioContext would silence everything routed into it, so nothing is routed until it runs.
  // Browsers only let it run after the page got a click or key press.
  async function setLevel(v) {
    level = Math.max(0, Math.min(6, v));
    const { ctx, gain } = graph();
    if (ctx.state !== "running") await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 400))]);
    if (ctx.state !== "running" && !ctxs.waiting) {
      // Start on the first click or key press in the page (that's when the browser allows audio to start).
      ctxs.waiting = true;
      const go = () => ctx.resume().then(() => { scan(); ctxs.waiting = false; });
      for (const t of ["pointerdown", "keydown"]) window.addEventListener(t, go, { capture: true, once: true });
    }
    scan();
    gain.gain.setTargetAtTime(level, ctx.currentTime, 0.02);
    return status();
  }

  function status() {
    const all = [...document.querySelectorAll("audio, video")];
    let peak = 0;
    if (ctxs.meter) {
      const buf = new Float32Array(ctxs.meter.fftSize); ctxs.meter.getFloatTimeDomainData(buf);
      for (const x of buf) peak = Math.max(peak, Math.abs(x));
    }
    return {
      level, players: all.length, boosted: all.filter((e) => routed.has(e)).length,
      skipped: [...new Set(all.filter((e) => skipped.has(e)).map((e) => skipped.get(e)))],
      skippedCount: all.filter((e) => skipped.has(e)).length, peak, running: ctxs.ctx ? ctxs.ctx.state : "off",
      needsClick: !!ctxs.ctx && ctxs.ctx.state !== "running",
    };
  }

  new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true });
  window.__loudfire = { setLevel, status };
})();
