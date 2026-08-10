/* ==========================================================================
 * site.js — the only script on the site. Five behaviours CSS can't express:
 *
 *   1. MODE      light / dark, remembered across pages
 *   2. NAV       mobile menu button, and marking the current page
 *   3. DETAILS   <details> sections that animate closed as well as open
 *   4. BIO PHOTO one photo, picked at random per visit
 *   5. WORDMARK  the LaTeX logo on the resources page
 *
 * Loaded from <head> without `defer` so a remembered mode lands before the
 * first paint; everything else waits for DOMContentLoaded. Each part checks
 * for its own markup, so every page can load the same file.
 * ========================================================================== */
(() => {
  'use strict';

  /* ── 1. Mode ──────────────────────────────────────────────────────────────
     Default follows the device (prefers-color-scheme). The slider switch
     (sun ↔ moon) is built here rather than written into the pages, since a
     control that only works with JS shouldn't exist without it. The choice
     persists in localStorage, so it carries from page to page.
       light mode = "amber / paper"    (style.css :root defaults)
       dark mode  = "midnight / amber" (dark-mode block in style.css)
     data-mode on <html>: absent → follow device · "light" / "dark" → override. */

  const KEY = 'mode';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

  const stored = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };

  const effective = () => {
    const choice = stored();
    return choice === 'light' || choice === 'dark'
      ? choice
      : (prefersDark.matches ? 'dark' : 'light');
  };

  const apply = mode => {
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-mode', mode);
    } else {
      document.documentElement.removeAttribute('data-mode');
    }
  };

  // Before first paint, so a remembered choice never flashes the other mode.
  apply(stored());

  const buildModeToggle = nav => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mode-toggle';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-label', 'Toggle dark mode');
    button.innerHTML =
      '<span class="mode-track">' +
        '<span class="mode-ico" aria-hidden="true">☀</span>' +
        '<span class="mode-ico" aria-hidden="true">☾</span>' +
        '<span class="mode-thumb"></span>' +
      '</span>';

    const render = () => button.setAttribute('aria-checked', String(effective() === 'dark'));

    button.addEventListener('click', () => {
      const next = effective() === 'dark' ? 'light' : 'dark';
      // If storage is unavailable the switch still works, just for this page.
      try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
      apply(next);
      render();
    });

    // Track the device setting for as long as the visitor hasn't overridden it.
    prefersDark.addEventListener('change', () => { if (!stored()) render(); });

    render();
    nav.append(button);
  };

  /* ── 2. Nav ─────────────────────────────────────────────────────────────── */

  const initNav = () => {
    const links = document.querySelector('.nav-links');
    if (!links) { return; }   // the source-code pages have no rail

    buildModeToggle(links);

    // Mark the current page. The home mark isn't in .nav-links, so the front
    // page correctly highlights nothing.
    const here = location.pathname.split('/').pop() || 'index.html';
    links.querySelectorAll('a').forEach(link => {
      if (link.getAttribute('href') === here) { link.classList.add('active'); }
    });

    const panel = document.querySelector('.sidebar-nav');
    const button = document.querySelector('.hamburger');
    if (panel && button) {
      button.addEventListener('click', () => panel.classList.toggle('open'));
    }
  };

  /* ── 3. Details ───────────────────────────────────────────────────────────
     Native <details> can't animate closing, so the content is moved into a
     wrapper whose height and opacity are transitioned in both directions.
     Without JS the sections still open and close, just instantly. */

  const DURATION = 300;

  const initCollapsible = details => {
    const summary = details.querySelector('summary');
    if (!summary) { return; }

    const content = document.createElement('div');
    content.className = 'collapsible-content';
    while (summary.nextSibling) { content.append(summary.nextSibling); }
    details.append(content);

    let busy = false;

    summary.addEventListener('click', event => {
      event.preventDefault();
      if (busy) { return; }
      busy = true;

      const closing = details.open;
      if (!closing) { details.open = true; }   // must be open to be measured
      const full = `${content.scrollHeight}px`;

      content.style.height = closing ? full : '0px';
      content.style.opacity = closing ? '1' : '0';
      content.getBoundingClientRect();         // force the start value to stick
      content.style.transition = `height ${DURATION}ms ease, opacity ${DURATION}ms ease`;
      content.style.height = closing ? '0px' : full;
      content.style.opacity = closing ? '0' : '1';

      setTimeout(() => {
        if (closing) { details.open = false; }
        content.style.cssText = '';            // back to height: auto
        busy = false;
      }, DURATION);
    });
  };

  /* ── 4. Bio photo ─────────────────────────────────────────────────────────
     Extensions are listed rather than probed over the network, so the page
     only ever fetches the one photo it shows. An entry with `frames` is a
     single picture made of several images shown together in order, so it
     competes for selection as one entry rather than as one per image.
     Captions are optional, and may carry a link. */

  const BIO_PHOTOS = [
    { n: 1,  caption: 'Cannon Beach, Oregon.' },
    { n: 2,  caption: 'Portland, Oregon and her Mount Hood.' },
    { n: 3,  caption: 'The Blue Bridge, Reed College.' },
    { n: 4,  caption: "Daily maintenance in Oregon's High Desert." },
    { n: 5,  caption: '<a href="https://www.portlandsocietyforcalligraphy.org/resources/weathergrams/" target="_blank" rel="noopener">Weathergrams</a> introduced by Lloyd Reynolds.' },
    { n: 6 },
    { n: 7,  caption: 'Spatz was with us for 21 years.' },
    { n: 8,  caption: 'Worthwhile food poisoning.' },
    { n: 9,  caption: 'The reason for the sign and the sign.' },
    { n: 10 },
    { n: 11, caption: 'A fondness for street cats.' },
    { n: 12, caption: 'Barefoot backpacking across Oregon, 2019.' },
    { n: 13, caption: 'Our reunion after 6 years.' },
    { n: 14, caption: 'Mount Tabor, Portland, Oregon.' },
    { n: 15, caption: 'My favorite bird, the bearded vulture.' },
    { n: 16, caption: 'Me and Doc Kane.' },
    { n: 17 },
    { n: 18, caption: 'Polyhedral scribblings.' },
    { n: 19, caption: 'NSMRP 2025.' },
    { n: 20 },
    { n: 21 },
    { n: 22, caption: 'DRP Spring 2026.' },
    { n: 23, caption: 'Luna was feral when we found her.' },
    { n: 24, caption: 'Chatty Tipper.' },
    { n: 25, caption: 'Pulling plastic pockets.' },
    { n: 26, caption: "It's in the ankle." },
    { n: 27 },
    { n: 28, caption: "A 2,500 year-old Etruscan dodecahedron makes an appearance in Disney's Andor." },
    { n: 29, ext: 'png', caption: 'The affine group AGL(1,8) realizes a chiral map.' },
    { frames: [30, 31, 32], alt: 'Luna settling into the grass' },
  ];

  const initBioPhoto = container => {
    const pick = BIO_PHOTOS[Math.floor(Math.random() * BIO_PHOTOS.length)];
    const frames = pick.frames || [pick.n];
    const ext = pick.ext || 'jpeg';

    container.classList.toggle('is-sequence', frames.length > 1);
    container.replaceChildren(...frames.map((n, i) => {
      const img = document.createElement('img');
      img.className = 'bio-photo';
      img.src = `bio-photos/${n}.${ext}`;
      // One alt for the whole sequence; the later frames repeat the subject,
      // so they stay out of the accessibility tree.
      img.alt = i === 0 ? (pick.alt || 'Evan Angelone') : '';
      return img;
    }));

    const caption = document.querySelector('.bio-photo-caption');
    if (caption) { caption.innerHTML = pick.caption || ''; }
  };

  /* ── Start ──────────────────────────────────────────────────────────────── */

  const init = () => {
    initNav();
    document.querySelectorAll('details.collapsible').forEach(initCollapsible);

    const photo = document.querySelector('.bio-photo-frames');
    if (photo) { initBioPhoto(photo); }

    // The LaTeX wordmark. KaTeX is loaded on the resources page alone, and
    // deferred, so it has run by now. .latex is a hook for this call only, with
    // no styling of its own — KaTeX brings its own. Guarded and last, so a CDN
    // hiccup can't take the rest of the page down with it.
    const latex = document.querySelector('.latex');
    if (latex && typeof katex !== 'undefined') {
      try { katex.render('\\LaTeX{}', latex); } catch { /* leave it empty */ }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
