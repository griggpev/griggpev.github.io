// The planar polyhedra: the regular tilings and their Petrials.

import {
    add,
    cross2,
    DEG,
    dot,
    EPS,
    I3,
    len,
    mmul,
    mod,
    mvec,
    rotation,
    scale,
    stretch,
    sub,
    transpose,
    unit
} from './math.js';
import {
    DEFS
} from './solids.js';
import {
    cmpClasses,
    tellApart
} from './groups.js';
import {
    cornerOffset,
    goldenColor,
    hueColor,
    INSET,
    loopColor,
    ROPE,
    ROPE_J,
    ropeNodes,
    STRAND_IN,
} from './look.js';

// A tiling is infinite: what is drawn is a patch of it, made afresh around whatever part is in view, and seen through a disc of radius 1 (in model units) that fades at its rim. Coordinates are in the tiling's own units, the plane z = 0. Its symmetries are affine, x ↦ Lx + t, with L in the point group of a lattice and t a lattice vector, kept exactly as (the index of L, the integer coordinates of t). In space, a reflection of the plane in a line is the half-turn about that line, so every symmetry is a motion of space, and a reflection turns the tiling over.

const SQ3 = Math.sqrt(3);
export const SQ2 = Math.SQRT2;
export const TILE_HUES = 9;
const LATTICES = {
    square: {
        n: 4,
        b1: [1, 0, 0],
        b2: [0, 1, 0]
    },
    hex: {
        n: 6,
        b1: [1, 0, 0],
        b2: [0.5, SQ3 / 2, 0]
    },
};

// x ↦ Lx + t, as { L (3×3), t }.
export const affine = (L, t) => ({
    L,
    t
});
export const ID_AFFINE = affine(I3, [0, 0, 0]);
export const compose = (A, B) => affine(mmul(A.L, B.L), add(mvec(A.L, B.t), A.t));
export const applyAffine = (A, v) => add(mvec(A.L, v), A.t);
export const unapply = (A, y) => mvec(transpose(A.L), sub(y, A.t)); // A is a motion
export const turnAbout3 = (c, axis, t) => {
    const L = rotation(axis, t);
    return affine(L, sub(c, mvec(L, c)));
};
// A pass through the plane at p across n, as a squash: at e the space stretched by cos(πe) across it (flat at the half, reflected at the end).
export const squashAcross = (n, p) => e => {
    const L = stretch(n, Math.cos(Math.PI * e));
    return affine(L, sub(p, mvec(L, p)));
};

const latticeGroups = {};
export const latticeGroup = type => {
    if (latticeGroups[type]) {
        return latticeGroups[type];
    }
    const {
        n,
        b1,
        b2
    } = LATTICES[type];
    const det = b1[0] * b2[1] - b1[1] * b2[0];
    const toLattice = t => [(t[0] * b2[1] - t[1] * b2[0]) / det, (b1[0] * t[1] - b1[1] * t[0]) / det];
    const fromLattice = (i, j) => [i * b1[0] + j * b2[0], i * b1[1] + j * b2[1], 0];

    // The point group: rotations by 2πk/n, then the reflections. Each acts on lattice coordinates by an integer matrix Z.
    const PG = [];
    for (let k = 0; k < 2 * n; k++) {
        const th = (2 * Math.PI * (k % n)) / n,
            c = Math.cos(th),
            s = Math.sin(th);
        const proper = k < n;
        const L2 = proper ? [c, -s, s, c] : [c, s, s, -c];
        const im = v => toLattice([L2[0] * v[0] + L2[1] * v[1], L2[2] * v[0] + L2[3] * v[1]]);
        const z1 = im(b1),
            z2 = im(b2);
        PG.push({
            proper,
            L2,
            L: [L2[0], L2[1], 0, L2[2], L2[3], 0, 0, 0, proper ? 1 : -1],
            Z: [Math.round(z1[0]), Math.round(z2[0]), Math.round(z1[1]), Math.round(z2[1])],
            angle: proper ? Math.atan2(s, c) : 0,
            mirror: proper ? null : th / 2, // the mirror's direction
        });
    }
    const pgKey = L2 => L2.map(x => Math.round(x * 1e4)).join();
    const pgIndex = new Map(PG.map((P, a) => [pgKey(P.L2), a]));
    const pgMul = PG.map(A => PG.map(B => pgIndex.get(pgKey([
        A.L2[0] * B.L2[0] + A.L2[1] * B.L2[2], A.L2[0] * B.L2[1] + A.L2[1] * B.L2[3],
        A.L2[2] * B.L2[0] + A.L2[3] * B.L2[2], A.L2[2] * B.L2[1] + A.L2[3] * B.L2[3]
    ]))));
    const pgInv = PG.map((P, a) => pgMul[a].indexOf(0));

    // Elements as tuples [a, i, j], composed exactly.
    const zact = (a, i, j) => {
        const Z = PG[a].Z;
        return [Z[0] * i + Z[1] * j, Z[2] * i + Z[3] * j];
    };
    const tmul = ([a, i, j], [b, k, l]) => {
        const [x, y] = zact(a, k, l);
        return [pgMul[a][b], x + i, y + j];
    };
    const tinv = ([a, i, j]) => {
        const b = pgInv[a],
            [x, y] = zact(b, i, j);
        return [b, -x, -y];
    };
    const tkey = ([a, i, j]) => `${a},${i},${j}`;

    const G = [],
        index = new Map();
    const info = ([a, i, j]) => {
        const P = PG[a],
            t = fromLattice(i, j);
        const g = {
            a,
            i,
            j,
            L: P.L,
            t,
            proper: P.proper,
            M: affine(P.L, t)
        };
        if (P.proper) {
            if (Math.abs(P.angle) < EPS) {
                Object.assign(g, {
                    kind: i || j ? 'trans' : 'id',
                    axis: [0, 0, 1],
                    angle: 0
                });
            } else {
                // The center c: (I - L)c = t.
                const m = [1 - P.L2[0], -P.L2[1], -P.L2[2], 1 - P.L2[3]],
                    d = m[0] * m[3] - m[1] * m[2];
                const center = [(m[3] * t[0] - m[1] * t[1]) / d, (m[0] * t[1] - m[2] * t[0]) / d, 0];
                Object.assign(g, {
                    kind: 'rot',
                    center,
                    axis: [0, 0, 1],
                    angle: P.angle
                });
            }
        } else {
            // A reflection in the line through p along u, then a glide along it.
            const u = [Math.cos(P.mirror), Math.sin(P.mirror), 0],
                nrm = [-u[1], u[0], 0];
            const glide = dot(t, u);
            Object.assign(g, {
                kind: Math.abs(glide) < EPS ? 'refl' : 'glide',
                u,
                p: scale(nrm, dot(t, nrm) / 2),
                glide,
                axis: u,
                angle: Math.PI
            });
        }
        return g;
    };
    const idx = tuple => {
        const k = tkey(tuple);
        if (!index.has(k)) {
            index.set(k, G.length);
            G.push(info(tuple));
        }
        return index.get(k);
    };
    const tupleOf = x => [G[x].a, G[x].i, G[x].j];

    // First the symmetries that move the origin at most one lattice step, rotations (and translations) first: the ones listed in Figure 3. The origin is always a vertex or the center of a face, with all of the point group fixing it, so the two halves are the same size.
    const near = [];
    const K = 2;
    for (let i = -K; i <= K; i++) {
        for (let j = -K; j <= K; j++) {
            if (len(fromLattice(i, j)) < 1 + EPS) {
                near.push([i, j]);
            }
        }
    }
    near.sort((x, y) => len(fromLattice(...x)) - len(fromLattice(...y)) || Math.atan2(fromLattice(...x)[1], fromLattice(...x)[0]) - Math.atan2(fromLattice(...y)[1], fromLattice(...y)[0]));
    for (const proper of [true, false]) {
        for (const [i, j] of near) {
            PG.forEach((P, a) => {
                if (P.proper === proper) {
                    idx([a, i, j]);
                }
            });
        }
    }
    const R = G.length / 2;

    // The symmetry x ↦ Lx + t for a 2D linear part L2 and translation t, or -1.
    const lookup = (L2, t) => {
        const a = pgIndex.get(pgKey(L2));
        if (a === undefined) {
            return -1;
        }
        const [i, j] = toLattice(t);
        if (Math.abs(i - Math.round(i)) > 1e-4 || Math.abs(j - Math.round(j)) > 1e-4) {
            return -1;
        }
        return idx([a, Math.round(i), Math.round(j)]);
    };

    latticeGroups[type] = {
        planar: true,
        type,
        n,
        PG,
        G,
        R,
        index,
        tmul,
        tinv,
        tkey,
        tupleOf,
        idx,
        lookup,
        fromLattice,
        toLattice,
        mul: (x, y) => idx(tmul(tupleOf(x), tupleOf(y))),
        inv: x => idx(tinv(tupleOf(x))),
        find: M => {
            const L2 = [M.L[0], M.L[1], M.L[3], M.L[4]];
            const i = lookup(L2, M.t);
            return i < 0 ? 0 : i;
        },
    };
    return latticeGroups[type];
};

// The regular tilings: squares and triangles of edge 1, and hexagons of edge 1/√3, the triangles' duals, centered on the triangular lattice. cells: the faces at each lattice point, counterclockwise. phases: where the tiling sits on its lattice (the square tiling's dual is itself, moved by half a square), and dual: the dual's phase from each.
const TILINGS = {
    square: {
        lattice: 'square',
        edge: 1,
        cells: [
            [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1]
            ]
        ],
        phases: [
            [0, 0],
            [0.5, 0.5]
        ],
        dual: [1, 0]
    },
    triangular: {
        lattice: 'hex',
        edge: 1,
        phases: [
            [0, 0]
        ],
        dual: [0],
        cells: [
            [
                [0, 0],
                [1, 0],
                [0.5, SQ3 / 2]
            ],
            [
                [1, 0],
                [1.5, SQ3 / 2],
                [0.5, SQ3 / 2]
            ]
        ],
    },
    hexagonal: {
        lattice: 'hex',
        edge: 1 / SQ3,
        phases: [
            [0, 0]
        ],
        dual: [0],
        cells: [Array.from({
            length: 6
        }, (x, k) => [Math.cos(Math.PI / 6 + (k * Math.PI) / 3) / SQ3, Math.sin(Math.PI / 6 + (k * Math.PI) / 3) / SQ3])],
    },
};

const key2 = p => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
// Points that are one up to rounding, as one: by the nearest point of a fine grid, and, for a point that falls near the middle between two grid points (as the heights k/(2√3) do, at 1e4 a half apart), by its neighbors there too. index(p) is p's number, new or found.
const pointIndex = dims => {
    const map = new Map(),
        pts = [];
    const offs = [];
    for (let m = 0; m < 3 ** dims; m++) {
        const o = [];
        for (let d = 0, r = m; d < dims; d++, r = Math.floor(r / 3)) {
            o.push((r % 3) - 1);
        }
        if (o.some(x => x)) {
            offs.push(o);
        }
    }
    const index = p => {
        const q = [];
        for (let d = 0; d < dims; d++) {
            q.push(Math.round(p[d] * 1e4));
        }
        const k = q.join();
        if (map.has(k)) {
            return map.get(k);
        }
        for (const o of offs) {
            const i = map.get(q.map((x, d) => x + o[d]).join());
            if (i !== undefined) {
                let d2 = 0;
                for (let d = 0; d < dims; d++) {
                    d2 += (pts[i][d] - p[d]) ** 2;
                }
                if (d2 < 1e-12) {
                    return i;
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
// A tiling's faces take TILE_HUES hues, the face at lattice point (i, j) (its w-th cell there) the (2i + 5j + 7w)-th: faces sharing an edge always differ, in all three tilings, and by at least 80° of hue.

// A loop's nodes as flat arrays, positions (fb) and inset offsets (fo), so that drawing it is arithmetic on numbers.
export const flatten = loop => {
    const nd = loop.nodes,
        n = nd.length,
        fb = new Float64Array(2 * n),
        fo = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
        fb[2 * i] = nd[i].base[0];
        fb[2 * i + 1] = nd[i].base[1];
        fo[2 * i] = nd[i].off[0];
        fo[2 * i + 1] = nd[i].off[1];
    }
    loop.fb = fb;
    loop.fo = fo;
    return loop;
};

// The faces of the tiling with centers within R of the point c, and from them its vertices, edges and Petrie polygons (zigzags, cut off where the patch ends), and the loops that draw them.
export const patchOf = (S, c, R, keep = null) => {
    const T = S.tiling,
        {
            b1,
            b2
        } = S.lattice,
        off = T.phases[S.phase];
    const det = b1[0] * b2[1] - b1[1] * b2[0];
    const ci = ((c[0] - off[0]) * b2[1] - (c[1] - off[1]) * b2[0]) / det;
    const cj = (b1[0] * (c[1] - off[1]) - b1[1] * (c[0] - off[0])) / det;
    const K = Math.ceil(R / 0.85) + 2;
    const V = [],
        FACES = [],
        at2 = pointIndex(2);
    const vert = p => {
        const i = at2.index(p);
        if (i === V.length) {
            V.push([p[0], p[1], 0]);
        }
        return i;
    };
    for (let i = Math.floor(ci) - K; i <= Math.ceil(ci) + K; i++) {
        for (let j = Math.floor(cj) - K; j <= Math.ceil(cj) + K; j++) {
            const x = off[0] + i * b1[0] + j * b2[0],
                y = off[1] + i * b1[1] + j * b2[1];
            T.cells.forEach((cell, w) => {
                const pts = cell.map(o => [x + o[0], y + o[1]]);
                const ctr = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length, 0];
                const hue = mod(2 * i + 5 * j + 7 * w, TILE_HUES);
                // (key: a name for the face that outlasts the patch, for Control-F.)
                if (keep ? keep(ctr) : Math.hypot(ctr[0] - c[0], ctr[1] - c[1]) <= R) {
                    FACES.push({
                        ids: pts.map(vert),
                        center: ctr,
                        hue,
                        key: `t${Math.round(ctr[0] * 1000)},${Math.round(ctr[1] * 1000)}`
                    });
                }
            });
        }
    }
    const EDGES = [],
        edgeIndex = new Map(),
        leftOf = new Map();
    FACES.forEach((f, k) => f.ids.forEach((a, m) => {
        const b = f.ids[(m + 1) % f.ids.length];
        leftOf.set(`${a},${b}`, k);
        if (!edgeIndex.has(`${a},${b}`)) {
            edgeIndex.set(`${a},${b}`, EDGES.length);
            edgeIndex.set(`${b},${a}`, EDGES.length);
            EDGES.push(a < b ? [a, b] : [b, a]);
        }
    }));
    const EDGE_FACES = EDGES.map(([a, b]) => [leftOf.get(`${a},${b}`), leftOf.get(`${b},${a}`)].filter(k => k !== undefined));

    // Zigzags, turning left and right in turn, as on a finite polyhedron. Which zigzag runs along an edge is told by the turn it takes at the edge's far end, which comes out the same whichever way it is run.
    const along = (k, v, d) => {
        const ids = FACES[k].ids,
            m = ids.indexOf(v);
        return ids[(m + d + ids.length) % ids.length];
    };
    const seen = new Set();
    const walk = (a, b, left) => {
        const vs = [],
            fs = [];
        let prev = a,
            cur = b,
            l = left;
        for (let guard = 0; guard < 400; guard++) {
            seen.add(`${edgeIndex.get(`${prev},${cur}`)},${l}`);
            const k = l ? leftOf.get(`${prev},${cur}`) : leftOf.get(`${cur},${prev}`);
            if (k === undefined) {
                break;
            }
            const next = along(k, cur, l ? 1 : -1);
            fs.push(k);
            vs.push(next);
            prev = cur;
            cur = next;
            l = !l;
        }
        return {
            vs,
            fs
        };
    };
    const PETRIE = [];
    EDGES.forEach(([a, b], e) => [true, false].forEach(left => {
        if (seen.has(`${e},${left}`)) {
            return;
        }
        const fw = walk(a, b, left),
            bw = walk(b, a, left);
        const verts = [...[...bw.vs].reverse(), a, b, ...fw.vs];
        const turns = [...bw.vs.map((v, i) => (i + 1 < bw.fs.length ? bw.fs[i + 1] : -1)).reverse(),
            bw.fs.length ? bw.fs[0] : -1, fw.fs.length ? fw.fs[0] : -1, ...fw.vs.map((v, i) => (i + 1 < fw.fs.length ? fw.fs[i + 1] : -1))
        ];
        if (verts.length >= 5) {
            PETRIE.push({
                verts,
                turns
            });
        }
    }));

    // Where each zigzag lies: its direction (to the nearest 15°, mod 180°) and its offset from the origin, which name it (key).
    PETRIE.forEach(z => {
        const p0 = V[z.verts[0]],
            p1 = V[z.verts[z.verts.length - 1]];
        const dir = mod(Math.round(Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) / (Math.PI / 12)), 12);
        const th = (dir * Math.PI) / 12,
            u = [Math.cos(th), Math.sin(th)];
        const offs = z.verts.map(v => u[0] * V[v][1] - u[1] * V[v][0]);
        z.offset = (Math.min(...offs) + Math.max(...offs)) / 2;
        z.dir = dir;
        z.family = dir % 6;
        z.key = Math.round(z.offset * 8) + 101 * dir;
        z.dist = Math.abs(u[0] * c[1] - u[1] * c[0] - z.offset);
    });

    // Their colors. Two zigzags that cross run in different directions, so each direction has hues of its own, interleaved with the others' (six in all, 60° apart), and side by side, parallel zigzags take their direction's hues in turn. The spacing of each direction's zigzags is read once, from the first patch made.
    if (!S.zig) {
        const by = new Map();
        PETRIE.forEach(z => {
            if (!by.has(z.dir)) {
                by.set(z.dir, []);
            }
            by.get(z.dir).push(z.offset);
        });
        const dirs = [...by.keys()].sort((a, b) => a - b);
        S.zig = {};
        dirs.forEach((dir, f) => {
            const o = [...new Set(by.get(dir).map(x => Math.round(x * 1e4) / 1e4))].sort((a, b) => a - b);
            let delta = Infinity;
            for (let i = 1; i < o.length; i++) {
                delta = Math.min(delta, o[i] - o[i - 1]);
            }
            S.zig[dir] = {
                f,
                n: dirs.length,
                delta,
                phase: o[0] / delta - Math.floor(o[0] / delta)
            };
        });
    }
    PETRIE.forEach(z => {
        const zf = S.zig[z.dir];
        if (!zf || !Number.isFinite(zf.delta)) {
            z.color = goldenColor(z.key);
            return;
        }
        const per = Math.round(6 / zf.n),
            idx = Math.round(z.offset / zf.delta - zf.phase);
        z.color = hueColor(35 + 60 * (mod(idx, per) * zf.n + zf.f));
    });

    const corner = (k, v) => {
        const ids = FACES[k].ids;
        return cornerOffset(ids.map(i => V[i]), ids.indexOf(v));
    };
    const inward = (k, a, b) => {
        const pa = V[a],
            pb = V[b],
            u = unit(sub(pb, pa)),
            d = sub(FACES[k].center, scale(add(pa, pb), 0.5));
        return unit(sub(d, scale(u, dot(d, u))));
    };
    const lift = z => [0, 0, 0.002 * (1 + z.family)]; // over and under where zigzags cross
    const petrie = PETRIE.map(z => {
        const nodes = [],
            {
                verts,
                turns
            } = z,
            up = lift(z);
        for (let i = 1; i < verts.length - 1; i++) {
            const v = verts[i],
                F = turns[i];
            nodes.push({
                base: add(V[v], up),
                off: scale(corner(F, v), STRAND_IN)
            });
            if (i + 1 < verts.length - 1) {
                const w = verts[i + 1];
                nodes.push(...ropeNodes(V[v], V[w], inward(F, v, w), inward(turns[i + 1], v, w), S.jog, up, STRAND_IN));
            }
        }
        return {
            nodes,
            open: true,
            color: z.color,
            dist: z.dist,
            key: z.key
        };
    });
    const cross = EDGES.map(() => []);
    PETRIE.forEach((z, k) => {
        for (let i = 1; i < z.verts.length - 2; i++) {
            const v = V[z.verts[i]],
                w = V[z.verts[i + 1]],
                x = V[z.verts[i + 2]];
            cross[edgeIndex.get(`${z.verts[i]},${z.verts[i + 1]}`)].push({
                loop: k,
                j: (i - 1) * (2 * ROPE + 2) + 1 + ROPE,
                left: cross2(sub(w, v), sub(x, w)) > 0
            });
        }
    });

    const faces = FACES.map(f => {
        const pts = f.ids.map(i => V[i]);
        return {
            nodes: f.ids.map((v, j) => ({
                base: V[v],
                off: cornerOffset(pts, j)
            })),
            color: loopColor(f.hue, TILE_HUES),
            dist: len(sub(f.center, c))
        };
    });

    // The dual's faces, around each vertex that has all its faces here, through their centers in turn.
    const around = V.map(() => []);
    FACES.forEach((f, k) => f.ids.forEach(v => around[v].push(k)));
    const dual = [];
    around.forEach((ks, v) => {
        if (ks.length !== S.qn) {
            return;
        }
        const ang = k => Math.atan2(FACES[k].center[1] - V[v][1], FACES[k].center[0] - V[v][0]);
        const pts = [...ks].sort((x, y) => ang(x) - ang(y)).map(k => FACES[k].center);
        dual.push({
            nodes: pts.map((q, j) => ({
                base: q,
                off: cornerOffset(pts, j)
            })),
            color: goldenColor(v),
            dist: len(sub(V[v], c))
        });
    });

    [petrie, faces, dual].forEach(set => set.forEach(flatten));
    return {
        center: c,
        R,
        V,
        EDGES,
        FACES,
        EDGE_FACES,
        edgeIndex,
        PETRIE,
        LOOPS: {
            petrie,
            cross: cross.filter(x => x.length === 2),
            faces,
            dual
        },
        flatV: Float64Array.from(V.flatMap(v => [v[0], v[1]])),
    };
};

// A planar polyhedron, at one of its tiling's phases.
export const buildPlanar = (name, phase) => {
    const def = DEFS[name],
        T = TILINGS[def.planar];
    const S = {
        name,
        def,
        title: def.title,
        planar: true,
        convex: false,
        phase,
        tiling: T,
        lattice: LATTICES[T.lattice],
        zoom: def.zoom,
        edge: T.edge,
        inset: INSET / def.zoom,
        jog: Math.min(ROPE_J / def.zoom, 0.25 * T.edge),
        pn: Number(def.p),
        qn: Number(def.q),
        q0: [1, 0, 0, 0],
        dualPhase: T.dual[phase],
    };
    // A patch near the origin, to say what lies where.
    const ref = patchOf(S, [0, 0, 0], 4.5);
    const keys = list => new Set(list.map(key2));
    const at = {
        v: keys(ref.V),
        f: keys(ref.FACES.map(f => f.center)),
        e: keys(ref.EDGES.map(([i, j]) => scale(add(ref.V[i], ref.V[j]), 0.5))),
    };
    S.pointKind = p => (at.v.has(key2(p)) ? 'v' : at.f.has(key2(p)) ? 'f' : at.e.has(key2(p)) ? 'e' : null);
    // What a line (through p, along u) runs along or through.
    S.lineKind = (p, u) => {
        const n = [-u[1], u[0], 0],
            on = x => Math.abs(dot(sub(x, p), n)) < 1e-6;
        if (ref.EDGES.some(([i, j]) => on(ref.V[i]) && on(ref.V[j]))) {
            return ['along edges', 'along edges'];
        }
        if (ref.V.some(on)) {
            return ['through vertices', 'through vertices'];
        }
        if (ref.EDGES.some(([i, j]) => on(scale(add(ref.V[i], ref.V[j]), 0.5)))) {
            return ['through midpoints', 'through the midpoints of edges'];
        }
        return ['', 'missing every vertex and edge midpoint'];
    };
    // The base flag: the vertex nearest the origin, its edge heading most nearly rightward, and the face to the left of that edge.
    const nearest = [...ref.V.keys()].sort((x, y) => len(sub(ref.V[x], [0.01, 0.02, 0])) - len(sub(ref.V[y], [0.01, 0.02, 0])))[0];
    const nbrs = ref.EDGES.filter(e => e.includes(nearest)).map(([i, j]) => (i === nearest ? j : i));
    const ang = w => {
        const d = sub(ref.V[w], ref.V[nearest]);
        return (Math.atan2(d[1], d[0]) + 2 * Math.PI + 1e-6) % (2 * Math.PI);
    };
    const other = nbrs.sort((x, y) => ang(x) - ang(y))[0];
    const face = ref.FACES.find(f => {
        const m = f.ids.indexOf(nearest);
        return m >= 0 && f.ids[(m + 1) % f.ids.length] === other;
    });
    const m = face.ids.indexOf(nearest);
    S.flag = {
        v: ref.V[nearest],
        o: ref.V[other],
        prev: ref.V[face.ids[(m + face.ids.length - 1) % face.ids.length]],
        c: face.center
    };
    return S;
};

// A length, in edges, as a surd: 1, √2, √3/2.
const surd = l => {
    const r = l * l;
    for (let q = 1; q <= 12; q++) {
        const p = Math.round(r * q);
        if (Math.abs(r * q - p) > 1e-6) {
            continue;
        }
        let a = 1,
            b = p * q;
        for (let k = 2; k * k <= b; k++) {
            while (b % (k * k) === 0) {
                b /= k * k;
                a *= k;
            }
        }
        const gcd = (x, y) => (y ? gcd(y, x % y) : x),
            g = gcd(a, q);
        const num = `${a / g === 1 && b !== 1 ? '' : a / g}${b === 1 ? '' : `√${b}`}`;
        return q / g === 1 ? num : `${num}/${q / g}`;
    }
    return l.toFixed(2);
};
const edgesWords = l => {
    const s = surd(l);
    return s === '1' ? 'one edge length' : s === '1/2' ? 'half an edge length' : `${s} edge lengths`;
};

export const describePlanar = (S, Gr, i, F = 'face') => {
    const g = Gr.G[i];
    if (g.kind === 'id') {
        return {
            label: 'identity',
            text: 'the identity',
            sort: [0, 0, 0, 0]
        };
    }
    if (g.kind === 'trans') {
        const l = len(g.t) / S.edge;
        return {
            label: `translations, ${surd(l)}`,
            text: `a translation by ${edgesWords(l)}`,
            sort: [0, 2, l, 0]
        };
    }
    if (g.kind === 'rot') {
        const at = S.pointKind(g.center);
        const [word, where] = at === 'v' ? ['vertex', 'a vertex'] : at === 'e' ? ['edge', 'the midpoint of an edge'] : [F, `the center of a ${F}`];
        const deg = Math.round(Math.abs(g.angle) * DEG),
            hand = g.angle > 0 ? 'counterclockwise' : 'clockwise';
        // As for the finite polyhedra, by the order of the center, then by where it is.
        const fold = at === 'v' ? S.qn : at === 'f' ? S.pn : 2,
            rank = {
                v: 0,
                f: 1,
                e: 2
            } [at] || 3;
        return deg === 180 ?
            {
                label: `${word} half-turns`,
                text: `a half-turn about ${where}`,
                sort: [0, 1, fold, rank, deg]
            } :
            {
                label: `${word} turns, ${deg}°`,
                text: `a rotation by ${deg}° about ${where}`,
                sort: [0, 1, fold, rank, deg],
                hand,
                handText: `, ${hand}`
            };
    }
    const [short, where] = S.lineKind(g.p, g.u);
    if (g.kind === 'refl') {
        return {
            label: 'mirrors',
            short,
            text: `a reflection in a mirror line ${where}`,
            sort: [1, 1, 0, 0]
        };
    }
    const l = Math.abs(g.glide) / S.edge;
    return {
        label: `glides, ${surd(l)}`,
        short,
        text: `a glide reflection: a reflection in a line ${where}, then a translation by ${edgesWords(l)} along it`,
        sort: [1, 2, l, 0],
    };
};

// Conjugacy classes of the whole group, met among the first n elements (Figure 3's): conjugating by the symmetries near the middle is enough, since any conjugate of one of these that is also one of these comes from one of them. With rotations only, conjugate by rotations only.
export const planarClasses = (S, Gr, n, F = 'face') => {
    const H = [];
    for (let i = -4; i <= 4; i++) {
        for (let j = -4; j <= 4; j++) {
            if (len(Gr.fromLattice(i, j)) > 3.2) {
                continue;
            }
            Gr.PG.forEach((P, a) => {
                if (n > Gr.R || P.proper) {
                    H.push([a, i, j]);
                }
            });
        }
    }
    const owner = new Array(n).fill(-1),
        list = [];
    for (let g = 0; g < n; g++) {
        if (owner[g] >= 0) {
            continue;
        }
        const tg = Gr.tupleOf(g),
            members = new Set();
        for (const h of H) {
            const x = Gr.index.get(Gr.tkey(Gr.tmul(Gr.tmul(h, tg), Gr.tinv(h))));
            if (x !== undefined && x < n) {
                members.add(x);
            }
        }
        const k = list.length;
        members.forEach(x => {
            owner[x] = k;
        });
        list.push({
            members: [...members].sort((a, b) => a - b),
            ...describePlanar(S, Gr, g, F)
        });
    }
    tellApart(list);
    list.sort(cmpClasses);
    list.forEach((c, k) => c.members.forEach(x => {
        owner[x] = k;
    }));
    return {
        list,
        owner
    };
};
