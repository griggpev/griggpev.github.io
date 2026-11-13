// The look shared by every family: sizes, colors, rounded outlines, loops, ropes.

import {
    add,
    clamp,
    cross2,
    det3,
    dot,
    len,
    mod,
    mvec,
    scale,
    smoothstep,
    sub,
    unit
} from './math.js';
import {
    area2,
    newell,
    splitConvex
} from './solids.js';
import {
    inGamut,
    oklch,
    pair,
    path,
    rgb,
    toLinear
} from './dl.js';

// The icon's own proportions: a 512-unit box, circumradius 258, 12-unit strokes.
export const CENTER = 256;
export const SCALE = 258;
export const STROKE = 12;
export const EDGE_ON = 0.12; // |n·z| below this counts as edge-on
export const AXIS_REACH = 1.36;
export const MIRROR_RADIUS = 1.24;
export const VIEWBOX = '-40 -40 592 592';

export const ROUND = 34; // how far a rounded corner reaches along the outline
export const CREASE_W = 6; // a star's creases, its ink

// Screen points (already scaled) for the wireframe.
export const screen = p => [CENTER + SCALE * p[0], CENTER - SCALE * p[1]];

// Whether the polygon poly (screen points) winds around the point p, by the nonzero rule, so the middle of a pentagram counts as inside it.
export const winds = (poly, p) => {
    let w = 0;
    poly.forEach((a, k) => {
        const b = poly[(k + 1) % poly.length],
            side = cross2([b[0] - a[0], b[1] - a[1]], [p[0] - a[0], p[1] - a[1]]);
        if (a[1] <= p[1]) {
            if (b[1] > p[1] && side > 0) {
                w += 1;
            }
        } else if (b[1] <= p[1] && side < 0) {
            w -= 1;
        }
    });
    return w !== 0;
};

// Distance from the point p to the segment from a to b.
export const segDist = (p, a, b) => {
    const dx = b[0] - a[0],
        dy = b[1] - a[1],
        L2 = dx * dx + dy * dy;
    const t = L2 < 1e-9 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2, 0, 1);
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

// The segment from a to b with its ends pulled in by ta and tb, but never past 42% of its length, so short (foreshortened) edges survive.
export const trim = (a, b, ta, tb) => {
    const dx = b[0] - a[0],
        dy = b[1] - a[1],
        L = Math.hypot(dx, dy);
    if (L < 1e-6) {
        return [a, b];
    }
    const sa = Math.min(ta, 0.42 * L) / L,
        sb = Math.min(tb, 0.42 * L) / L;
    return [
        [a[0] + dx * sa, a[1] + dy * sa],
        [b[0] - dx * sb, b[1] - dy * sb]
    ];
};

// Rounded vertices, the way the icon rounds them. The silhouette of a convex solid is the convex hull of its projected vertices; that outline gets its corners rounded, and every other edge at a corner stops where it meets the curve. Interior and hidden junctions stay sharp. A vertex joins or leaves the outline only when its corner is flat, where the rounding vanishes, so nothing jumps.
export const outline = Q => {
    const ids = Q.map((q, i) => i).sort((a, b) => Q[a][0] - Q[b][0] || Q[a][1] - Q[b][1]);
    const turn = (o, a, b) => cross2([Q[a][0] - Q[o][0], Q[a][1] - Q[o][1]], [Q[b][0] - Q[o][0], Q[b][1] - Q[o][1]]);
    const half = list => {
        const h = [];
        for (const i of list) {
            while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], i) <= 1e-9) {
                h.pop();
            }
            h.push(i);
        }
        return h;
    };
    const H = half(ids).slice(0, -1).concat(half([...ids].reverse()).slice(0, -1));
    if (H.length < 3) {
        return {
            corners: [],
            at: new Map(),
            path: path()
        };
    }

    const corners = H.map((A, k) => {
        const a = Q[A],
            p = Q[H[(k + H.length - 1) % H.length]],
            n = Q[H[(k + 1) % H.length]];
        const lp = Math.hypot(p[0] - a[0], p[1] - a[1]),
            ln = Math.hypot(n[0] - a[0], n[1] - a[1]);
        const r = Math.min(ROUND, 0.42 * lp, 0.42 * ln);
        const u1 = [(p[0] - a[0]) / lp, (p[1] - a[1]) / lp],
            u2 = [(n[0] - a[0]) / ln, (n[1] - a[1]) / ln];
        return {
            a,
            r,
            u1,
            u2,
            p1: [a[0] + r * u1[0], a[1] + r * u1[1]],
            p2: [a[0] + r * u2[0], a[1] + r * u2[1]]
        };
    });
    const d = path().M(corners[0].p2[0], corners[0].p2[1]);
    for (const c of [...corners.slice(1), corners[0]]) {
        d.L(c.p1[0], c.p1[1]).Q(c.a[0], c.a[1], c.p2[0], c.p2[1]);
    }
    return {
        corners,
        at: new Map(H.map((A, k) => [A, corners[k]])),
        path: d.Z()
    };
};

// How far an edge leaving the corner c toward the screen point x must be cut back to end on the corner's curve. The curve is a quadratic Bézier a + r[(1 - s)² u1 + s² u2]; solve for where it crosses the edge.
export const cutBack = (c, x) => {
    const dx = x[0] - c.a[0],
        dy = x[1] - c.a[1],
        L = Math.hypot(dx, dy);
    if (L < 1e-6) {
        return 0;
    }
    const u = [dx / L, dy / L];
    const s1 = cross2(c.u1, u),
        s2 = cross2(c.u2, u);
    if (Math.abs(s1) < 1e-6 || Math.abs(s2) < 1e-6) {
        return c.r;
    } // along the outline
    if (s1 * s2 > 0) {
        return 0;
    }
    const s = 1 / (1 + Math.sqrt(-s2 / s1));
    return c.r * Math.hypot((1 - s) ** 2 * c.u1[0] + s * s * c.u2[0], (1 - s) ** 2 * c.u1[1] + s * s * c.u2[1]);
};

// Faces drawn as loops just inside their edges, so every face reads as its own closed path. Each corner of a face gets an inset point, INSET in from both of its edges. A planar face is the loop through its own corners; a Petrie polygon turns through one face corner at each vertex, so its loop runs corner to corner across each edge, crossing its partner at the middle. Every corner belongs to exactly one Petrie polygon: the faces and the Petrie polygons are two ways of wiring up the same points.
export const LOOP_W = STROKE * 0.5;
export const INSET = 0.045;
// The two Petrie polygons along an edge run closer to it than a face's loop does, so the pair reads as one strand each side of the edge.
export const PETRIE_IN = 0.4; // a Petrie loop's inset, as a share of INSET

// The unit offset that moves a corner of a planar polygon (points pts, corner k) inward to distance 1 from both of its sides.
export const cornerOffset = (pts, k) => {
    const m = pts.length,
        v = pts[k];
    const u1 = unit(sub(pts[(k + m - 1) % m], v)),
        u2 = unit(sub(pts[(k + 1) % m], v));
    const half = Math.acos(clamp(dot(u1, u2), -1, 1)) / 2;
    return scale(unit(add(u1, u2)), 1 / Math.sin(half));
};

// Face colors: hues evenly spaced from 35°, each at Open Color's own lightness and chroma for that hue, interpolated between its twelve hues: shade 7 on paper, shade 4 in the dark. [hue, L, C] in OKLCH, from the palette's hex values (yeun.github.io/open-color).
const OC7 = [
    [5.2, 0.588, 0.201],
    [25.8, 0.632, 0.214],
    [44.6, 0.685, 0.195],
    [71.0, 0.770, 0.166],
    [131.5, 0.710, 0.190],
    [146.2, 0.674, 0.177],
    [164.7, 0.643, 0.134],
    [212.2, 0.625, 0.106],
    [251.3, 0.586, 0.159],
    [268.4, 0.557, 0.208],
    [287.8, 0.542, 0.227],
    [319.1, 0.578, 0.219]
];
const OC4 = [
    [21.1, 0.756, 0.146],
    [64.6, 0.803, 0.146],
    [92.2, 0.883, 0.165],
    [128.0, 0.847, 0.188],
    [147.3, 0.802, 0.168],
    [167.9, 0.793, 0.147],
    [207.6, 0.770, 0.119],
    [246.1, 0.718, 0.142],
    [271.0, 0.680, 0.163],
    [292.1, 0.658, 0.191],
    [319.5, 0.725, 0.196],
    [358.8, 0.750, 0.147]
];
const ocAt = (table, h) => {
    const n = table.length;
    let j = table.findIndex(r => r[0] > h);
    if (j < 0) {
        j = 0;
    }
    const a = table[(j + n - 1) % n],
        b = table[j];
    const t = ((h - a[0] + 360) % 360) / ((b[0] - a[0] + 360) % 360 || 360);
    return [a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
};
// (One object per hue, so a color can be told by who it is.)
const hues = new Map();
export const hueColor = hue => {
    const h = mod(hue, 360),
        key = h.toFixed(1);
    if (!hues.has(key)) {
        const q = Number(key),
            ok = ([l, c]) => oklch(Number(l.toFixed(3)), Number(c.toFixed(3)), q);
        hues.set(key, pair(ok(ocAt(OC7, q)), ok(ocAt(OC4, q))));
    }
    return hues.get(key);
};
// Face k of n: its hue, and its color.
export const faceHue = (k, n) => 35 + (360 * k) / n;
export const loopColor = (k, n) => hueColor(faceHue(k, n));
// Infinitely many faces: each its own hue, a golden angle on from the last.
export const goldenColor = k => hueColor(35 + 137.508 * k);

// A loop: nodes { base, off } at base + s·off; on a finite polyhedron, vis[j] names what decides whether segment j is in front. An open loop (a zigzag, cut off by the edge of the window) doesn't close up; a loop may bring its own color.
export const segmentsOf = loop => loop.nodes.length - (loop.open ? 1 : 0);
// How far along a loop a pen has come, as a count of its segments, for a fraction e of the loop's length (with inset s): so a pen goes at a steady pace, not a segment at a time, which would hold it back through a crossing's many short segments and hurry it across a face.
export const alongArc = (loop, e, s) => {
    if (!loop._arc || loop._arc.s !== s || loop._arc.n !== loop.nodes.length) {
        const P = loop.nodes.map(nd => add(nd.base, scale(nd.off, s)));
        const m = segmentsOf(loop),
            c = new Float64Array(m + 1);
        for (let j = 0; j < m; j++) {
            c[j + 1] = c[j] + len(sub(P[(j + 1) % P.length], P[j]));
        }
        loop._arc = {
            s,
            c,
            n: loop.nodes.length
        };
    }
    const c = loop._arc.c,
        m = c.length - 1;
    if (e <= 0) {
        return 0;
    }
    if (e >= 1 || !(c[m] > 0)) {
        return m;
    }
    const goal = e * c[m];
    let lo = 0,
        hi = m;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (c[mid] <= goal) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return lo + (goal - c[lo]) / (c[lo + 1] - c[lo] || 1);
};
const colorOf = (loop, k, n) => loop.color || loopColor(k, n);

// The color each loop is drawn in: its own (on the way to gray by muted, for an operation's old faces), or the ink for plain loops.
export const loopPaint = (loops, {
    plain = false,
    muted = 0
} = {}) => {
    const ink = rgb('ink'),
        gray = rgb('muted');
    return k => {
        const c = plain ? ink : rgb(colorOf(loops[k], k, loops.length));
        return muted > 0 ? [c[0] + muted * (gray[0] - c[0]), c[1] + muted * (gray[1] - c[1]), c[2] + muted * (gray[2] - c[2])] : c;
    };
};

// T is a linear map (a matrix) or any map of points (a function).
const apply = (T, v) => (typeof T === 'function' ? T(v) : mvec(T, v));

// T: the linear map; z: a scale applied first; s: the inset; vis(id) in [0, 1] says how far a stretch is in front; progress[k], if given, is how many segments of loop k are drawn, so a face can be traced out. alpha and weight are numbers, or functions of k: to pick out one loop, or to embolden the one being traced. hidden: how much of a stretch behind the solid shows (a number, or a function of k, so one face alone can be seen through). out: the group drawn into; paint(k): loop k's color (see loopPaint). Returns what was drawn, for drawWeave.
export const drawLoops = (out, loops, T, z, s, vis, progress, alpha, weight = 1, hidden = HIDDEN, paint = loopPaint(loops)) => {
    return loops.map((loop, k) => {
        const a = typeof alpha === 'function' ? alpha(k) : alpha;
        const wt = typeof weight === 'function' ? weight(k) : weight;
        const hd = typeof hidden === 'function' ? hidden(k) : hidden;
        // (A Petrie polygon's strand is laid out on the screen: see strandScreen.)
        const pts = loop.strand && typeof T !== 'function' ? finiteStrand(loop.strand, T, z) : loop.nodes.map(nd => screen(apply(T, scale(add(nd.base, scale(nd.off, s)), z))));
        const m = pts.length,
            op = [],
            wd = [],
            shapes = [],
            color = paint(k);
        for (let j = 0, n = segmentsOf(loop); j < n; j++) {
            const f = progress ? clamp(progress[k] - j, 0, 1) : 1;
            if (f <= 0.001 || a <= 0.001) {
                op[j] = 0;
                wd[j] = 0;
                shapes[j] = null;
                continue;
            }
            const A = pts[j],
                B = pts[(j + 1) % m];
            // Stretches behind are lighter and thinner but unbroken, so a loop can be followed all the way round.
            const v = vis(loop.vis[j]);
            wd[j] = LOOP_W * wt * (0.6 + 0.4 * v);
            op[j] = a * (v + (1 - v) * hd);
            shapes[j] = out.shape({
                path: path().M(A[0], A[1]).L(A[0] + f * (B[0] - A[0]), A[1] + f * (B[1] - A[1])),
                stroke: color,
                width: wd[j],
                alpha: op[j]
            });
        }
        return {
            pts,
            op,
            wd,
            shapes,
            done: progress ? progress[k] : Infinity
        };
    });
};

// Along an edge the two Petrie polygons lie side by side and cross like the strands of a rope: each eases across in a smooth S, along the middle 2J of the edge (J at most ROPE_J, or a quarter of the edge), as ROPE points either side of the middle, where it crosses the edge. Only the zigzag's own turns, at the vertices, are corners.
export const ROPE_J = 0.08;
export const ROPE = 4;
export const ropeJ = edge => Math.min(ROPE_J, 0.25 * edge);
// The crossing on the edge from p (on face F's side) to q (on G's side): nodes at τ = -1 … 1 along it, offset to F's side by cos(π(τ + 1)/2) of the inset, which passes through 0 at the middle, to G's side after.
// (k: the inset's share it is set in by; see STRAND_IN.)
export const ropeNodes = (p, q, nF, nG, J, lift = [0, 0, 0], k = PETRIE_IN) => {
    const mid = scale(add(p, q), 0.5),
        u = unit(sub(q, p)),
        out = [];
    for (let m = -ROPE; m <= ROPE; m++) {
        const t = m / ROPE,
            f = Math.cos((Math.PI * (t + 1)) / 2);
        out.push({
            base: add(add(mid, scale(u, J * t)), lift),
            off: scale(t <= 0 ? nF : nG, k * Math.abs(f))
        });
    }
    return out;
};

/* The two strands along an edge, as seen. Laid in their faces, they would run close or even on top of each other wherever the faces fold sharply or one is seen edge-on; so they are laid out on the screen instead, always STRAND_SEP apart (a gap of STRAND_GAP between them), every family alike. Where the two faces open to opposite sides of the edge, as seen, the pair is centered on it, each strand on its face's side; where both open to one side, both lie that side. Where the faces change places as seen, the strands pass through each other. */
export const STRAND_GAP = 1.6;
const STRAND_SEP = LOOP_W + STRAND_GAP;
// In the plane, where the two faces at an edge always open to either side of it, strands set in by this share of the inset are just that far apart.
export const STRAND_IN = STRAND_SEP / (2 * INSET * SCALE);
const lim1 = x => (x > 1 ? 1 : x < -1 ? -1 : x);
// sF, sG: how far each face opens toward the edge's normal as seen, from -1 to 1 (its inward direction, projected, along the normal, per unit of the view's scale); dz: how much nearer the viewer F's inward direction points than G's, which decides the order where the two faces are seen the same, one over the other (as across a fold seen side on). h: half the strands' spacing. The strand on F's side runs at c + hs along the normal, the one on G's at c - hs: [c, hs].
const strandSides = (sF, sG, h, dz = 0) => {
    const a = lim1(sF / 0.3),
        b = lim1(sG / 0.3);
    // (Over each other, the nearer face's strand lies farther in.)
    return [(h * (a + b)) / 2, h * lim1((sF - sG + 1.5 * dz * lim1(sF + sG)) / 0.2)];
};
// Where a strand turns at the vertex (vx, vy), coming in along the unit direction (ax, ay) at the offset oa from it (along its normal, (-ay, ax)), and going on along (bx, by) at ob: where the two lines meet, but never farther than lim from the vertex, and easing to halfway between them as the turn comes near straight or doubles back (where they would meet far off, or nowhere). Written to out at o.
const strandCorner = (out, o, vx, vy, ax, ay, oa, bx, by, ob, lim) => {
    const px = vx - oa * ay,
        py = vy + oa * ax,
        qx = vx - ob * by,
        qy = vy + ob * bx;
    let x = (px + qx) / 2,
        y = (py + qy) / 2;
    const cr = ax * by - ay * bx,
        k = smoothstep(0.03, 0.25, Math.abs(cr));
    if (k > 0) {
        let t = ((qx - px) * by - (qy - py) * bx) / cr,
            mx = px + t * ax,
            my = py + t * ay;
        const d = Math.hypot(mx - vx, my - vy);
        if (d > lim) {
            mx = vx + ((mx - vx) * lim) / d;
            my = vy + ((my - vy) * lim) / d;
        }
        x += k * (mx - x);
        y += k * (my - y);
    }
    out[o] = x;
    out[o + 1] = y;
};
// A strand on the screen, through nv vertices, Q(i, out, o) writing where the i-th is seen. sideOf(i, nx, ny) gives [sF, sG] for the edge from vertex i, its normal on the screen being (nx, ny): F the face the strand is beside as it sets out, G the face across the edge, and dz (see strandSides). A Petrie polygon (rope) crosses to G's side along the middle of each edge, lam(i) of the edge either side of it; a face stays beside itself. Its nodes as its loop lays them out, into out (flat): closed, a corner at each vertex and each edge's 2·ROPE + 1 crossing points after it (just the corners, for a face; with again a copy of the first at the end, if again); open, the corners at vertices 1 … nv - 2 with the crossings of the edges between them; and, into ctl if given, each crossing's control points as a cubic. The count of nodes.
export const strandScreen = (out, nv, closed, Q, sideOf, lam, h, rope = true, again = false, ctl = null) => {
    const P = new Float64Array(2 * nv),
        ne = closed ? nv : nv - 1;
    for (let i = 0; i < nv; i++) {
        Q(i, P, 2 * i);
    }
    const E = new Float64Array(4 * ne); // per edge: its direction, its offsets setting out and arriving
    for (let i = 0; i < ne; i++) {
        const a = 2 * i,
            b = 2 * ((i + 1) % nv);
        let dx = P[b] - P[a],
            dy = P[b + 1] - P[a + 1];
        const L = Math.hypot(dx, dy);
        if (L > 1e-6) {
            dx /= L;
            dy /= L;
        } else if (i > 0) {
            dx = E[4 * i - 4];
            dy = E[4 * i - 3];
        } else {
            dx = 1;
            dy = 0;
        }
        const [sF, sG, dz] = sideOf(i, -dy, dx), [c, hs] = strandSides(sF, sG, h, dz);
        E[4 * i] = dx;
        E[4 * i + 1] = dy;
        E[4 * i + 2] = c + hs;
        E[4 * i + 3] = rope ? c - hs : c + hs;
    }
    const lim = 4 * h,
        i0 = closed ? 0 : 1,
        i1 = closed ? nv - 1 : nv - 2;
    let o = 0,
        oc = 0;
    for (let i = i0; i <= i1; i++) {
        const pi = closed ? (i + nv - 1) % nv : i - 1,
            vx = P[2 * i],
            vy = P[2 * i + 1];
        strandCorner(out, o, vx, vy, E[4 * pi], E[4 * pi + 1], E[4 * pi + 3], E[4 * i], E[4 * i + 1], E[4 * i + 2], lim);
        o += 2;
        if (!rope || (!closed && i === i1)) {
            continue;
        }
        const b = 2 * ((i + 1) % nv),
            dx = E[4 * i],
            dy = E[4 * i + 1],
            c = (E[4 * i + 2] + E[4 * i + 3]) / 2,
            hs = (E[4 * i + 2] - E[4 * i + 3]) / 2,
            lj = lam(i);
        for (let m = -ROPE; m <= ROPE; m++) {
            const t = m / ROPE,
                f = Math.cos((Math.PI * (t + 1)) / 2),
                u = 0.5 + lj * t,
                off = c + hs * f;
            out[o] = vx + u * (P[b] - vx) - off * dy;
            out[o + 1] = vy + u * (P[b + 1] - vy) + off * dx;
            o += 2;
        }
        // (Its crossing as one cubic: these its inner control points, a third of the way in from either end, at the offsets it sets out and arrives at.)
        if (ctl) {
            for (const [t, off] of [
                    [-1 / 3, c + hs],
                    [1 / 3, c - hs]
                ]) {
                const u = 0.5 + lj * t;
                ctl[oc] = vx + u * (P[b] - vx) - off * dy;
                ctl[oc + 1] = vy + u * (P[b + 1] - vy) + off * dx;
                oc += 2;
            }
        }
    }
    if (again) {
        out[o] = out[0];
        out[o + 1] = out[1];
        o += 2;
    }
    return o / 2;
};
// A finite Petrial's strand (loop.strand: its polygon's vertices V, the inward directions of the faces either side of each edge, and the share of an edge each half of a crossing takes), as seen under the linear map T and the scale g: its screen points, one per node.
export const finiteStrand = (st, T, g) => {
    const n = st.V.length,
        out = new Float64Array(2 * n * (2 * ROPE + 2));
    const k = SCALE * g * (Math.cbrt(Math.abs(det3(T))) || 1),
        Tg = T.map(x => x * g);
    const Q = (i, o2, o) => {
        const p = mvec(Tg, st.V[i]);
        o2[o] = CENTER + SCALE * p[0];
        o2[o + 1] = CENTER - SCALE * p[1];
    };
    const side = (i, nx, ny) => {
        const p = mvec(Tg, st.sides[i][0]),
            q = mvec(Tg, st.sides[i][1]),
            m = SCALE / k;
        return [m * (nx * p[0] - ny * p[1]), m * (nx * q[0] - ny * q[1]), m * (p[2] - q[2])];
    };
    strandScreen(out, n, true, Q, side, () => st.lam, STRAND_SEP / 2);
    const pts = new Array(out.length / 2);
    for (let i = 0; i < pts.length; i++) {
        pts[i] = [out[2 * i], out[2 * i + 1]];
    }
    return pts;
};
// The weave. At each crossing the strand that turns left at the far end of the edge goes over (seen from behind, mirrored, the other one). Every strand's turns alternate, so it goes over and under in turn, like the strands of a rope or a basket's weave, and the weave looks the same after every symmetry. Nothing is cut: the stretch of the strand on top is drawn again above the other, over a band of paper a little wider than itself (CASING each side, out to CASE_M points either side of the middle), so the strand beneath runs on unbroken and goes under it.
export const CASING = 1.7;
export const CASE_M = 3;
export const weaveOf = (cross, n, mirrored) => {
    const hide = Array.from({
            length: n
        }, () => ({
            end: [],
            start: []
        })),
        over = Array.from({
            length: n
        }, () => []),
        cased = [];
    cross.forEach(([A, B]) => {
        const up = A.left !== mirrored ? A : B,
            lo = up === A ? B : A;
        for (let m = -ROPE; m < ROPE; m++) {
            hide[up.loop].end[up.j + m] = 0;
        }
        over[up.loop].push(up.j);
        cased.push([up.loop, up.j, lo.loop]);
    });
    return {
        hide,
        over,
        cased
    };
};

// After drawLoops (into the same group g), on a finite Petrial: the weave, at the crossings in front (behind, the strands are faint, and simply cross). The bands of paper go over all the loops, and the stretches on top over them.
export const drawWeave = (g, loops, cross, drawn, mirrored, paint = loopPaint(loops)) => {
    const cases = [],
        copies = [],
        paper = rgb('paper');
    cross.forEach(([A, B]) => {
        const up = A.left !== mirrored ? A : B,
            lo = up === A ? B : A,
            dUp = drawn[up.loop],
            dLo = drawn[lo.loop];
        if (!dUp || !dLo || dUp.done < up.j + ROPE || dLo.done < lo.j + ROPE || dUp.op[up.j] < 0.6 || dLo.op[lo.j] < 0.02) {
            return;
        }
        const n = dUp.pts.length,
            P = m => dUp.pts[(up.j + m + n) % n];
        const line = (m0, m1) => {
            const d = path().M(P(m0)[0], P(m0)[1]);
            for (let m = m0 + 1; m <= m1; m++) {
                d.L(P(m)[0], P(m)[1]);
            }
            return d;
        };
        cases.push({
            path: line(-CASE_M, CASE_M),
            stroke: paper,
            width: dUp.wd[up.j] + 2 * CASING,
            cap: 'butt'
        });
        copies.push({
            path: line(-ROPE, ROPE),
            stroke: paint(up.loop),
            width: dUp.wd[up.j],
            alpha: dUp.op[up.j]
        });
        for (let m = -ROPE; m < ROPE; m++) {
            const sh = dUp.shapes[(up.j + m + n) % n];
            if (sh) {
                sh.alpha = 0;
            }
        }
    });
    cases.forEach(c => g.shape(c));
    copies.forEach(c => g.shape(c));
};

// How much of a stretch behind the solid shows, normally.
export const HIDDEN = 0.28;

// Shading: a light up and to the left, in front, fixed in the view. A face turned from it is darker (on paper; lighter, in the dark).
export const LIGHT = unit([-0.45, 0.6, 0.66]);
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
export const darkTheme = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : darkMQ.matches;
};
// A face's fill: its own hue, opaque, lighter the more it faces the light; full color at rest, and pale (0 to 1) toward paper, for a face picked out against, or while an operation traces new faces over the old.
export const shadedColor = (hue, lit, pale = 0) => {
    const h = mod(hue, 360),
        s = clamp(lit, 0, 1),
        w = clamp(pale, 0, 1);
    const c7 = ocAt(OC7, h)[1],
        c4 = ocAt(OC4, h)[1];
    const mix = (a, b) => a + (b - a) * w;
    // (On paper, soft; in the dark, at full strength.)
    return pair(okCached(mix(0.73 + 0.17 * s, 0.94), mix(0.5 * c7, 0.012), h), okCached(mix(0.5 + 0.16 * s, 0.27), mix(0.95 * c4, 0.01), h));
};
// oklch() at the precision CSS was given it, remembered.
const okSeen = new Map();
const okCached = (L, C, h) => {
    const key = `${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)}`;
    let v = okSeen.get(key);
    if (!v) {
        if (okSeen.size > 20000) {
            okSeen.clear();
        }
        v = oklch(Number(L.toFixed(3)), Number(C.toFixed(3)), Number(h.toFixed(1)));
        okSeen.set(key, v);
    }
    return v;
};

// In the dark, a planar face's edges are not drawn in ink (which there is light, and rings each face in white) but as a band just inside the face, in its own color, deeper and more saturated: two faces meeting at an edge share its width, each in its color. This is that color.
// (As saturated as the screen shows that hue at a little below the face's lightness: the most chroma (OKLCH) still inside sRGB.)
const gamutC = new Map();
const maxChroma = (L, h) => {
    const key = `${L.toFixed(2)},${Math.round(h)}`;
    if (gamutC.has(key)) {
        return gamutC.get(key);
    }
    const ca = Math.cos((h * Math.PI) / 180),
        sa = Math.sin((h * Math.PI) / 180);
    const inside = C => inGamut(toLinear(L, C * ca, C * sa));
    let lo = 0,
        hi = 0.4;
    for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (inside(mid)) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    gamutC.set(key, lo);
    return lo;
};
export const shadedEdge = (hue, lit, pale = 0) => {
    const h = mod(hue, 360),
        s = clamp(lit, 0, 1),
        w = clamp(pale, 0, 1),
        mix = (a, b) => a + (b - a) * w;
    const L = 0.45 + 0.16 * s,
        C = 0.97 * maxChroma(L, h);
    return okCached(mix(L, 0.3), mix(C, 0.012), h);
};
// The band of width w just inside a convex polygon q (screen points), along the sides listed (by their first corner; all of them if none are), added to the path d: each side's strip, the polygon cut by a line w inside it.
export const innerBands = (q, w, sides = null, d = path()) => {
    const n = q.length,
        sgn = area2(q) < 0 ? -1 : 1;
    for (const i of sides || q.keys()) {
        const a = q[i],
            b = q[(i + 1) % n],
            dx = b[0] - a[0],
            dy = b[1] - a[1],
            L = Math.hypot(dx, dy);
        if (L < 1e-6) {
            continue;
        }
        const nx = (-dy / L) * sgn,
            ny = (dx / L) * sgn;
        const [band] = splitConvex(q, [nx, ny], nx * a[0] + ny * a[1] + w);
        if (band.length >= 3) {
            d.poly(band, true);
        }
    }
    return d;
};

// How much each face of the convex hull faces the viewer under T, easing from 0 to 1 across edge-on (over ±w).
export const frontOf = (S, P, T, w = EDGE_ON) => {
    const flip = det3(T) < 0 ? -1 : 1;
    return S.FACES.map(f => {
        const n = newell(f.ids.map(i => P[i])),
            l = len(n);
        return l < 1e-9 ? 0.5 : smoothstep(-w, w, (flip * f.orient * n[2]) / l);
    });
};
