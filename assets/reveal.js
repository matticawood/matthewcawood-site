// Shared scroll-reveal: fades `.reveal` elements up as they enter the viewport.
// Reuses the .reveal/.reveal.visible CSS in site.css. Reduced-motion users get
// everything visible immediately (handled by CSS), and we also reveal-all as a
// safety net if IntersectionObserver is unavailable.
(function () {
  var els = [].slice.call(document.querySelectorAll('.reveal:not(.visible)'));
  if (!els.length) return;
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('visible'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
  els.forEach(function (el) { io.observe(el); });
  // Safety net: if anything is still hidden after 3s (e.g. observer never fired
  // because the element started off-screen in an odd layout), reveal it.
  setTimeout(function () {
    els.forEach(function (el) { if (!el.classList.contains('visible')) el.classList.add('visible'); });
  }, 3000);
})();
