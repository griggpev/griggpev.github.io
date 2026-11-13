// Drawing the planar polyhedra.
// A planar polyhedron is seen through a window, a rounded square fixed on the page, with the tiling sliding behind it. Edges are cut off at the window's border, geometrically, so that the cut ends are as round as every other end.

import {
    add,
    clamp,
    dot,
    scale,
    smoothstep,
    sub
} from './math.js';
import {
    applyAffine,
    flatten,
    TILE_HUES,
    unapply
} from './planar.js';
import {
    CASE_M,
    CASING,
    CENTER,
    darkTheme,
    faceHue,
    innerBands,
    LIGHT,
    LOOP_W,
    loopPaint,
    ROPE,
    SCALE,
    screen,
    shadedColor,
    shadedEdge,
    STROKE,
    weaveOf,
} from './look.js';
import {
    clipPath,
    path,
    rgb
} from './dl.js';

export const T_STROKE = 7.5; // a tiling's ink: thinner, for its many edges
export const WIN_H = 236; // the window's half-width, SVG units
export const WIN_R = 44; // its corners' radius
export const WIN_DIAG = (WIN_H - WIN_R) * Math.SQRT2 + WIN_R; // center to its farthest point

// The part of the segment a–b inside the window shrunk by inset (so that a round cap of that radius ends on the border), and inside the slab |n·(q - o)| ≤ w if one is given; or null.
export const clipToWindow = (a, b, inset = 0, slab = null) => {
    const dx = b[0] - a[0],
        dy = b[1] - a[1];
    let t0 = 0,
        t1 = 1;
    const keep = (p, q) => { // keep the t with p·t ≤ q
        if (Math.abs(p) < 1e-12) {
            return q >= 0;
        }
        const r = q / p;
        if (p < 0) {
            if (r > t1) {
                return false;
            }
            t0 = Math.max(t0, r);
        } else {
            if (r < t0) {
                return false;
            }
            t1 = Math.min(t1, r);
        }
        return true;
    };
    const h = WIN_H - inset,
        lo = CENTER - h,
        hi = CENTER + h;
    if (!keep(-dx, a[0] - lo) || !keep(dx, hi - a[0]) || !keep(-dy, a[1] - lo) || !keep(dy, hi - a[1])) {
        return null;
    }
    if (slab) {
        const s0 = slab.n[0] * (a[0] - slab.o[0]) + slab.n[1] * (a[1] - slab.o[1]),
            ds = slab.n[0] * dx + slab.n[1] * dy;
        if (!keep(-ds, s0 + slab.w) || !keep(ds, slab.w - s0)) {
            return null;
        }
    }
    // An end beyond a corner's arc comes back to where the segment meets it.
    const r = Math.max(1, WIN_R - inset),
        at = t => [a[0] + t * dx, a[1] + t * dy];
    for (const end of [0, 1]) {
        const p = at(end ? t1 : t0);
        const ox = Math.abs(p[0] - CENTER) - (h - r),
            oy = Math.abs(p[1] - CENTER) - (h - r);
        if (ox <= 0 || oy <= 0 || ox * ox + oy * oy <= r * r) {
            continue;
        }
        const cx = CENTER + Math.sign(p[0] - CENTER) * (h - r),
            cy = CENTER + Math.sign(p[1] - CENTER) * (h - r);
        const fx = a[0] - cx,
            fy = a[1] - cy,
            A = dx * dx + dy * dy,
            B = 2 * (fx * dx + fy * dy),
            C = fx * fx + fy * fy - r * r;
        const disc = B * B - 4 * A * C;
        if (disc < 0 || A < 1e-12) {
            return null;
        }
        const r1 = (-B - Math.sqrt(disc)) / (2 * A),
            r2 = (-B + Math.sqrt(disc)) / (2 * A);
        if (end) {
            if (r1 >= t1) {
                return null;
            }
            t1 = Math.min(t1, r2);
        } else {
            if (r2 <= t0) {
                return null;
            }
            t0 = Math.max(t0, r1);
        }
        if (t0 >= t1) {
            return null;
        }
    }
    return [at(t0), at(t1)];
};
export const insideWindow = (q, margin = 0) => clipToWindow(q, q, margin) !== null;
// What clipping leaves of a segment a–b (as c) is only a dot: not drawn.
const sliver = (a, b, c) => (c[0][0] !== a[0] || c[0][1] !== a[1] || c[1][0] !== b[0] || c[1][1] !== b[1]) &&
    Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) < 2;

// The part of a–b in the window, as a path, or null.
export const clipLine = (a, b) => {
    const c = clipToWindow(a, b);
    return c ? path().seg(c[0], c[1]) : null;
};
// An arrow from x to y (screen points), for a slide.
export const arrowPath = (x, y) => {
    const ang = Math.atan2(y[1] - x[1], y[0] - x[0]),
        head = s => [y[0] - 20 * Math.cos(ang + 0.5 * s), y[1] - 20 * Math.sin(ang + 0.5 * s)];
    return path().seg(x, y).poly([head(1), y, head(-1)]);
};

// The window, as a clip.
export const WINDOW = {
    kind: 'rect',
    x: CENTER - WIN_H,
    y: CENTER - WIN_H,
    w: 2 * WIN_H,
    h: 2 * WIN_H,
    r: WIN_R
};

// How a planar polyhedron stands: M carries the tiling into the world (tiling units), and the window shows the world around pan, at the zoom. pre is the middle of the window, on the tiling. A2 is the whole map from the tiling's plane to the screen, as [a, b, c, d, e, f]: (x, y) ↦ (ax + by + e, cx + dy + f). flipped: the tiling shows its other side (which decides the over and under).
export const planarPose = (M, zoom, pan) => {
    const view = x => scale(sub(x, pan), zoom),
        k = SCALE * zoom,
        L = M.L;
    return {
        M,
        zoom,
        pan,
        world: view,
        map: v => view(applyAffine(M, v)),
        pre: unapply(M, pan),
        A2: [k * L[0], k * L[1], -k * L[3], -k * L[4], CENTER + k * (M.t[0] - pan[0]), CENTER - k * (M.t[1] - pan[1])],
        flipped: L[8] < 0,
    };
};

// A loop's nodes on the screen, inset by s.
export const screenNodes = (loop, s, A) => {
    const B = loop.fb,
        O = loop.fo,
        n = B.length,
        X = new Float64Array(n);
    for (let i = 0; i < n; i += 2) {
        const x = B[i] + s * O[i],
            y = B[i + 1] + s * O[i + 1];
        X[i] = A[0] * x + A[1] * y + A[4];
        X[i + 1] = A[2] * x + A[3] * y + A[5];
    }
    return X;
};

// A loop as one path: its segments, each cut to the window (and the slab), up to progress segments, and with cuts (where it passes under another): cuts.end[j] or cuts.start[j] shortens segment j.
const tracePath = (loop, s, A, inset, slab, progress = Infinity, cuts = null, X = screenNodes(loop, s, A)) => {
    const n = X.length / 2,
        segs = Math.min(loop.open ? n - 1 : n, progress);
    const d = path();
    let lx = NaN,
        ly = NaN;
    for (let j = 0; j < segs; j++) {
        let t0 = 0,
            t1 = Math.min(1, segs - j);
        if (cuts) {
            if (cuts.end[j] !== undefined) {
                t1 = Math.min(t1, cuts.end[j]);
            }
            if (cuts.start[j] !== undefined) {
                t0 = cuts.start[j];
            }
        }
        if (t1 <= t0) {
            lx = NaN;
            continue;
        }
        const i = 2 * j,
            k = 2 * ((j + 1) % n),
            dx = X[k] - X[i],
            dy = X[k + 1] - X[i + 1];
        const a = [X[i] + t0 * dx, X[i + 1] + t0 * dy],
            b = [X[i] + t1 * dx, X[i + 1] + t1 * dy],
            c = clipToWindow(a, b, inset, slab);
        if (!c || sliver(a, b, c)) {
            lx = NaN;
            continue;
        }
        if (Math.abs(c[0][0] - lx) < 0.05 && Math.abs(c[0][1] - ly) < 0.05) {
            d.L(c[1][0], c[1][1]);
        } else {
            d.seg(c[0], c[1]);
        }
        lx = c[1][0];
        ly = c[1][1];
    }
    return d;
};

// Planar loops, one path each, into the group g; paint(k) is loop k's color (see loopPaint).
export const drawPaths = (g, loops, s, A, {
    progress = null,
    alpha = 1,
    weight = 1,
    slab = null,
    cuts = null,
    X = null,
    paint = loopPaint(loops)
} = {}) => {
    loops.forEach((loop, k) => {
        const a = typeof alpha === 'function' ? alpha(k) : alpha,
            w = typeof weight === 'function' ? weight(k) : weight;
        const p = progress ? progress[k] : Infinity;
        if (a <= 0.002 || p <= 0.001) {
            return;
        }
        const lw = LOOP_W * w;
        g.shape({
            path: tracePath(loop, s, A, lw / 2, slab, p, cuts ? cuts[k] : null, X ? X[k] : undefined),
            stroke: paint(k),
            width: lw,
            alpha: a
        });
    });
};

// The stretch of a loop (its screen nodes X) from node j + m0 to j + m1, cut to the window (and the slab), added to the path d.
const stretchPath = (X, j, m0, m1, inset, slab, d = path()) => {
    const n = X.length / 2;
    let lx = NaN,
        ly = NaN;
    for (let m = m0; m < m1; m++) {
        const i = 2 * ((j + m + n) % n),
            k = 2 * ((j + m + 1 + n) % n);
        const a = [X[i], X[i + 1]],
            b = [X[k], X[k + 1]],
            c = clipToWindow(a, b, inset, slab);
        if (!c || sliver(a, b, c)) {
            lx = NaN;
            continue;
        }
        if (Math.abs(c[0][0] - lx) < 0.05 && Math.abs(c[0][1] - ly) < 0.05) {
            d.L(c[1][0], c[1][1]);
        } else {
            d.seg(c[0], c[1]);
        }
        lx = c[1][0];
        ly = c[1][1];
    }
    return d;
};

// A loop cut down to the stretch of it in the window (as the window is now), for an operation to trace; or null if none of it is.
export const trimToWindow = (loop, s, A) => {
    const X = screenNodes(loop, s, A),
        n = X.length / 2,
        inside = [];
    for (let i = 0; i < n; i++) {
        if (insideWindow([X[2 * i], X[2 * i + 1]], -24)) {
            inside.push(i);
        }
    }
    if (!inside.length) {
        return null;
    }
    if (!loop.open) {
        return loop;
    }
    const a = Math.max(0, inside[0] - 1),
        b = Math.min(n - 1, inside[inside.length - 1] + 1);
    return flatten({
        ...loop,
        nodes: loop.nodes.slice(a, b + 1)
    });
};

export const buildPlanarScene = (S, form, patch) => ({
    form,
    planar: true,
    patch
});

// While a reflection turns the tiling over, it squashes toward the mirror line and out again; only a band of it, cut straight along the mirror, goes through, so no edge of the patch shows. fx.band: { p, u } the mirror (world), D the band's half-width (tiling units), c the squash.
const bandSlab = (pose, band) => {
    if (!band) {
        return null;
    }
    const o = screen(pose.world(band.p)),
        n = [-band.u[1], -band.u[0]];
    return {
        o,
        n,
        w: Math.abs(band.c) * band.D * pose.zoom * SCALE
    };
};

// The tiling's ink (or, on a Petrial, its zigzags, woven), the flag, what the pointer is on, and a move's overlays: the center of a turn (a pin), the line of a flip, and the arrow of a slide.
export const drawPlanar = (dl, scene, S, pose, fx) => {
    // (ik: the ink's scale, as a blend's window opens or closes: see inkScale.)
    const patch = scene.patch,
        petrial = scene.form === 'petrial',
        slab = bandSlab(pose, fx.band),
        ik = pose.ink || 1;
    const Q = fx.aim ? patch.V.map(v => screen(pose.map(v))) : null;
    const inkC = rgb('ink'),
        accent = rgb('accent'),
        paper = rgb('paper');
    // In paint order: the faces' fills (cut to the band while a flip turns the tiling over), the face under the pointer, the flag, a halo on what is under the pointer, all in the window; the ink; the zigzags; the flag off the ink; a move's overlays.
    const gShade = dl.group({
            clip: WINDOW
        }),
        gFaces = dl.group({
            clip: WINDOW
        }),
        gFlag = dl.group({
            clip: WINDOW
        });
    const gAimMarks = dl.group({
            clip: WINDOW
        }),
        gEdges = dl.group(),
        gLanes = dl.group(),
        gCorner = dl.group({
            clip: WINDOW
        }),
        gOver = dl.group();
    const shadeG = gShade.group();

    // Squashed nearly flat, mid-flip, a tiling would be a smear of ink.
    const flat = fx.band ? 0.25 + 0.75 * smoothstep(0.04, 0.45, Math.abs(fx.band.c)) : 1;
    const sk = fx.skeleton === undefined ? (petrial ? 1 : 0) : fx.skeleton;
    const bare = fx.bare === undefined ? (petrial ? 1 : 0) : fx.bare;
    const ink = fx.ink === undefined ? 1 : fx.ink;

    // Shading: each face in its color (see TILE_HUES), opaque; the faces all lie in one plane, so the light falls on them alike, changing only as a flip turns the tiling over. Not on a Petrial, whose faces are skew.
    const L = pose.M.L,
        nz = L[8],
        side = nz < 0 ? -1 : 1,
        lit = side * (L[2] * LIGHT[0] + L[5] * LIGHT[1] + L[8] * LIGHT[2]);
    const shadeA = Number((petrial ? 0 : ink * (1 - bare) * smoothstep(0, 0.12, Math.abs(nz)) * (fx.shadeFade === undefined ? 1 : fx.shadeFade)).toFixed(3));
    // In the dark, the faces' own bands stand in for the ink (see shadedEdge).
    const dark = darkTheme(),
        banded = dark ? shadeA * (1 - (fx.shadeDim || 0)) : 0;
    if (shadeA > 0.002) {
        const A = pose.A2,
            F = patch.flatV,
            ds = [],
            es = [];
        for (let c = 0; c < TILE_HUES; c++) {
            ds.push(path());
            es.push(path());
        }
        const at = i => [A[0] * F[2 * i] + A[1] * F[2 * i + 1] + A[4], A[2] * F[2 * i] + A[3] * F[2 * i + 1] + A[5]];
        const bandW = (T_STROKE * ik / 2) * (1 - 0.7 * sk),
            spotKey = fx.spot === undefined ? null : fx.spot;
        // Tiles falling (fx.fall: { mode: 'in' or 'out', t from 0 to 1}): each in its turn, from the middle outward, give or take a little; coming in, each drops onto the plane from above it (large, faint, settling to its place), and going, each falls away (shrinking, drifting down, turning a little, fading). Each tile is drawn whole, outlined.
        const fall = fx.fall || null,
            falling = [];
        const hash = k => {
            let h = 2166136261;
            for (let i = 0; i < k.length; i++) {
                h = Math.imul(h ^ k.charCodeAt(i), 16777619);
            }
            return ((h >>> 0) % 1000) / 1000;
        };
        let spot = null;
        for (const f of patch.FACES) {
            if (fall) {
                const q = f.ids.map(at),
                    c = q.reduce((u, p) => [u[0] + p[0] / q.length, u[1] + p[1] / q.length], [0, 0]);
                const r = Math.min(1, Math.hypot(c[0] - CENTER, c[1] - CENTER) / WIN_DIAG),
                    h = hash(f.key);
                const u = clamp((fall.t - (0.52 * r + 0.13 * h)) / 0.35, 0, 1);
                if (fall.mode === 'in' ? u <= 0 : u >= 1) {
                    continue;
                }
                if (u > 0 && u < 1) {
                    falling.push({
                        f,
                        q,
                        c,
                        u,
                        h
                    });
                    continue;
                }
            }
            const q = f.ids.map(at);
            if (spotKey !== null && f.key === spotKey) {
                spot = {
                    f,
                    q
                };
                continue;
            }
            ds[f.hue].poly(q, true);
            if (dark && !fall) {
                innerBands(q, bandW, null, es[f.hue]);
            }
        }
        const outline = h => (dark ? rgb(shadedEdge(faceHue(h, TILE_HUES), lit, fx.shadeDim || 0)) : inkC);
        // With a face picked out, the rest go pale (as on a star).
        const pale = Math.max(fx.shadeDim || 0, spot ? 1 : 0);
        // (While tiles fall, those in place are outlined, as each falling one is.)
        ds.forEach((d, c) => shadeG.shape({
            path: d,
            fill: rgb(shadedColor(faceHue(c, TILE_HUES), lit, pale)),
            alpha: shadeA,
            convex: true,
            ...(fall ? {
                stroke: outline(c),
                width: T_STROKE * ik
            } : {})
        }));
        if (dark) {
            es.forEach((d, c) => shadeG.shape({
                path: d,
                fill: rgb(shadedEdge(faceHue(c, TILE_HUES), lit, pale)),
                alpha: shadeA
            }));
        }
        if (spot) {
            const h = faceHue(spot.f.hue, TILE_HUES);
            shadeG.shape({
                path: path().poly(spot.q, true),
                fill: rgb(shadedColor(h, lit, fx.shadeDim || 0)),
                alpha: shadeA,
                convex: true
            });
            if (dark) {
                shadeG.shape({
                    path: innerBands(spot.q, bandW),
                    fill: rgb(shadedEdge(h, lit, fx.shadeDim || 0)),
                    alpha: shadeA
                });
            }
        }
        falling.forEach(x => {
            const e = fall.mode === 'in' ? 1 - (1 - x.u) ** 3 : x.u ** 2;
            const sc = fall.mode === 'in' ? 1 + 0.55 * (1 - e) : 1 - 0.45 * e;
            const ang = fall.mode === 'in' ? 0 : (x.h - 0.5) * 0.7 * e,
                dy = fall.mode === 'in' ? 0 : 38 * e;
            const co = Math.cos(ang),
                si = Math.sin(ang);
            const q = x.q.map(p => {
                const vx = (p[0] - x.c[0]) * sc,
                    vy = (p[1] - x.c[1]) * sc;
                return [x.c[0] + co * vx - si * vy, x.c[1] + si * vx + co * vy + dy];
            });
            const hue = faceHue(x.f.hue, TILE_HUES);
            // (Its fill and its outline each fade by itself, rather than the tile as a whole, which would cost a layer of its own for every tile.)
            const fa = Number((fall.mode === 'in' ? Math.min(1, x.u * 2.5) : 1 - e).toFixed(3));
            shadeG.shape({
                path: path().poly(q, true),
                fill: rgb(shadedColor(hue, lit, fx.shadeDim || 0)),
                stroke: outline(x.f.hue),
                width: T_STROKE * ik,
                fillAlpha: fa,
                strokeAlpha: fa,
                convex: true
            });
        });

        // During a flip only the band goes through (see bandSlab).
        if (slab) {
            const big = 4000,
                t = [-slab.n[1], slab.n[0]],
                c = (u, v) => [slab.o[0] + u * slab.n[0] + v * t[0], slab.o[1] + u * slab.n[1] + v * t[1]];
            shadeG.clip = clipPath(path().poly([c(-slab.w, -big), c(slab.w, -big), c(slab.w, big), c(-slab.w, big)], true));
            shadeG.clip.slab = slab;
        }
    }
    // (While tiles fall, each draws its own outline instead.)
    const inkAlpha = Number((ink * (1 - 0.55 * sk) * (1 - bare) * flat * (1 - banded) * (fx.fall ? 0 : 1) * (1 - (fx.edgesOff || 0))).toFixed(3));
    gEdges.alpha = inkAlpha;
    if (inkAlpha > 0.002) {
        const width = T_STROKE * ik * (1 - 0.7 * sk),
            A = pose.A2,
            F = patch.flatV,
            d = path();
        for (const [i, j] of patch.EDGES) {
            const a = [A[0] * F[2 * i] + A[1] * F[2 * i + 1] + A[4], A[2] * F[2 * i] + A[3] * F[2 * i + 1] + A[5]];
            const b = [A[0] * F[2 * j] + A[1] * F[2 * j + 1] + A[4], A[2] * F[2 * j] + A[3] * F[2 * j + 1] + A[5]];
            const c = clipToWindow(a, b, width / 2, slab);
            if (c && !sliver(a, b, c)) {
                d.seg(c[0], c[1]);
            }
        }
        gEdges.shape({
            path: d,
            stroke: inkC,
            width
        });
    }

    // One zigzag picked out (fx.spot, by key), or the one under the pointer.
    const aimed = fx.aim || null,
        aimF = aimed && aimed.kind === 'f' ? aimed.k : null;
    if (petrial) {
        const loops = patch.LOOPS.petrie,
            base = (fx.loops === undefined ? 1 : fx.loops) * flat;
        const spot = fx.spot === undefined || fx.spot === null ? null : fx.spot;
        const alpha = k => base * (spot === null || loops[k].key === spot ? 1 : 0.07),
            weight = k => (k === aimF ? 1.6 : 1) * ik;
        // The weave (see weaveOf): each strand's stretches on top move up a layer, above bands of paper (one band path for the strand under the pointer, which is bolder, one for the rest), where the strand under them is not faint and they are not faint themselves.
        const X = loops.map(l => screenNodes(l, S.inset, pose.A2)),
            wv = weaveOf(patch.LOOPS.cross, loops.length, pose.flipped);
        const paint = loopPaint(loops, {
            muted: fx.muted || 0
        });
        drawPaths(gLanes, loops, S.inset, pose.A2, {
            alpha,
            weight,
            slab,
            cuts: wv.hide,
            X,
            paint
        });
        const bands = [path(), path()];
        wv.cased.forEach(([k, j, lo]) => {
            if (alpha(k) >= 0.5 && alpha(lo) > 0.01) {
                stretchPath(X[k], j, -CASE_M, CASE_M, 0, slab, bands[k === aimF ? 1 : 0]);
            }
        });
        bands.forEach((d, b) => gLanes.shape({
            path: d,
            stroke: paper,
            width: (LOOP_W * (b ? 1.6 : 1) + 2 * CASING) * ik,
            cap: 'butt',
            alpha: Number(base.toFixed(3))
        }));
        loops.forEach((l, k) => {
            const a = alpha(k);
            if (a <= 0.002 || !wv.over[k].length) {
                return;
            }
            const lw = LOOP_W * weight(k),
                d = path();
            wv.over[k].forEach(j => stretchPath(X[k], j, -ROPE, ROPE, lw / 2, slab, d));
            gLanes.shape({
                path: d,
                stroke: paint(k),
                width: lw,
                alpha: Number(a.toFixed(3))
            });
        });
    }

    // The flag: its chamber on the ink, or its half-edge and a tick along the face's next edge on a Petrial.
    const at = p => screen(pose.map(fx.flagM ? applyAffine(fx.flagM, p) : p)),
        fl = S.flag;
    if (fx.flag && petrial) {
        const q = at(fl.v),
            m = at(scale(add(fl.v, fl.o), 0.5)),
            t = at(add(fl.v, scale(sub(fl.prev, fl.v), 0.28)));
        gCorner.shape({
            path: path().poly([m, q, t]),
            stroke: accent,
            width: STROKE * 0.72,
            alpha: 0.95
        });
    }
    if (fx.flag && !petrial) {
        gFlag.shape({
            path: path().poly([at(fl.v), at(scale(add(fl.v, fl.o), 0.5)), at(fl.c)], true),
            fill: accent,
            stroke: accent,
            width: 4,
            alpha: 0.9,
            convex: true
        });
    }

    const fade = fx.aimFade === undefined ? 1 : fx.aimFade;
    if (aimF !== null && !petrial) {
        gFaces.shape({
            path: path().poly(patch.FACES[aimF].ids.map(i => Q[i]), true),
            fill: accent,
            alpha: 0.12 * fade,
            convex: true
        });
    }
    if (aimed && aimed.kind === 'e') {
        const [i, j] = patch.EDGES[aimed.k];
        gAimMarks.shape({
            path: path().seg(Q[i], Q[j]),
            stroke: accent,
            width: 2.5 * STROKE,
            alpha: 0.3 * fade
        });
    }
    if (aimed && aimed.kind === 'v') {
        gAimMarks.dot(Q[aimed.k][0], Q[aimed.k][1], 17, accent, 0.3 * fade);
    }

    // Overlays, fixed in the world: the line of a flip, the arrow of a slide (or a glide), the pin at the center of a turn.
    const a = fx.axisAlpha || 0,
        w = x => screen(pose.world(x));
    if (fx.line && a > 0.001) {
        const reach = (2 * WIN_DIAG) / (pose.zoom * SCALE),
            {
                p,
                u
            } = fx.line;
        const foot = add(p, scale(u, dot(sub(pose.pan, p), u)));
        const d = clipLine(w(sub(foot, scale(u, reach))), w(add(foot, scale(u, reach))));
        if (d) {
            gOver.shape({
                path: d,
                stroke: accent,
                width: 6,
                alpha: 0.9 * a
            });
        }
    }
    // A slide's arrow, at the middle of the window; a glide's, on its line.
    let arrow = null;
    if (fx.slide) {
        arrow = [sub(pose.pan, scale(fx.slide, 0.5)), add(pose.pan, scale(fx.slide, 0.5))];
    }
    if (fx.line && fx.glide) {
        const {
            p,
            u
        } = fx.line, foot = add(p, scale(u, dot(sub(pose.pan, p), u)));
        arrow = [sub(foot, scale(u, fx.glide / 2)), add(foot, scale(u, fx.glide / 2))];
    }
    if (arrow && a > 0.001) {
        gOver.shape({
            path: arrowPath(...arrow.map(w)),
            stroke: accent,
            width: 6,
            alpha: a
        });
    }
    const q = fx.pin && a > 0.001 ? w(fx.pin) : null;
    if (q && insideWindow(q)) {
        gOver.dot(q[0], q[1], 9, accent, a);
    }
};
