/* Cookieless, first-party analytics for the whole brand site.
   A random visitor id lives in localStorage (no cookies, no third-party, no PII,
   no IP). Events beacon to /.netlify/functions/track, which stamps a coarse
   country and writes to site_events.

   Auto-fires:  view, scroll (25/50/75/100), leave (time on page),
                product_view (on /store/<slug>/ pages).
   Click hooks: any element with data-mc="<event>" fires that event, optionally
                with data-mc-slug / data-mc-value (minor units) / data-mc-currency.
   API:         window.mcVid           -> the visitor id (thread into checkout)
                window.mcTrack(ev, {}) -> fire a custom funnel event */
(function () {
  var ENDPOINT = "/.netlify/functions/track";

  // Owner self-exclude: load any page with ?notrack=1 once and this browser stops
  // sending analytics (flag saved in localStorage). Use ?track=1 to resume.
  try {
    var _qp = new URLSearchParams(location.search);
    if (_qp.has("notrack")) localStorage.setItem("mc_notrack", "1");
    if (_qp.has("track")) localStorage.removeItem("mc_notrack");
    if (localStorage.getItem("mc_notrack") === "1") return;
  } catch (e) {}

  var vid;
  try {
    vid = localStorage.getItem("tpr_vid");
    if (!vid) {
      vid = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
      localStorage.setItem("tpr_vid", vid);
    }
  } catch (e) { vid = "nostore-" + Math.random().toString(36).slice(2); }
  window.mcVid = vid;

  var q = new URLSearchParams(location.search);
  var ua = navigator.userAgent || "";
  var base = {
    vid: vid,
    path: location.pathname,
    referrer: document.referrer || "",
    utm_source: q.get("utm_source"), utm_medium: q.get("utm_medium"),
    utm_campaign: q.get("utm_campaign"), utm_content: q.get("utm_content"), utm_term: q.get("utm_term"),
    device: /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? "mobile" : "desktop",
    screen_w: (window.screen && screen.width) || 0
  };

  function send(event, extra) {
    var payload = Object.assign({ event: event }, base, extra || {});
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      else fetch(ENDPOINT, { method: "POST", body: body, headers: { "Content-Type": "application/json" }, keepalive: true });
    } catch (e) {}
  }
  window.mcTrack = send;

  // page view
  send("view");

  // auto product_view on a store product page: /store/<slug>/ (not the index or course player)
  var m = location.pathname.match(/^\/store\/([^\/]+)\/?$/);
  if (m && m[1] !== "learn") send("product_view", { slug: m[1] });

  // scroll depth milestones (25/50/75/100), each once
  var hit = {}, marks = [25, 50, 75, 100];
  function onScroll() {
    var doc = document.documentElement;
    var h = Math.max(doc.scrollHeight, document.body.scrollHeight);
    var pct = Math.min(100, Math.round((window.scrollY + window.innerHeight) / h * 100));
    for (var i = 0; i < marks.length; i++) { var k = marks[i]; if (pct >= k && !hit[k]) { hit[k] = 1; send("scroll", { scroll_pct: k }); } }
    if (hit[100]) window.removeEventListener("scroll", onScroll);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // declarative click hooks: <button data-mc="checkout_click" data-mc-slug="..." data-mc-value="1499" data-mc-currency="gbp">
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-mc]");
    if (!el) return;
    var ev = el.getAttribute("data-mc");
    if (!ev) return;
    var extra = {};
    var slug = el.getAttribute("data-mc-slug"); if (slug) extra.slug = slug;
    var val = el.getAttribute("data-mc-value"); if (val != null && val !== "") extra.value_minor = parseInt(val, 10) || null;
    var cur = el.getAttribute("data-mc-currency"); if (cur) extra.currency = cur;
    var cta = el.getAttribute("data-mc-cta"); if (cta) extra.cta = cta;
    send(ev, extra);
  }, true);

  // time on page (fire once on first hide / unload)
  var start = Date.now(), left = false;
  function leave() { if (left) return; left = true; send("leave", { dur_ms: Date.now() - start }); }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") leave(); });
  window.addEventListener("pagehide", leave);
})();
