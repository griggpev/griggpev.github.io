// The blended polyhedra, and the patches drawn of them and of the pure polyhedra.

import {
    add,
    cross,
    cross2,
    DEG,
    dot,
    I3,
    len,
    mean,
    mod,
    scale,
    sub,
    unit
} from './math.js';
import {
    DEFS
} from './solids.js';
import {
    affine,
    applyAffine,
    compose,
    latticeGroup,
    squashAcross,
    TILE_HUES,
    turnAbout3,
} from './planar.js';
import {
    pureGroupOf,
    pureStart
} from './pure.js';
import {
    cornerOffset,
    goldenColor,
    hueColor,
    loopColor,
    PETRIE_IN,
    ROPE,
    ropeNodes
} from './look.js';
import {
    BLEND_VIEW
} from './draw-blend.js';

// A blend P # Q of a planar polyhedron P with a segment { } or a linear apeirogon {∞} Q, Q set in the line square to P's plane (after McMullen and Schulte). Its generators are T_j = R_j S_j, the R_j generating P's group and the S_j acting on the height z alone. For the segment, S0 swaps the heights ±c/2 (S1 = S2 = 1): P's vertices rise and fall in turn (where P's faces are triangles and cannot alternate, every vertex is at both heights), and its faces go skew. For the line, S0 reflects in the height c/2 and S1 in 0 (S2 = 1): the structure goes on up and down forever, and its faces are helices about vertical axes. Its symmetries are pairs, a symmetry of the plane and z ↦ sz + kc, kept as tuples [a, i, j, s, k] (the first three P's, as in latticeGroup).
const BLEND_C = {
    seg: 0.62,
    line: 0.5
}; // the height step, in edges
const BLEND_ZOOMS = {
    seg: 1.3,
    line: 1.55
}; // drawn this much larger than their tilings

const blendGroups = {};
export const blendGroupOf = S => {
    if (blendGroups[S.key]) {
        return blendGroups[S.key];
    }
    const P = latticeGroup(S.tiling.lattice),
        c = S.c;
    const G = [],
        index = new Map();
    const tmul = (x, y) => [...P.tmul(x.slice(0, 3), y.slice(0, 3)), x[3] * y[3], x[3] * y[4] + x[4]];
    const tinv = x => [...P.tinv(x.slice(0, 3)), x[3], -x[3] * x[4]];
    const info = t => {
        const pl = P.G[P.idx(t.slice(0, 3))],
            L2 = P.PG[t[0]].L2;
        const L = [L2[0], L2[1], 0, L2[2], L2[3], 0, 0, 0, t[3]],
            tt = [pl.t[0], pl.t[1], t[4] * c];
        return {
            tuple: t,
            planar: pl,
            s: t[3],
            k: t[4],
            L,
            t: tt,
            M: affine(L, tt),
            proper: (P.PG[t[0]].proper ? 1 : -1) * t[3] > 0
        };
    };
    const idx = t => {
        const k = t.join();
        if (!index.has(k)) {
            index.set(k, G.length);
            G.push(info(t));
        }
        return index.get(k);
    };
    const tupleOf = x => G[x].tuple;
    // A tuple's action on a point, without making an element of it.
    const act = (t, p) => {
        const L2 = P.PG[t[0]].L2,
            tr = P.fromLattice(t[1], t[2]);
        return [L2[0] * p[0] + L2[1] * p[1] + tr[0], L2[2] * p[0] + L2[3] * p[1] + tr[1], t[3] * p[2] + t[4] * c];
    };
    const Gr = {
        blend: true,
        spatial: true,
        P,
        G,
        index,
        tmul,
        tinv,
        idx,
        tupleOf,
        act,
        c,
        mul: (x, y) => idx(tmul(tupleOf(x), tupleOf(y))),
        inv: x => idx(tinv(tupleOf(x))),
        find: () => 0,
    };
    idx([0, 0, 0, 1, 0]); // the identity, element 0
    blendGroups[S.key] = Gr;
    return Gr;
};

// The base flag of a blend or a pure polyhedron, from its generators S.Tt in Gr: the vertex u0, the edge's other end u1, and, along the face (σ = T0T1) and along the Petrie polygon (π = T0T1T2), the vertices after: u2, u3; uPrev = σ⁻¹u0; p2, p3. Returns σ.
export const placeFlag = (S, Gr, u0) => {
    const [T0, T1, T2] = S.Tt, sig = Gr.tmul(T0, T1), pi = Gr.tmul(sig, T2), ap = Gr.act;
    S.u0 = u0;
    S.u1 = ap(T0, u0);
    S.u2 = ap(sig, S.u1);
    S.u3 = ap(sig, S.u2);
    S.uPrev = ap(T1, S.u1);
    S.p2 = ap(pi, S.u1);
    S.p3 = ap(pi, S.p2);
    S.uMid = add(scale(S.u0, 0.6), scale(S.u1, 0.4));
    return sig;
};

// (base: the tiling it is blended from.)
export const buildBlend = (name, phase, base) => {
    const def = DEFS[name],
        q = def.blend.q;
    const P = latticeGroup(base.tiling.lattice);
    const S = {
        name,
        def,
        title: def.title,
        blend: true,
        spatial: true,
        q,
        base,
        phase,
        key: `${name}@${phase}`,
        zoom: base.zoom * BLEND_ZOOMS[q],
        blendZoom: BLEND_ZOOMS[q],
        edge: base.edge,
        inset: base.inset / BLEND_ZOOMS[q],
        jog: base.jog / BLEND_ZOOMS[q],
        pn: base.pn,
        qn: base.qn,
        tiling: base.tiling,
        lattice: base.lattice,
        q0: BLEND_VIEW,
        c: BLEND_C[q] * base.edge,
        home: def.blend.base, // its place among the tilings
    };
    const Gr = blendGroupOf(S);
    // P's generating reflections at its base flag, as symmetries of the plane.
    const {
        v,
        o,
        c: fc
    } = base.flag;
    const refl = (p, u) => {
        const w = unit(u),
            F = [2 * w[0] * w[0] - 1, 2 * w[0] * w[1], 2 * w[0] * w[1], 2 * w[1] * w[1] - 1];
        return P.tupleOf(P.lookup(F, [p[0] - (F[0] * p[0] + F[1] * p[1]), p[1] - (F[2] * p[0] + F[3] * p[1]), 0]));
    };
    const d = sub(o, v);
    S.R = [refl(scale(add(v, o), 0.5), [-d[1], d[0], 0]), refl(v, sub(fc, v)), refl(v, d)];
    const Z = q === 'seg' ? [
        [-1, 0],
        [1, 0],
        [1, 0]
    ] : [
        [-1, 1],
        [-1, 0],
        [1, 0]
    ];
    S.Tt = S.R.map((r, j) => [...r, ...Z[j]]);
    S.T = S.Tt.map(t => Gr.idx(t));
    const sig = placeFlag(S, Gr, [v[0], v[1], q === 'seg' ? S.c / 2 : 0]),
        ap = Gr.act,
        mul = Gr.tmul;
    if (q === 'line') {
        // (T0T1)^p rises straight up by pc.
        let r = [0, 0, 0, 1, 0];
        for (let i = 0; i < base.pn; i++) {
            r = mul(r, sig);
        }
        S.rise = r;
    }
    // Symmetries near the base vertex, for random moves: proper ones, and all.
    const near = new Map([
        ['0,0,0,1,0', [0, 0, 0, 1, 0]]
    ]);
    let frontier = [
        [0, 0, 0, 1, 0]
    ];
    for (let depth = 0; depth < 7; depth++) {
        const next = [];
        frontier.forEach(t => S.Tt.forEach(g => {
            const h = mul(t, g),
                k = h.join();
            if (near.has(k)) {
                return;
            }
            const p = ap(h, S.u0);
            if (Math.hypot(p[0] - S.u0[0], p[1] - S.u0[1]) > 1.05 || Math.abs(p[2] - S.u0[2]) > 1.6 * S.c) {
                return;
            }
            near.set(k, h);
            next.push(h);
        }));
        frontier = next;
    }
    const all = [...near.values()].map(t => Gr.idx(t));
    Gr.pool = {
        all,
        rotations: all.filter(g => Gr.G[g].proper)
    };
    return S;
};

// A symmetry of P (an element of its lattice group) lifted to the blend: walk from P's base chamber to its image, crossing one wall at a time, and take the blend's generator for each wall crossed.
export const liftToBlend = (S, gP) => {
    const P = latticeGroup(S.tiling.lattice),
        Gr = blendGroupOf(S);
    const {
        v,
        o,
        c: fc
    } = S.base.flag, C0 = [v, scale(add(v, o), 0.5), fc];
    const at = (x, p) => applyAffine(P.G[x].M, p),
        cen = pts => scale(add(add(pts[0], pts[1]), pts[2]), 1 / 3);
    const target = cen(C0.map(p => at(gP, p))),
        Rp = S.R.map(r => P.idx(r));
    let cur = 0,
        lift = 0;
    for (let guard = 0; guard < 4000; guard++) {
        const pts = C0.map(p => at(cur, p));
        if (len(sub(cen(pts), target)) < 1e-6) {
            break;
        }
        let crossed = false;
        for (const [w, a, b] of [
                [0, 1, 2],
                [1, 0, 2],
                [2, 0, 1]
            ]) {
            const A = pts[a],
                B = pts[b],
                side = p => cross2(sub(B, A), sub(p, A));
            if (side(pts[w]) * side(target) < -1e-12) {
                cur = P.mul(cur, Rp[w]);
                lift = Gr.mul(lift, S.T[w]);
                crossed = true;
                break;
            }
        }
        if (!crossed) {
            break;
        }
    }
    return lift;
};

// A pure polyhedron's polygons, colored by where they are: a face by its center, a helix or zigzag by its axis, on a pattern of TILE_HUES hues repeating with the cubical lattice (k: which way the axis runs). co: the pattern's coefficients for that polyhedron, found so that polygons sharing an edge (nearly) never share a color.
const pureHue = (c, k, co) => {
    const q = c.map(x => Math.round(x * 2));
    return mod(co[0] * q[0] + co[1] * q[1] + co[2] * q[2] + co[3] * k, TILE_HUES);
};
const pureColor = (c, k, co) => loopColor(pureHue(c, k, co), TILE_HUES);
// The line an open polygon runs along: its direction (one way of the two), its foot (nearest the origin), and which of the directions it is.
const lineOf = W => {
    let dir = unit(sub(W[W.length - 1], W[0]));
    const big = dir.reduce((m, x, i) => (Math.abs(x) > Math.abs(dir[m]) + 1e-9 ? i : m), 0);
    if (dir[big] < 0) {
        dir = scale(dir, -1);
    }
    const mid = mean(W),
        foot = sub(mid, scale(dir, dot(mid, dir)));
    const k = Math.round(Math.abs(dir[0]) * 3 + Math.abs(dir[1]) * 5 + Math.abs(dir[2]) * 7);
    return {
        dir,
        foot,
        k
    };
};
// Points in space, each found once, keyed by number: rounded to 1e-3 about c, within 32 units of it (beyond, by name).
const pointsNear = c => {
    const map = new Map(),
        far = new Map(),
        pts = [];
    const index = p => {
        const x = Math.round((p[0] - c[0]) * 1e3),
            y = Math.round((p[1] - c[1]) * 1e3),
            z = Math.round((p[2] - c[2]) * 1e3);
        if (Math.abs(x) > 32000 || Math.abs(y) > 32000 || Math.abs(z) > 32000) {
            const k = `${x},${y},${z}`;
            if (!far.has(k)) {
                far.set(k, pts.length);
                pts.push(p);
            }
            return far.get(k);
        }
        const key = (u, v, w) => ((u + 32768) * 65536 + (v + 32768)) * 65536 + (w + 32768),
            k = key(x, y, z);
        const hit = map.get(k);
        if (hit !== undefined) {
            return hit;
        }
        // (A point rounded the other way, next door.)
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const i = (dx || dy || dz) ? map.get(key(x + dx, y + dy, z + dz)) : undefined;
                    if (i !== undefined && (pts[i][0] - p[0]) ** 2 + (pts[i][1] - p[1]) ** 2 + (pts[i][2] - p[2]) ** 2 < 1e-12) {
                        map.set(k, i);
                        return i;
                    }
                }
            }
        }
        map.set(k, pts.length);
        pts.push(p);
        return pts.length - 1;
    };
    return {
        index,
        pts
    };
};
// A blend's faces are set in from its edges by this much of the inset, so the two faces along each edge run close beside it.
const BLEND_FACE_IN = 0.5;
// The blend near the point c3 (in its own coordinates): the flags within R of it across, and (for the line) within Hball of it up and down, found by stepping from flag to flag; and from them its vertices, edges, faces and Petrie polygons, and the loops that draw its faces and its Petrial. (A pure polyhedron's patch too: a ball about c3, from the translation nearest it.) The last few made are kept, to be found when asked for again (a family come round again, or a patch made beforehand: see prepareNear and prepareBlends in toy.js).
const made = [];
export const blendPatchOf = (S, c3, R, Hball) => {
    const key = `${c3.map(x => x.toFixed(6))} ${R.toFixed(6)} ${Hball.toFixed(6)}`;
    const had = made.findIndex(m => m.S === S && m.key === key);
    if (had >= 0) {
        const [m] = made.splice(had, 1);
        made.unshift(m);
        return m.patch;
    }
    const patch = makeBlendPatch(S, c3, R, Hball);
    made.unshift({
        S,
        key,
        patch
    });
    made.length = Math.min(made.length, 6);
    return patch;
};
const makeBlendPatch = (S, c3, R, Hball) => {
    let Gr, H, start, within, rise = 0;
    if (S.pure) {
        Gr = pureGroupOf(S);
        H = R;
        start = pureStart(S, c3);
        within = (t, r) => len(sub(Gr.act(t, S.uMid), c3)) <= r;
    } else {
        Gr = blendGroupOf(S);
        const P = latticeGroup(S.tiling.lattice);
        H = S.q === 'line' ? Hball + 0.6 * S.c : S.c;
        const [ci, cj] = P.toLattice(c3).map(Math.round);
        start = Gr.tupleOf(liftToBlend(S, P.lookup([1, 0, 0, 1], P.fromLattice(ci, cj))));
        if (S.q === 'line') {
            const z0 = Gr.act(start, S.u0)[2],
                m = Math.round((c3[2] - z0) / (S.pn * S.c));
            const up = m >= 0 ? S.rise : Gr.tinv(S.rise);
            for (let i = 0; i < Math.abs(m); i++) {
                start = Gr.tmul(up, start);
            }
        }
        // Kept: the flags in the region. Walked through: those a little beyond it too (above and below by a whole rise), so the walk can get round to every flag kept from wherever it starts.
        within = (t, r, h) => {
            const p = Gr.act(t, S.uMid);
            return Math.hypot(p[0] - c3[0], p[1] - c3[1]) <= r && Math.abs(p[2] - c3[2]) <= h;
        };
        rise = S.q === 'line' ? S.pn * S.c : 0;
    }
    // (A blend's tuples [a, i, j, s, k] by number where they fit, else by name.)
    const tkey = S.pure ? t => t.join() : t => (Math.abs(t[1]) < 500 && Math.abs(t[2]) < 500 && Math.abs(t[4]) < 2000 ?
        (((t[0] * 1024 + t[1] + 512) * 1024 + t[2] + 512) * 2 + (t[3] > 0 ? 1 : 0)) * 4096 + t[4] + 2048 : t.join());
    const seen = new Set([tkey(start)]),
        queue = [start],
        flags = [];
    // (A pure polyhedron may be sparse, its pieces in the ball joined only outside it: the walk goes a few edges further.)
    const slack = S.pure ? 3 * Math.max(1, S.edge) : 0.6,
        Tt = S.Tt;
    for (let qi = 0; qi < queue.length && queue.length < 120000; qi++) {
        const t = queue[qi];
        if (!within(t, R + slack, H + rise)) {
            continue;
        }
        if (within(t, R, H)) {
            flags.push(t);
        }
        for (let m = 0; m < Tt.length; m++) {
            const h = Gr.tmul(t, Tt[m]),
                k = tkey(h);
            if (!seen.has(k)) {
                seen.add(k);
                queue.push(h);
            }
        }
    }

    // (Points by number, not by name: a patch has tens of thousands of flags to look up.)
    const at3 = pointsNear(c3),
        V = at3.pts,
        vert = at3.index;
    const fl = flags.map(t => [S.u0, S.u1, S.u2, S.u3, S.p2, S.p3].map(u => vert(Gr.act(t, u))));
    const N = V.length,
        key3 = (a, b, c) => (a * N + b) * N + c;
    const edges = new Map(),
        faceNext = new Map(),
        petNext = new Map();
    fl.forEach(([a, b, fc2, fc3, pc2, pc3]) => {
        edges.set(a < b ? a * N + b : b * N + a, [Math.min(a, b), Math.max(a, b)]);
        faceNext.set(key3(a, b, fc2), fc3);
        petNext.set(key3(a, b, pc2), pc3);
    });
    const un3 = k => {
        const c = k % N,
            r = (k - c) / N,
            b = r % N;
        return [(r - b) / N, b, c];
    };
    // Polygons, from the next vertex after any three in a row. Each step is known one way round from the flag it came from, and the flags kept near the patch's edge may face either way, so every step goes in both ways round: a polygon is then followed as far as anything of it is known, from wherever it is started, and traced once.
    const trace = oneWay => {
        const next = new Map(oneWay),
            prev = new Map();
        oneWay.forEach((d, k) => {
            const [a, b, c] = un3(k);
            next.set(key3(d, c, b), a);
        });
        next.forEach((d, k) => {
            const [a, b, c] = un3(k);
            prev.set(key3(b, c, d), a);
        });
        const done = new Set(),
            out = [];
        next.forEach((d0, k) => {
            if (done.has(k)) {
                return;
            }
            const path = un3(k);
            let closed = false;
            for (let g = 0; g < 400; g++) {
                const n = path.length,
                    d = next.get(key3(path[n - 3], path[n - 2], path[n - 1]));
                if (d === undefined) {
                    break;
                }
                if (d === path[0]) {
                    closed = true;
                    break;
                } // (back where it began)
                path.push(d);
            }
            if (!closed) {
                for (let g = 0; g < 400; g++) {
                    const a = prev.get(key3(path[0], path[1], path[2]));
                    if (a === undefined) {
                        break;
                    }
                    path.unshift(a);
                }
                // (Followed both ways from where it was started, a finite face whose last steps are not known, near the patch's edge, can still come round to a vertex it has passed: it is closed, from there.)
                const seen = new Map();
                for (let i = 0; i < path.length; i++) {
                    if (seen.has(path[i])) {
                        path.splice(0, path.length, ...path.slice(seen.get(path[i]), i));
                        closed = true;
                        break;
                    }
                    seen.set(path[i], i);
                }
            }
            const n = path.length;
            for (let i = 0; i < n; i++) {
                if (!closed && i + 2 >= n) {
                    break;
                }
                const a = path[i],
                    b = path[(i + 1) % n],
                    c = path[(i + 2) % n];
                done.add(key3(a, b, c));
                done.add(key3(c, b, a));
            }
            if (n >= 3) {
                out.push({
                    ids: path,
                    closed
                });
            }
        });
        return out;
    };
    const FACES = trace(faceNext),
        PETRIE = trace(petNext);
    const EDGES = [...edges.values()];
    const edgeIndex = new Map();
    // (By a·N + b, either way round.)
    EDGES.forEach(([a, b], e) => {
        edgeIndex.set(a * N + b, e);
        edgeIndex.set(b * N + a, e);
    });

    // The Petrial's loops, as for a tiling: at each vertex the strand turns through a corner of the face it is in, and along each edge it crosses its partner like a rope's strands; all in space now, the face's side of an edge being toward the face's next vertex along.
    const perp = (w, a, b) => {
        const u = unit(sub(b, a)),
            d = sub(w, a);
        return unit(sub(d, scale(u, dot(d, u))));
    };
    const zig = (S.base && S.base.zig) || {};
    // (A pure polyhedron's Petrie polygons may close up: followed round.)
    const petrie = PETRIE.filter(z => (z.closed ? S.pure : z.ids.length >= 5)).map(z => {
        const ids = z.ids,
            W = ids.map(i => V[i]),
            nodes = [],
            n = W.length,
            at = i => W[mod(i, n)];
        if (z.closed) {
            for (let i = 0; i < n; i++) {
                nodes.push({
                    base: at(i),
                    off: scale(cornerOffset([at(i - 1), at(i), at(i + 1)], 1), PETRIE_IN)
                });
                nodes.push(...ropeNodes(at(i), at(i + 1), perp(at(i - 1), at(i), at(i + 1)), perp(at(i + 2), at(i), at(i + 1)), S.jog));
            }
            nodes.push(nodes[0]);
            const ctr = mean(W),
                key = `p${ctr.map(x => Math.round(x * 20)).join()}`;
            return {
                nodes,
                open: true,
                closed: true,
                color: pureColor(ctr, 0, S.def.pure.colors.petrie),
                key,
                dist: len(sub(ctr, c3)),
                ids
            };
        }
        for (let i = 1; i < W.length - 1; i++) {
            nodes.push({
                base: W[i],
                off: scale(cornerOffset([W[i - 1], W[i], W[i + 1]], 1), PETRIE_IN)
            });
            if (i + 1 < W.length - 1) {
                nodes.push(...ropeNodes(W[i], W[i + 1], perp(W[i - 1], W[i], W[i + 1]), perp(W[i + 2], W[i], W[i + 1]), S.jog));
            }
        }
        if (S.pure) {
            // The line it runs along (its axis, for a helix) names it and colors it.
            const ax = lineOf(W),
                key = `p${[...ax.dir, ...ax.foot].map(x => Math.round(x * 20)).join()}`;
            return {
                nodes,
                open: true,
                color: pureColor(ax.foot, ax.k, S.def.pure.colors.petrie),
                key,
                dist: len(sub(ax.foot, sub(c3, scale(ax.dir, dot(c3, ax.dir))))),
                ids
            };
        }
        // Its color, as its shadow's on the plane would be (see patchOf).
        const p0 = W[0],
            p1 = W[W.length - 1];
        const dir = mod(Math.round(Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) / (Math.PI / 12)), 12);
        const th = (dir * Math.PI) / 12,
            u = [Math.cos(th), Math.sin(th)];
        const offs = W.map(w => u[0] * w[1] - u[1] * w[0]),
            offset = (Math.min(...offs) + Math.max(...offs)) / 2;
        const zf = zig[dir],
            per = zf ? Math.round(6 / zf.n) : 1,
            ix = zf ? Math.round(offset / zf.delta - zf.phase) : 0;
        const color = zf ? hueColor(35 + 60 * (mod(ix, per) * zf.n + zf.f)) : goldenColor(dir);
        // A name that outlasts the patch: the line it runs along.
        const span = sub(p1, p0),
            dl = unit(span),
            mid = scale(W.reduce((s2, w) => add(s2, w), [0, 0, 0]), 1 / W.length);
        const foot = sub(mid, scale(dl, dot(mid, dl)));
        const key = [...dl, ...foot].map(x => Math.round(x * 20)).join();
        const dist = Math.hypot(foot[0] - c3[0], foot[1] - c3[1]);
        return {
            nodes,
            open: true,
            color,
            key,
            dist,
            ids
        };
    });
    const crossings = EDGES.map(() => []);
    // (Over and under: by the turn at the far end, seen from above; for a pure polyhedron, from one fixed direction.)
    const LEFT = [0.31, 0.53, 0.79];
    petrie.forEach((l, k) => {
        const ids = l.ids,
            n = ids.length;
        if (l.closed) {
            for (let i = 0; i < n; i++) {
                const a = V[ids[i]],
                    b = V[ids[(i + 1) % n]],
                    c = V[ids[(i + 2) % n]];
                const e = edgeIndex.get(ids[i] * N + ids[(i + 1) % n]);
                if (e !== undefined) {
                    crossings[e].push({
                        loop: k,
                        j: i * (2 * ROPE + 2) + 1 + ROPE,
                        left: dot(cross(sub(b, a), sub(c, b)), LEFT) > 0
                    });
                }
            }
            return;
        }
        for (let i = 1; i < ids.length - 2; i++) {
            const a = V[ids[i]],
                b = V[ids[i + 1]],
                c = V[ids[i + 2]];
            const e = edgeIndex.get(ids[i] * N + ids[i + 1]);
            if (e !== undefined) {
                crossings[e].push({
                    loop: k,
                    j: (i - 1) * (2 * ROPE + 2) + 1 + ROPE,
                    left: S.pure ? dot(cross(sub(b, a), sub(c, b)), LEFT) > 0 : cross2(sub(b, a), sub(c, b)) > 0
                });
            }
        }
    });
    const placed = (nodes, k) => {
        const out = new Float64Array(3 * nodes.length);
        nodes.forEach((nd, i) => {
            for (let a = 0; a < 3; a++) {
                out[3 * i + a] = nd.base[a] + k * nd.off[a];
            }
        });
        return out;
    };
    petrie.forEach(l => {
        l.pos3 = placed(l.nodes, S.inset);
    });
    // Each crossing again as one cubic, for drawing: from its first node to its last through the edge's middle, these its two inner control points (an affine view keeps a cubic a cubic, so they are seen as points are). Where the two sides are opposite, as in the plane, it is the sine the nodes are on to within 2% of the inset.
    petrie.forEach(l => {
        const ctl = [],
            nd = l.nodes,
            per = 2 * ROPE + 2;
        for (let j = 1; j + 2 * ROPE < nd.length; j += per) {
            const m = nd[j + ROPE].base,
                w = sub(m, nd[j].base);
            const f = scale(nd[j].off, S.inset),
                g = scale(nd[j + 2 * ROPE].off, S.inset);
            ctl.push(...add(m, add(scale(w, -1 / 3), sub(scale(f, 1 / 3), scale(g, 2 / 3)))));
            ctl.push(...add(m, add(scale(w, 1 / 3), sub(scale(g, 1 / 3), scale(f, 2 / 3)))));
        }
        l.ctl3 = Float64Array.from(ctl);
    });
    // The faces, skew polygons (or helices, with a line), as loops too: each in the color of the tiling's face beneath it (see TILE_HUES), set in at its corners as a star's faces are; a closed one comes back to its start.
    const T = S.tiling || {
            cells: [],
            phases: [
                [0, 0]
            ]
        },
        {
            b1,
            b2
        } = S.lattice || {
            b1: [1, 0],
            b2: [0, 1]
        },
        off0 = T.phases[S.phase || 0] || [0, 0];
    const det = b1[0] * b2[1] - b1[1] * b2[0];
    const cellCtr = T.cells.map(cell => [cell.reduce((t, o) => t + o[0], 0) / cell.length, cell.reduce((t, o) => t + o[1], 0) / cell.length]);
    const hueAt = (x, y) => {
        let best = null;
        cellCtr.forEach((cc, w) => {
            const dx = x - off0[0] - cc[0],
                dy = y - off0[1] - cc[1];
            const fi = (dx * b2[1] - dy * b2[0]) / det,
                fj = (b1[0] * dy - b1[1] * dx) / det,
                i = Math.round(fi),
                j = Math.round(fj);
            const miss = Math.hypot(fi - i, fj - j);
            if (!best || miss < best.miss) {
                best = {
                    miss,
                    hue: mod(2 * i + 5 * j + 7 * w, TILE_HUES)
                };
            }
        });
        return best.hue;
    };
    const faces = FACES.filter(f => f.closed || f.ids.length >= 4).map(f => {
        const ids = f.ids,
            n = ids.length,
            W = ids.map(i => V[i]),
            nodes = [];
        const corner = i => ({
            base: W[i],
            off: cornerOffset([W[(i + n - 1) % n], W[i], W[(i + 1) % n]], 1)
        });
        if (f.closed) {
            for (let i = 0; i <= n; i++) {
                nodes.push(corner(i % n));
            }
        } else {
            for (let i = 1; i < n - 1; i++) {
                nodes.push(corner(i));
            }
        }
        if (S.pure) {
            // Named and colored by its center, or (a helix) its axis.
            const ctr = mean(W),
                ax = f.closed ? null : lineOf(W);
            const key = f.closed ? `f${ctr.map(x => Math.round(x * 20)).join()}` : `f${[...ax.dir, ...ax.foot].map(x => Math.round(x * 20)).join()}`;
            const hue = f.closed ? pureHue(ctr, 0, S.def.pure.colors.faces) : pureHue(ax.foot, ax.k, S.def.pure.colors.faces);
            const pos3 = placed(nodes, S.inset * BLEND_FACE_IN);
            return {
                nodes,
                ids,
                face: FACES.indexOf(f),
                closed: f.closed,
                color: loopColor(hue, TILE_HUES),
                hue,
                key,
                dist: len(sub(f.closed ? ctr : ax.foot, c3)),
                pos3,
                ctl3: new Float64Array(0),
                normal: f.closed && S.flatFaces ? unit(cross(sub(W[1], W[0]), sub(W[2], W[0]))) : null
            };
        }
        // Beneath it: its shadow's middle, over its distinct corners.
        const shadow = new Map(W.map(w => [`${Math.round(w[0] * 1e3)},${Math.round(w[1] * 1e3)}`, w]));
        const cx = [...shadow.values()].reduce((t, w) => t + w[0], 0) / shadow.size,
            cy = [...shadow.values()].reduce((t, w) => t + w[1], 0) / shadow.size;
        // A helix turns one way or the other as it rises (hand).
        const hand = !f.closed && W.length >= 3 && (((W[1][0] - W[0][0]) * (W[2][1] - W[1][1]) - (W[1][1] - W[0][1]) * (W[2][0] - W[1][0]) > 0) === (W[1][2] > W[0][2])) ? 1 : 0;
        // Over each hexagon the blend with a line winds six helices, three each way round (its vertices come every 2c up a column, both ways round each hexagon, and a turn rises 6c). Told apart by where they pass the hexagon's corner at 30° and by their hand, each gets the hexagon's color turned three steps of the wheel per pass, and back one for the other hand: six colors, and none the same across an edge.
        let hue = hueAt(cx, cy);
        if (S.q === 'line' && S.def.blend.base === 'hexagonal' && shadow.size >= 6) {
            const ref = [...shadow.values()].reduce((r, w) => {
                const a = Math.atan2(w[1] - cy, w[0] - cx),
                    d = Math.abs(Math.atan2(Math.sin(a - Math.PI / 6), Math.cos(a - Math.PI / 6)));
                return !r || d < r.d ? {
                    w,
                    d
                } : r;
            }, null).w;
            const z = Math.min(...W.filter(w => Math.hypot(w[0] - ref[0], w[1] - ref[1]) < 1e-6).map(w => Math.round(w[2] / S.c)));
            hue = (hue + 3 * mod(Math.floor(z / 2), 3) + 8 * hand) % TILE_HUES;
        }
        // A name that outlasts the patch: the face beneath, and (a helix) how high up it is, modulo its turn.
        let lift = 0;
        if (!f.closed) {
            // Its heights over one corner of the shadow go up a whole turn at a time.
            const k0 = [...shadow.keys()].sort()[0],
                zs = W.filter(w => `${Math.round(w[0] * 1e3)},${Math.round(w[1] * 1e3)}` === k0).map(w => w[2]).sort((a2, b2) => a2 - b2);
            const turn = zs.length > 1 ? zs[1] - zs[0] : 0;
            lift = turn > 1e-6 ? Math.round(mod(zs[0], turn) * 50) % Math.round(turn * 50) : 0;
        }
        const key = `f${Math.round(cx * 50)},${Math.round(cy * 50)},${lift},${hand}`;
        const pos3 = placed(nodes, S.inset * BLEND_FACE_IN);
        return {
            nodes,
            ids,
            face: FACES.indexOf(f),
            closed: f.closed,
            color: loopColor(hue, TILE_HUES),
            hue,
            key,
            dist: Math.hypot(cx - c3[0], cy - c3[1]),
            pos3,
            ctl3: new Float64Array(0)
        };
    });
    // Each loop in stretches (chunks) of per segments, from node per·c to per·c + per, with a ball about each (its crossing's control points too): a frame works out only the stretches that reach into view.
    const chunked = (l, per) => {
        const P = l.pos3,
            C = l.ctl3,
            n = P.length / 3,
            m = Math.max(0, Math.ceil((n - 1) / per)),
            out = new Float64Array(4 * m);
        // (Over the chunk's points, then its control points: their box's middle, and the farthest from it.)
        const each = (c, f) => {
            for (let i = c * per; i <= Math.min(n - 1, c * per + per); i++) {
                f(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
            }
            for (let i = 2 * c; i < 2 * c + 2 && 3 * i < C.length; i++) {
                f(C[3 * i], C[3 * i + 1], C[3 * i + 2]);
            }
        };
        for (let c = 0; c < m; c++) {
            let x0 = Infinity,
                y0 = Infinity,
                z0 = Infinity,
                x1 = -Infinity,
                y1 = -Infinity,
                z1 = -Infinity,
                r = 0;
            each(c, (x, y, z) => {
                x0 = Math.min(x0, x);
                y0 = Math.min(y0, y);
                z0 = Math.min(z0, z);
                x1 = Math.max(x1, x);
                y1 = Math.max(y1, y);
                z1 = Math.max(z1, z);
            });
            const cx = (x0 + x1) / 2,
                cy = (y0 + y1) / 2,
                cz = (z0 + z1) / 2;
            each(c, (x, y, z) => {
                r = Math.max(r, Math.hypot(x - cx, y - cy, z - cz));
            });
            out[4 * c] = cx;
            out[4 * c + 1] = cy;
            out[4 * c + 2] = cz;
            out[4 * c + 3] = r + 1e-6;
        }
        l.per = per;
        l.chunks = out;
        // How far along the loop each node is, for a pen tracing it.
        l.arc = new Float64Array(n);
        for (let i = 1; i < n; i++) {
            l.arc[i] = l.arc[i - 1] + Math.hypot(P[3 * i] - P[3 * i - 3], P[3 * i + 1] - P[3 * i - 2], P[3 * i + 2] - P[3 * i - 1]);
        }
    };
    petrie.forEach(l => chunked(l, 2 * ROPE + 2));
    faces.forEach(l => chunked(l, 8));

    // As drawn, every loop is laid out on the screen (see strandScreen). For that, each face's side of each of its edges: square to the edge, toward the face (for a skew face, between the ways to its vertices either side), so that the two loops along an edge, whichever they are, agree on which face is where; and the face through any three vertices in a row.
    const sides = new Map(),
        faceAt = new Map(),
        ekey = (a, b) => (a < b ? a * N + b : b * N + a);
    FACES.forEach((f, fi) => {
        const ids = f.ids,
            n = ids.length,
            at = m => (f.closed ? ids[mod(m, n)] : m >= 0 && m < n ? ids[m] : undefined);
        for (let m = 0; m < (f.closed ? n : n - 1); m++) {
            const a = at(m),
                b = at(m + 1),
                pv = at(m - 1),
                nx = at(m + 2);
            let s = [0, 0, 0];
            if (pv !== undefined) {
                s = add(s, perp(V[pv], V[a], V[b]));
            }
            if (nx !== undefined) {
                s = add(s, perp(V[nx], V[a], V[b]));
            }
            if (len(s) < 1e-9) {
                continue;
            }
            const k = ekey(a, b);
            if (!sides.has(k)) {
                sides.set(k, []);
            }
            sides.get(k).push({
                f: fi,
                v: unit(s)
            });
        }
        for (let m = 0; m < (f.closed ? n : n - 2); m++) {
            faceAt.set(key3(at(m), at(m + 1), at(m + 2)), fi);
            faceAt.set(key3(at(m + 2), at(m + 1), at(m)), fi);
        }
    });
    const sideOf = (a, b, fi, other) => {
        const l = sides.get(ekey(a, b)),
            e = l && l.find(x => (other ? x.f !== fi : x.f === fi));
        return e ? e.v : null;
    };
    // A loop's strand: its vertices, and for each edge the side it sets out beside and the side across (a Petrie polygon's crossing to the face it turns through at the far end; a face's, the face over the edge), and the share of the edge each half of a crossing takes.
    const strandOf = (l, rope) => {
        const ids = l.ids,
            nv = ids.length,
            closed = Boolean(l.closed),
            ne = closed ? nv : nv - 1,
            at = m => ids[mod(m, nv)];
        const sd = new Float64Array(6 * ne),
            lam = new Float64Array(ne);
        for (let i = 0; i < ne; i++) {
            const a = at(i),
                b = at(i + 1);
            const away = w => (w === undefined ? null : perp(V[w], V[a], V[b]));
            const pv = closed || i > 0 ? at(i - 1) : undefined,
                nx = closed || i + 2 < nv ? at(i + 2) : undefined;
            let sF, sG;
            if (rope) {
                const F = pv === undefined ? undefined : faceAt.get(key3(pv, a, b)),
                    G = nx === undefined ? undefined : faceAt.get(key3(a, b, nx));
                sF = (F !== undefined && sideOf(a, b, F)) || away(pv) || scale(away(nx) || [0, 0, 1], -1);
                sG = (G !== undefined && sideOf(a, b, G)) || away(nx) || scale(sF, -1);
            } else {
                const fi = l.face;
                sF = sideOf(a, b, fi) || away(pv) || away(nx) || [0, 0, 1];
                sG = sideOf(a, b, fi, true) || scale(sF, -1);
            }
            sd.set(sF, 6 * i);
            sd.set(sG, 6 * i + 3);
            lam[i] = rope ? S.jog / Math.max(1e-9, len(sub(V[b], V[a]))) : 0;
        }
        // Where each node is along the polygon: between vertices a and b, t of the way.
        const A = [],
            B = [],
            T = [],
            put = (a, b, t) => {
                A.push(a);
                B.push(b);
                T.push(t);
            };
        const i0 = closed ? 0 : 1,
            i1 = closed ? nv - 1 : nv - 2;
        for (let i = i0; i <= i1; i++) {
            put(at(i), at(i), 0);
            if (!rope || (!closed && i === i1)) {
                continue;
            }
            for (let m = -ROPE; m <= ROPE; m++) {
                put(at(i), at(i + 1), 0.5 + lam[i] * (m / ROPE));
            }
        }
        // (A closed loop, but for a Petrie–Coxeter polyhedron's faces' own count, comes back to its first node.)
        const again = closed && A.length < l.pos3.length / 3;
        if (again) {
            put(A[0], B[0], T[0]);
        }
        l.strand = {
            ids: Int32Array.from(ids),
            closed,
            rope,
            again,
            sides: sd,
            lam,
            A: Int32Array.from(A),
            B: Int32Array.from(B),
            T: Float64Array.from(T)
        };
    };
    petrie.forEach(l => strandOf(l, true));
    faces.forEach(l => strandOf(l, false));
    return {
        center: c3,
        R,
        H,
        V,
        EDGES,
        FACES,
        flat3: Float64Array.from(V.flat()),
        flags,
        LOOPS: {
            petrie,
            cross: crossings.filter(x => x.length === 2),
            faces
        },
    };
};

// The symmetry of the blend sending each point of pairs to its partner (positions in space), or -1: its plane part from where the points' shadows go, its height part from their heights. proper: only a proper one.
export const blendSolve = (S, pairs, proper) => {
    const Gr = blendGroupOf(S),
        P = Gr.P;
    for (let a = 0; a < P.PG.length; a++) {
        const L2 = P.PG[a].L2,
            [p0, q0] = pairs[0];
        const m2 = p => [L2[0] * p[0] + L2[1] * p[1], L2[2] * p[0] + L2[3] * p[1]];
        const t2 = [q0[0] - m2(p0)[0], q0[1] - m2(p0)[1]];
        if (!pairs.every(([p, q]) => Math.hypot(m2(p)[0] + t2[0] - q[0], m2(p)[1] + t2[1] - q[1]) < 1e-6)) {
            continue;
        }
        const [i, j] = P.toLattice(t2);
        if (Math.abs(i - Math.round(i)) > 1e-5 || Math.abs(j - Math.round(j)) > 1e-5) {
            continue;
        }
        for (const s of [1, -1]) {
            const k = (q0[2] - s * p0[2]) / S.c;
            if (Math.abs(k - Math.round(k)) > 1e-5) {
                continue;
            }
            if (!pairs.every(([p, q]) => Math.abs(s * p[2] + Math.round(k) * S.c - q[2]) < 1e-6)) {
                continue;
            }
            const g = Gr.idx([a, Math.round(i), Math.round(j), s, Math.round(k)]);
            if (proper === null || Gr.G[g].proper === proper) {
                return g;
            }
        }
    }
    return -1;
};

// How a symmetry of a blend moves, in space: a turn about a vertical axis (rising, for a screw), a half-turn about a level line (sliding along it, for a screw), or, reversing orientation, a pass through a level plane (with a turn about a vertical axis) or through an upright one (with a slide). What to draw for it: an axis, a plane, a slide.
export const blendMotion = (Gr, h) => {
    const g = Gr.G[h],
        pl = g.planar,
        rise = g.k * Gr.c,
        z0 = rise / 2;
    const pr2 = pl.proper,
        squash = squashAcross;
    if (pr2 && g.s === 1) {
        if (pl.kind === 'id' || pl.kind === 'trans') {
            return {
                kind: g.k || pl.kind === 'trans' ? 'trans' : 'id',
                at: e => affine(I3, scale(g.t, e)),
                overlay: {
                    slide3: g.t
                },
                angle: 0
            };
        }
        const c = [pl.center[0], pl.center[1], 0];
        return {
            kind: g.k ? 'screw' : 'rot',
            angle: pl.angle,
            rise,
            at: e => compose(affine(I3, [0, 0, rise * e]), turnAbout3(c, [0, 0, 1], pl.angle * e)),
            overlay: {
                axis3: {
                    p: c,
                    u: [0, 0, 1]
                }
            }
        };
    }
    if (!pr2 && g.s === -1) {
        const p = [pl.p[0], pl.p[1], z0],
            u = pl.u;
        return {
            kind: pl.glide ? 'screw-level' : 'half-turn',
            angle: Math.PI,
            glide: pl.glide,
            at: e => compose(affine(I3, scale(u, pl.glide * e)), turnAbout3(p, u, Math.PI * e)),
            overlay: {
                axis3: {
                    p,
                    u
                }
            }
        };
    }
    if (pr2 && g.s === -1) {
        const sq = squash([0, 0, 1], [0, 0, z0]);
        if (pl.kind === 'id' || pl.kind === 'trans') {
            return {
                kind: pl.kind === 'trans' ? 'glide-level' : 'mirror-level',
                angle: 0,
                at: e => compose(affine(I3, scale([pl.t[0], pl.t[1], 0], e)), sq(e)),
                overlay: {
                    plane3: {
                        p: [0, 0, z0],
                        n: [0, 0, 1]
                    }
                }
            };
        }
        const c = [pl.center[0], pl.center[1], 0];
        return {
            kind: 'rotatory',
            angle: pl.angle,
            at: e => compose(turnAbout3(c, [0, 0, 1], pl.angle * e), sq(e)),
            overlay: {
                plane3: {
                    p: [c[0], c[1], z0],
                    n: [0, 0, 1]
                },
                axis3: {
                    p: c,
                    u: [0, 0, 1]
                }
            }
        };
    }
    const u = pl.u,
        n = [-u[1], u[0], 0],
        p = [pl.p[0], pl.p[1], 0],
        sq = squash(n, p);
    return {
        kind: pl.glide || g.k ? 'glide-upright' : 'mirror-upright',
        angle: 0,
        glide: pl.glide,
        at: e => compose(affine(I3, add(scale(u, pl.glide * e), [0, 0, rise * e])), sq(e)),
        overlay: {
            plane3: {
                p,
                n
            }
        }
    };
};

export const describeBlend = (Gr, h) => {
    const m = blendMotion(Gr, h),
        deg = Math.round(Math.abs(m.angle) * DEG);
    return {
        id: 'the identity',
        trans: 'a translation',
        rot: deg === 180 ? 'a half-turn about an upright axis' : `a rotation by ${deg}° about an upright axis`,
        screw: deg === 180 ? 'a screw motion: a half-turn about an upright axis, rising as it turns' : `a screw motion: a turn by ${deg}° about an upright axis, rising as it turns`,
        'half-turn': 'a half-turn about a level line',
        'screw-level': 'a screw motion: a half-turn about a level line, sliding along it',
        'mirror-level': 'a reflection in a level plane',
        'glide-level': 'a glide reflection in a level plane',
        rotatory: `a rotatory reflection: a turn by ${deg}° about an upright axis, then a reflection in the level plane square to it`,
        'mirror-upright': 'a reflection in an upright plane',
        'glide-upright': 'a glide reflection in an upright plane',
    } [m.kind];
};
