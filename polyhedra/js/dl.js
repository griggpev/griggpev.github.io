// What a frame draws, as a display list: groups and shapes in paint order, in figure units (the view box, y down). The drawing code fills one in; a backend (WebGL, or SVG where WebGL is missing) paints it. Colors are plain sRGB triples, worked out for the theme as it is this frame.

/* ---------- Colors ---------- */

// OKLCH to sRGB (gamma-encoded, 0 to 1), with the browsers' gamut mapping: a color outside sRGB keeps its lightness and hue and loses chroma.
export const toLinear = (L, a, b) => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};
const encode = x => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
export const inGamut = rgb => rgb.every(x => x >= -1e-4 && x <= 1 + 1e-4);
const chromaCap = new Map();
// The most chroma at lightness L and hue h still inside sRGB.
const maxChroma = (L, h) => {
    const key = `${L.toFixed(3)},${h.toFixed(1)}`;
    if (chromaCap.has(key)) {
        return chromaCap.get(key);
    }
    const ca = Math.cos((h * Math.PI) / 180),
        sa = Math.sin((h * Math.PI) / 180);
    let lo = 0,
        hi = 0.4;
    for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(toLinear(L, mid * ca, mid * sa))) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    chromaCap.set(key, lo);
    return lo;
};
export const oklch = (L, C, h) => {
    const hr = (h * Math.PI) / 180;
    let lin = toLinear(L, C * Math.cos(hr), C * Math.sin(hr));
    if (!inGamut(lin)) {
        const c = maxChroma(L, h);
        lin = toLinear(L, c * Math.cos(hr), c * Math.sin(hr));
    }
    return lin.map(x => Math.min(1, Math.max(0, encode(Math.min(1, Math.max(0, x))))));
};

// A color in both themes, { l, d }: on paper and in the dark.
export const pair = (l, d) => ({
    l,
    d
});

// The page's own colors, read from its CSS variables in each theme as it is seen (see readPalette), and how far the page has gone into the dark: mix runs from 0 (paper) to 1 (dark) as the theme fades.
export const theme = {
    mix: 0,
    dark: false,
    pal: {
        light: null,
        dark: null
    }
};
const PAGE = ['ink', 'paper', 'accent', 'muted'];
const parseColor = s => {
    const m = s.match(/rgba?\(([^)]+)\)/) || s.match(/color\(srgb ([^)]+)\)/);
    if (!m) {
        return [0, 0, 0];
    }
    const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return s.startsWith('color(') ? v.slice(0, 3) : v.slice(0, 3).map(x => x / 255);
};
let probe = null;
export const readPalette = dark => {
    if (!probe) {
        probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
        // (Not fading with the page, or it would be read mid-fade.)
        probe.style.setProperty('transition', 'none', 'important');
        document.body.append(probe);
    }
    const out = {};
    for (const k of PAGE) {
        probe.style.color = `var(--${k})`;
        out[k] = parseColor(getComputedStyle(probe).color);
    }
    theme.pal[dark ? 'dark' : 'light'] = out;
    if (!theme.pal[dark ? 'light' : 'dark']) {
        theme.pal[dark ? 'light' : 'dark'] = out;
    }
};
const lerp3 = (a, b, t) => (t <= 0 ? a : t >= 1 ? b : [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
// A color as it shows now: a page color by name ('ink', ...), a pair, or already a triple.
export const rgb = c => {
    if (typeof c === 'string') {
        return lerp3(theme.pal.light[c], theme.pal.dark[c], theme.mix);
    }
    if (c && c.l) {
        return lerp3(c.l, c.d, theme.mix);
    }
    return c;
};
// a toward b by t (each as for rgb).
export const mixRgb = (a, b, t) => lerp3(rgb(a), rgb(b), t);

/* ---------- Paths ---------- */

// Path data as numbers: M x y, L x y, Q cx cy x y, C c1x c1y c2x c2y x y, Z, each led by its code.
export const OP_M = 0,
    OP_L = 1,
    OP_Q = 2,
    OP_C = 3,
    OP_Z = 4;
class Path {
    constructor() {
        this.a = [];
    }
    M(x, y) {
        this.a.push(OP_M, x, y);
        return this;
    }
    L(x, y) {
        this.a.push(OP_L, x, y);
        return this;
    }
    Q(cx, cy, x, y) {
        this.a.push(OP_Q, cx, cy, x, y);
        return this;
    }
    Z() {
        this.a.push(OP_Z);
        return this;
    }
    // Points [x, y], joined; closed if close.
    poly(ps, close = false) {
        ps.forEach((p, k) => this.a.push(k ? OP_L : OP_M, p[0], p[1]));
        if (close && ps.length) {
            this.a.push(OP_Z);
        }
        return this;
    }
    seg(a, b) {
        this.a.push(OP_M, a[0], a[1], OP_L, b[0], b[1]);
        return this;
    }
    get empty() {
        return this.a.length === 0;
    }
}
export const path = () => new Path();

/* ---------- The list ---------- */

// A group: its children in order, painted together at alpha, cut to clip. Shapes: { path, fill, stroke, width, alpha, fillAlpha, strokeAlpha, cap, convex, clip, seam }. alpha is the shape's opacity as one thing (its fill and stroke together); a stroke is painted once, so where it crosses itself it does not double. cap: 'butt', else round. convex: a fill that needs no winding (see gl.js). seam: a hairline of the fill's own color round it, for a backend whose fills leave cracks between neighbors. Clips: { kind: 'path', path } (with holes, a path: everything but them), { kind: 'rect', x, y, w, h, r }, or { slab: { n, o, w } }, a band. The list itself may have a scale: all of it, larger or smaller about the middle of the view box.
class Group {
    constructor(opts = {}) {
        this.kids = [];
        this.alpha = 1;
        this.clip = null;
        Object.assign(this, opts);
    }
    group(opts) {
        const g = new Group(opts);
        this.kids.push(g);
        return g;
    }
    shape(s) {
        if (s.path && !s.path.empty) {
            this.kids.push(s);
        }
        return s;
    }
    dot(x, y, r, color, alpha = 1) {
        if (r > 0 && alpha > 0.001) {
            this.kids.push({
                dot: true,
                x,
                y,
                r,
                fill: color,
                alpha
            });
        }
    }
}
export const list = () => new Group();
// A clip to a path.
export const clipPath = p => ({
    kind: 'path',
    path: p
});

/* ---------- SVG backend ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const f2 = x => (Math.round(x * 100) / 100).toString();
const pathData = p => {
    const a = p.a;
    let d = '';
    for (let i = 0; i < a.length;) {
        switch (a[i]) {
            case OP_M:
                d += `M${f2(a[i + 1])},${f2(a[i + 2])}`;
                i += 3;
                break;
            case OP_L:
                d += `L${f2(a[i + 1])},${f2(a[i + 2])}`;
                i += 3;
                break;
            case OP_Q:
                d += `Q${f2(a[i + 1])},${f2(a[i + 2])} ${f2(a[i + 3])},${f2(a[i + 4])}`;
                i += 5;
                break;
            case OP_C:
                d += `C${f2(a[i + 1])},${f2(a[i + 2])} ${f2(a[i + 3])},${f2(a[i + 4])} ${f2(a[i + 5])},${f2(a[i + 6])}`;
                i += 7;
                break;
            default:
                d += 'Z';
                i += 1;
        }
    }
    return d;
};
const css = c => (c ? `rgb(${(c[0] * 255).toFixed(1)} ${(c[1] * 255).toFixed(1)} ${(c[2] * 255).toFixed(1)})` : 'none');
let svgIds = 0;

// Paints lists into an <svg>, reusing its elements frame to frame.
export const svgBackend = svg => {
    const prefix = `tt-c${++svgIds}`,
        viewBox = svg.getAttribute('viewBox');
    let defs = null,
        clipEls = [];
    const set = (el, k, v) => {
        if (el[`_${k}`] !== v) {
            el[`_${k}`] = v;
            if (v === null) {
                el.removeAttribute(k);
            } else {
                el.setAttribute(k, v);
            }
        }
    };
    const sync = (parent, kids, clipId, start) => {
        let i = start;
        for (const k of kids) {
            const tag = k.kids ? 'g' : k.dot ? 'circle' : 'path';
            let el = parent.childNodes[i];
            if (!el || el.localName !== tag) {
                const fresh = document.createElementNS(SVG_NS, tag);
                if (el) {
                    parent.replaceChild(fresh, el);
                } else {
                    parent.append(fresh);
                }
                el = fresh;
            }
            i += 1;
            set(el, 'clip-path', k.clip ? `url(#${clipId(k.clip)})` : null);
            if (k.kids) {
                set(el, 'opacity', k.alpha < 1 ? k.alpha.toFixed(3) : null);
                sync(el, k.kids, clipId, 0);
            } else if (k.dot) {
                set(el, 'cx', f2(k.x));
                set(el, 'cy', f2(k.y));
                set(el, 'r', f2(k.r));
                set(el, 'fill', css(k.fill));
                set(el, 'opacity', k.alpha < 1 ? k.alpha.toFixed(3) : null);
            } else {
                set(el, 'd', pathData(k.path));
                set(el, 'fill', css(k.fill));
                set(el, 'fill-opacity', k.fillAlpha !== undefined && k.fillAlpha < 1 ? k.fillAlpha.toFixed(3) : null);
                const stroke = k.stroke || (k.seam && k.fill) || null;
                set(el, 'stroke', stroke ? css(stroke) : null);
                set(el, 'stroke-width', stroke ? f2(k.stroke ? k.width : k.seam) : null);
                set(el, 'stroke-linecap', stroke && k.stroke && k.cap !== 'butt' ? 'round' : null);
                set(el, 'stroke-linejoin', stroke ? 'round' : null);
                set(el, 'stroke-opacity', k.strokeAlpha !== undefined && k.strokeAlpha < 1 ? k.strokeAlpha.toFixed(3) : null);
                set(el, 'opacity', k.alpha !== undefined && k.alpha < 1 ? k.alpha.toFixed(3) : null);
            }
        }
        while (parent.childNodes.length > i) {
            parent.lastChild.remove();
        }
    };
    return {
        kind: 'svg',
        el: svg,
        render(root) {
            if (!defs || defs.parentNode !== svg) {
                svg.replaceChildren();
                defs = document.createElementNS(SVG_NS, 'defs');
                svg.append(defs);
                clipEls = [];
            }
            // (root.scale: see Group.)
            const k = root.scale || 1,
                half = 296 / k;
            set(svg, 'viewBox', k === 1 ? viewBox : `${f2(256 - half)} ${f2(256 - half)} ${f2(2 * half)} ${f2(2 * half)}`);
            // Each clip used this frame gets a <clipPath>, in order.
            const ids = new Map();
            let n = 0;
            const clipId = c => {
                if (ids.has(c)) {
                    return ids.get(c);
                }
                const k = n++,
                    id = `${prefix}-${k}`,
                    tag = c.kind === 'rect' ? 'rect' : 'path';
                let cp = clipEls[k];
                if (!cp) {
                    cp = document.createElementNS(SVG_NS, 'clipPath');
                    cp.id = id;
                    defs.append(cp);
                    clipEls[k] = cp;
                }
                let s = cp.firstChild;
                if (!s || s.localName !== tag) {
                    s = document.createElementNS(SVG_NS, tag);
                    cp.replaceChildren(s);
                }
                if (tag === 'rect') {
                    ['x', 'y', 'w', 'h', 'r'].forEach(a => set(s, {
                        w: 'width',
                        h: 'height',
                        r: 'rx'
                    } [a] || a, f2(c[a])));
                } else {
                    set(s, 'd', pathData(c.path) || 'M0,0');
                }
                ids.set(c, id);
                return id;
            };
            sync(svg, root.kids, clipId, 1);
        },
        // A still copy of what is drawn now, with clips of its own (the live drawing goes on using its ids for what it draws next).
        snapshot() {
            const copy = svg.cloneNode(true),
                own = `tt-c${++svgIds}`;
            copy.querySelectorAll('clipPath').forEach(cp => {
                cp.id = cp.id.replace(prefix, own);
            });
            copy.querySelectorAll('[clip-path]').forEach(el => el.setAttribute('clip-path', el.getAttribute('clip-path').replace(prefix, own)));
            return copy;
        },
    };
};
