/* ==========================================================================
 * theme-toggle.js — light / dark mode + animated collapsibles.
 *
 * MODE
 *   Default follows the device setting (prefers-color-scheme). A slider switch
 *   (sun ↔ moon) is injected into the nav — visible in the top bar on desktop,
 *   inside the hamburger menu on mobile. The choice persists in localStorage
 *   and syncs across pages.
 *     light mode = "amber / paper"     (style.css :root defaults)
 *     dark mode  = "midnight / amber"  (dark-mode block in style.css)
 *   data-mode on <html>: absent → follow device · "light" / "dark" → override.
 *
 * COLLAPSIBLES
 *   Native <details> can't animate closing on its own, so each collapsible's
 *   content is wrapped and its height/opacity is transitioned in BOTH
 *   directions. Falls back to plain (instant) toggling if JS is unavailable.
 * ========================================================================== */
(function () {
  'use strict';

  var KEY = 'mode';

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function deviceDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function effective() {
    var s = stored();
    return s === 'light' || s === 'dark' ? s : (deviceDark() ? 'dark' : 'light');
  }
  function apply(mode) {
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-mode', mode);
    } else {
      document.documentElement.removeAttribute('data-mode');
    }
  }

  // Apply any persisted choice immediately (before first paint) to avoid a flash.
  apply(stored());

  // ── Slider switch ────────────────────────────────────────────────────────
  function buildToggle() {
    var nav = document.querySelector('.nav-links');
    if (!nav || nav.querySelector('.mode-toggle')) { return; }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-toggle';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', 'Toggle dark mode');
    btn.innerHTML =
      '<span class="mode-track">' +
        '<span class="mode-ico mode-sun" aria-hidden="true">☀</span>' +
        '<span class="mode-ico mode-moon" aria-hidden="true">☾</span>' +
        '<span class="mode-thumb"></span>' +
      '</span>';

    function render() {
      btn.setAttribute('aria-checked', String(effective() === 'dark'));
    }

    btn.addEventListener('click', function () {
      var next = effective() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
      apply(next);
      render();
    });

    render();
    nav.appendChild(btn);

    // While the user hasn't overridden, keep the switch in sync with the device.
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () { if (!stored()) { render(); } };
      if (mq.addEventListener) { mq.addEventListener('change', onChange); }
      else if (mq.addListener) { mq.addListener(onChange); }
    }
  }

  // ── Animated <details> collapsibles ──────────────────────────────────────
  var DURATION = 300;

  function initCollapsible(d) {
    var summary = d.querySelector('summary');
    if (!summary) { return; }

    // Move everything after the summary into an animatable wrapper.
    var wrapper = document.createElement('div');
    wrapper.className = 'collapsible-content';
    var node = summary.nextSibling;
    while (node) {
      var next = node.nextSibling;
      wrapper.appendChild(node);
      node = next;
    }
    d.appendChild(wrapper);

    var busy = false;

    function settle() {
      wrapper.style.transition = '';
      wrapper.style.height = '';
      wrapper.style.opacity = '';
      busy = false;
    }

    summary.addEventListener('click', function (e) {
      e.preventDefault();
      if (busy) { return; }
      busy = true;

      if (d.open) {
        // Collapse: full height → 0, then drop the open state.
        wrapper.style.height = wrapper.scrollHeight + 'px';
        wrapper.style.opacity = '1';
        wrapper.getBoundingClientRect(); // force reflow so the start value sticks
        wrapper.style.transition = 'height ' + DURATION + 'ms ease, opacity ' + DURATION + 'ms ease';
        wrapper.style.height = '0px';
        wrapper.style.opacity = '0';
        window.setTimeout(function () { d.open = false; settle(); }, DURATION);
      } else {
        // Expand: open, then 0 → measured height.
        d.open = true;
        wrapper.style.height = '0px';
        wrapper.style.opacity = '0';
        wrapper.getBoundingClientRect();
        wrapper.style.transition = 'height ' + DURATION + 'ms ease, opacity ' + DURATION + 'ms ease';
        wrapper.style.height = wrapper.scrollHeight + 'px';
        wrapper.style.opacity = '1';
        window.setTimeout(settle, DURATION);
      }
    });
  }

  function initCollapsibles() {
    var list = document.querySelectorAll('details.collapsible');
    Array.prototype.forEach.call(list, initCollapsible);
  }

  function init() {
    buildToggle();
    initCollapsibles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
