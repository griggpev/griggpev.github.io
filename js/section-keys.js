// Number keys go to the numbered sections (1 for Research, 2 for Talks, and so on, in the order of the contents), and T goes to the top, scrolling there smoothly up or down. With reduced motion, the page jumps instead.
(() => {
    'use strict';

    const links = [...document.querySelectorAll('.toc ol a, .toc-inline ol a')];
    const seen = new Set();
    const heads = [];
    for (const a of links) {
        const id = decodeURIComponent(a.hash.slice(1));
        const el = id && document.getElementById(id);
        if (el && !seen.has(id)) {
            seen.add(id);
            heads.push(el);
        }
    }
    if (!heads.length) {
        return;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    let frame = 0;
    const stop = () => {
        cancelAnimationFrame(frame);
        frame = 0;
    };

    const scrollToY = y => {
        stop();
        const from = window.scrollY,
            dist = y - from;
        if (reduced.matches || Math.abs(dist) < 2) {
            window.scrollTo(0, y);
            return;
        }
        // Longer trips take a little longer, up to about a second.
        const dur = Math.min(1100, 450 + 0.12 * Math.abs(dist));
        const t0 = performance.now();
        const step = now => {
            const t = Math.min(1, (now - t0) / dur);
            window.scrollTo(0, from + dist * ease(t));
            frame = t < 1 ? requestAnimationFrame(step) : 0;
        };
        frame = requestAnimationFrame(step);
    };

    // Taking hold of the page stops the scroll.
    for (const type of ['wheel', 'touchstart', 'pointerdown']) {
        window.addEventListener(type, stop, {
            passive: true
        });
    }

    window.addEventListener('keydown', e => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) {
            return;
        }
        const t = e.target;
        if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) {
            return;
        }
        if (e.key === 't' || e.key === 'T') {
            e.preventDefault();
            scrollToY(0);
            try {
                history.replaceState(null, '', location.pathname + location.search);
            } catch {
                /* file:// */ }
            return;
        }
        if (!/^[1-9]$/.test(e.key)) {
            return;
        }
        const head = heads[Number(e.key) - 1];
        if (!head) {
            return;
        }
        e.preventDefault();
        const margin = parseFloat(getComputedStyle(head).scrollMarginTop) || 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        scrollToY(Math.max(0, Math.min(max, head.getBoundingClientRect().top + window.scrollY - margin)));
        try {
            history.replaceState(null, '', `#${head.id}`);
        } catch {
            /* file:// in some browsers */ }
    });
})();
