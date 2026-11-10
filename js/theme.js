// Light/dark switch. Loaded without defer so a saved choice applies before
// the first paint. With nothing saved, site.css follows the device. The
// button is created here, so it only exists when JavaScript runs.
(() => {
  'use strict';

  const KEY = 'theme';
  const root = document.documentElement;
  const device = window.matchMedia('(prefers-color-scheme: dark)');

  const stored = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };

  const apply = choice => {
    if (choice === 'light' || choice === 'dark') { root.dataset.theme = choice; }
    else { delete root.dataset.theme; }
  };

  const current = () => root.dataset.theme || (device.matches ? 'dark' : 'light');

  // While this class is on, site.css cross-fades every color.
  let fadeTimer = 0;
  const fade = () => {
    root.classList.add('theme-fade');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.remove('theme-fade'), 500);
  };

  apply(stored());

  const init = () => {
    const buttons = [...document.querySelectorAll('[data-theme-toggle]')].map(slot => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-toggle';
      slot.append(button);
      return button;
    });
    if (!buttons.length) { return; }

    // Label says what a click will do.
    const render = () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      buttons.forEach(button => {
        button.textContent = next === 'dark' ? 'Dark mode' : 'Light mode';
        button.setAttribute('aria-label', `Switch to ${next} mode`);
      });
    };

    buttons.forEach(button => button.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch { /* private browsing: just this page */ }
      fade();
      apply(next);
      render();
    }));

    // Keep following the device until someone picks a mode.
    device.addEventListener('change', () => { if (!stored()) { render(); } });

    render();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
