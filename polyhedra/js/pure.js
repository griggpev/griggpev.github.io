// The 12 pure polyhedra.
// All come from the cubical honeycomb {4,3,4} (McMullen and Schulte). Its generating reflections S0, …, S3, and every product of them, are kept exactly, as tuples [p0, p1, p2, s0, s1, s2, t0, t1, t2] for the motion x ↦ (s_i x_{p_i})_i + t (a signed permutation of the axes, then a whole translation). The Petrie–Coxeter polyhedron {4,6|4} is (S0, S1S3, S2), and the rest follow from it by the operations (as in Figure 2), applied in order: π the Petrial, δ the dual, η halving, φ facetting.

import {
    add,
    clamp,
    cross,
    DEG,
    det3,
    dot,
    I3,
    len,
    mmul,
    mvec,
    qaxis,
    qmul,
    qnorm,
    scale,
    solve3,
    sub,
    transpose,
    unit,
} from './math.js';
import {
    DEFS
} from './solids.js';
import {
    affine,
    compose,
    ID_AFFINE,
    squashAcross,
    turnAbout3
} from './planar.js';
import {
    blendMotion,
    blendSolve,
    placeFlag
} from './blend.js';
import {
    INSET,
    ROPE_J
} from './look.js';

const SP_ID = [0, 1, 2, 1, 1, 1, 0, 0, 0];
const spMul = (a, b) => [b[a[0]], b[a[1]], b[a[2]], a[3] * b[3 + a[0]], a[4] * b[3 + a[1]], a[5] * b[3 + a[2]],
    a[3] * b[6 + a[0]] + a[6], a[4] * b[6 + a[1]] + a[7], a[5] * b[6 + a[2]] + a[8]
];
const spInv = a => {
    const r = SP_ID.slice();
    for (let i = 0; i < 3; i++) {
        r[a[i]] = i;
        r[3 + a[i]] = a[3 + i];
    }
    for (let j = 0; j < 3; j++) {
        r[6 + j] = -r[3 + j] * a[6 + r[j]];
    }
    return r;
};
const spAct = (a, x) => [a[3] * x[a[0]] + a[6], a[4] * x[a[1]] + a[7], a[5] * x[a[2]] + a[8]];
const spL = a => {
    const L = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 3; i++) {
        L[3 * i + a[i]] = a[3 + i];
    }
    return L;
};
const spOf = M => {
    const t = SP_ID.slice();
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            if (Math.abs(M.L[3 * i + j]) > 0.5) {
                t[i] = j;
                t[3 + i] = Math.sign(M.L[3 * i + j]);
            }
        }
        t[6 + i] = Math.round(M.t[i]);
    }
    return t;
};
const HONEYCOMB = [
    [0, 1, 2, -1, 1, 1, 1, 0, 0],
    [1, 0, 2, 1, 1, 1, 0, 0, 0],
    [0, 2, 1, 1, 1, 1, 0, 0, 0],
    [0, 1, 2, 1, 1, -1, 0, 0, 0]
];
const PURE_OPS = {
    'π': ([a, b, c]) => [spMul(a, c), b, c],
    'δ': ([a, b, c]) => [c, b, a],
    'η': ([a, b, c]) => [spMul(spMul(a, b), a), c, b],
    'φ': ([a, b, c]) => [a, spMul(spMul(b, c), b), c],
};
const pureGens = word => [...word].reduce((R, o) => PURE_OPS[o](R), [HONEYCOMB[0], spMul(HONEYCOMB[1], HONEYCOMB[3]), HONEYCOMB[2]]);
const PURE_ZOOM = 0.72;
const PURE_VIEW = qnorm(qmul(qaxis([1, 0, 0], -0.52), qmul(qaxis([0, 1, 0], 0.61), qaxis([0, 0, 1], 0.23))));

const pureGroups = {};
export const pureGroupOf = S => {
    if (pureGroups[S.key]) {
        return pureGroups[S.key];
    }
    const G = [],
        index = new Map();
    const info = t => {
        const L = spL(t),
            tt = [t[6], t[7], t[8]];
        return {
            tuple: t,
            L,
            t: tt,
            M: affine(L, tt),
            proper: det3(L) > 0
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
    const Gr = {
        spatial: true,
        pure: true,
        G,
        index,
        idx,
        tupleOf,
        tmul: spMul,
        tinv: spInv,
        act: spAct,
        mul: (x, y) => idx(spMul(tupleOf(x), tupleOf(y))),
        inv: x => idx(spInv(tupleOf(x))),
        find: M => idx(spOf(M)),
    };
    idx(SP_ID);
    pureGroups[S.key] = Gr;
    return Gr;
};

// The point fixed by the motions (exactly, by least squares on (L − I)x = −t).
const fixedBy = (...ts) => {
    const A = [],
        b = [];
    ts.forEach(t => {
        const L = spL(t);
        for (let i = 0; i < 3; i++) {
            A.push([0, 1, 2].map(j => L[3 * i + j] - (i === j ? 1 : 0)));
            b.push(-t[6 + i]);
        }
    });
    const N = [0, 1, 2].map(i => [0, 1, 2].map(j => A.reduce((u, r) => u + r[i] * r[j], 0))),
        y = [0, 1, 2].map(i => A.reduce((u, r, k) => u + r[i] * b[k], 0));
    return solve3(N.flat(), y);
};

export const buildPure = name => {
    const def = DEFS[name],
        R = pureGens(def.pure.word),
        [, T1, T2] = R;
    // (Its title: its name, or for the unnamed ones its symbol, in words.)
    const plain = def.sym.replace(/&nbsp;/g, ' ').replace(/<\/?su[bp]>/g, '');
    // (Seen at rest from a direction along no plane of the lattice, so no face shows edge-on.)
    const S = {
        name,
        def,
        title: def.title || `pure polyhedron ${plain}`,
        pure: true,
        spatial: true,
        key: name,
        home: name,
        q: 'seg',
        zoom: def.pure.zoom || PURE_ZOOM,
        q0: PURE_VIEW
    };
    const Gr = pureGroupOf(S);
    S.Tt = R;
    S.T = R.map(t => Gr.idx(t));
    // The base flag (see placeFlag), its vertex the one fixed by T1 and T2.
    const sig = placeFlag(S, Gr, fixedBy(T1, T2));
    S.edge = len(sub(S.u1, S.u0));
    // Its face's vertices (per turn, for a helix).
    let x = S.u1,
        pn = 1;
    while (pn < 13 && len(sub(x, S.u0)) > 1e-9) {
        x = spAct(sig, x);
        pn++;
    }
    S.pn = pn < 13 ? pn : (() => {
        let L = spL(sig),
            M = L,
            k = 1;
        while (k < 13 && M.some((v, i) => Math.abs(v - I3[i]) > 1e-9)) {
            M = mmul(M, L);
            k++;
        }
        return k;
    })();
    S.inset = INSET / S.zoom;
    S.jog = Math.min(ROPE_J / S.zoom, 0.25 * S.edge);
    // Its faces planar (the Petrie–Coxeter polyhedra) or not.
    const face = [S.u0, S.u1, S.u2, S.u3, spAct(sig, S.u3)],
        nrm = cross(sub(face[1], face[0]), sub(face[2], face[0]));
    S.flatFaces = face.every(q => Math.abs(dot(nrm, sub(q, face[0]))) < 1e-9);
    // The symmetries near the base vertex, for random moves, and the translations among them, a basis of which starts a patch anywhere.
    const near = new Map([
            [SP_ID.join(), SP_ID]
        ]),
        trans = [];
    let frontier = [SP_ID];
    for (let depth = 0; depth < 16; depth++) {
        const next = [];
        frontier.forEach(t => R.forEach(g => {
            const h = spMul(t, g),
                k = h.join();
            if (near.has(k) || len(sub(spAct(h, S.u0), S.u0)) > 4.5 * Math.max(1, S.edge)) {
                return;
            }
            near.set(k, h);
            next.push(h);
            if (h[0] === 0 && h[1] === 1 && h[2] === 2 && h[3] === 1 && h[4] === 1 && h[5] === 1 && (h[6] || h[7] || h[8])) {
                trans.push([h[6], h[7], h[8]]);
            }
        }));
        frontier = next;
    }
    trans.sort((a, b) => len(a) - len(b));
    const basis = [trans[0]];
    for (const t of trans) {
        if (basis.length === 1 && len(cross(basis[0], t)) > 1e-9) {
            basis.push(t);
        } else if (basis.length === 2 && Math.abs(dot(cross(basis[0], basis[1]), t)) > 1e-9) {
            basis.push(t);
            break;
        }
    }
    S.lattice3 = basis;
    const pool = [...near.values()].filter(h => len(sub(spAct(h, S.u0), S.u0)) <= 1.05 * S.edge + 1e-9).map(h => Gr.idx(h));
    Gr.pool = {
        all: pool,
        rotations: pool.filter(g => Gr.G[g].proper)
    };
    return S;
};
// The translation of a pure polyhedron's lattice carrying u0 nearest c.
export const pureStart = (S, c) => {
    const [a, b, d] = S.lattice3, M = [a[0], b[0], d[0], a[1], b[1], d[1], a[2], b[2], d[2]], w = sub(c, S.u0);
    const k = solve3(M, w).map(Math.round);
    const t = add(add(scale(a, k[0]), scale(b, k[1])), scale(d, k[2]));
    return [0, 1, 2, 1, 1, 1, t[0], t[1], t[2]];
};

// The symmetry of a pure polyhedron sending each point of pairs to its partner, or -1: a signed permutation of the axes and a whole translation.
const PERMS = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0]
];
const spaceSolve = (S, pairs, proper = null) => {
    const Gr = pureGroupOf(S),
        [p0, q0] = pairs[0];
    for (const p of PERMS) {
        for (let m = 0; m < 8; m++) {
            const sg = [m & 1 ? -1 : 1, m & 2 ? -1 : 1, m & 4 ? -1 : 1],
                L = [...p, ...sg, 0, 0, 0];
            const lp = spAct(L, p0),
                t = sub(q0, lp);
            if (t.some(x => Math.abs(x - Math.round(x)) > 1e-6)) {
                continue;
            }
            const tup = [...p, ...sg, ...t.map(Math.round)];
            if (!pairs.every(([a, b]) => len(sub(spAct(tup, a), b)) < 1e-6)) {
                continue;
            }
            const g = Gr.idx(tup);
            if (proper === null || Gr.G[g].proper === proper) {
                return g;
            }
        }
    }
    return -1;
};

// How a motion of space moves (any isometry, x ↦ Lx + t): a turn about an axis (sliding along it, for a screw); or, reversing orientation, a pass through a plane (sliding along it, for a glide), through a point (an inversion), or through a plane while turning about the axis square to it (a rotatory reflection). What to draw for it: an axis, a plane, a slide.
const spaceMotion = (Gr, h) => {
    const g = Gr.G[h],
        L = g.L,
        t = g.t,
        tr = L[0] + L[4] + L[8];
    const squash = squashAcross;
    const col = (B, j) => [B[j], B[3 + j], B[6 + j]];
    const widest = B => [0, 1, 2].map(j => col(B, j)).reduce((u, v) => (len(v) > len(u) ? v : u));
    if (g.proper) {
        if (tr > 3 - 1e-9) {
            return len(t) < 1e-9 ? {
                kind: 'id',
                angle: 0,
                at: () => ID_AFFINE,
                overlay: {}
            } : {
                kind: 'trans',
                angle: 0,
                at: e => affine(I3, scale(t, e)),
                overlay: {
                    slide3: t
                }
            };
        }
        const ang = Math.acos(clamp((tr - 1) / 2, -1, 1));
        const u = ang < Math.PI - 1e-6 ? unit([L[7] - L[5], L[2] - L[6], L[3] - L[1]]) : unit(widest([L[0] + 1, L[1], L[2], L[3], L[4] + 1, L[5], L[6], L[7], L[8] + 1]));
        const slide = dot(t, u),
            tp = sub(t, scale(u, slide));
        // The axis: the point p square to u with (I − L)p = tp.
        const A = [1 - L[0], -L[1], -L[2], -L[3], 1 - L[4], -L[5], -L[6], -L[7], 1 - L[8]],
            At = transpose(A);
        const N = mmul(At, A).map((x, k) => x + u[Math.floor(k / 3)] * u[k % 3]),
            p = solve3(N, mvec(At, tp));
        return {
            kind: Math.abs(slide) > 1e-9 ? 'screw' : 'rot',
            angle: ang,
            rise: slide,
            at: e => compose(affine(I3, scale(u, slide * e)), turnAbout3(p, u, ang * e)),
            overlay: {
                axis3: {
                    p,
                    u
                }
            }
        };
    }
    const ang = Math.acos(clamp((tr + 1) / 2, -1, 1));
    if (ang < 1e-6) {
        const n = unit(widest([1 - L[0], -L[1], -L[2], -L[3], 1 - L[4], -L[5], -L[6], -L[7], 1 - L[8]])),
            p = scale(n, dot(t, n) / 2),
            glide = sub(t, scale(n, dot(t, n)));
        return {
            kind: len(glide) > 1e-9 ? 'glide' : 'mirror',
            angle: 0,
            at: e => compose(affine(I3, scale(glide, e)), squash(n, p)(e)),
            overlay: {
                plane3: {
                    p,
                    n
                }
            }
        };
    }
    if (ang > Math.PI - 1e-6) {
        const c = scale(t, 0.5);
        return {
            kind: 'inversion',
            angle: Math.PI,
            at: e => {
                const k = Math.cos(Math.PI * e);
                return affine([k, 0, 0, 0, k, 0, 0, 0, k], sub(c, scale(c, k)));
            },
            overlay: {}
        };
    }
    // A rotatory reflection: its axis u (where L is −1), its center c.
    const B = [L[0] + 1, L[1], L[2], L[3], L[4] + 1, L[5], L[6], L[7], L[8] + 1],
        rows = [0, 1, 2].map(i => [B[3 * i], B[3 * i + 1], B[3 * i + 2]]);
    const u = unit([
        [0, 1],
        [0, 2],
        [1, 2]
    ].map(([i, j]) => cross(rows[i], rows[j])).reduce((a, b) => (len(b) > len(a) ? b : a)));
    const v = unit(cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])),
        Lv = mvec(L, v),
        th = Math.atan2(dot(u, cross(v, Lv)), dot(v, Lv));
    const c = solve3([1 - L[0], -L[1], -L[2], -L[3], 1 - L[4], -L[5], -L[6], -L[7], 1 - L[8]], t);
    return {
        kind: 'rotatory',
        angle: th,
        at: e => compose(turnAbout3(c, u, th * e), squash(u, c)(e)),
        overlay: {
            plane3: {
                p: c,
                n: u
            },
            axis3: {
                p: c,
                u
            }
        }
    };
};
export const describeSpace = (Gr, h) => {
    const m = spaceMotion(Gr, h),
        deg = Math.round(Math.abs(m.angle) * DEG);
    return {
        id: 'the identity',
        trans: 'a translation',
        rot: deg === 180 ? 'a half-turn about an axis' : `a rotation by ${deg}° about an axis`,
        screw: deg === 180 ? 'a screw motion: a half-turn about an axis, sliding along it' : `a screw motion: a turn by ${deg}° about an axis, sliding along it`,
        mirror: 'a reflection in a plane',
        glide: 'a glide reflection in a plane',
        inversion: 'an inversion in a point',
        rotatory: `a rotatory reflection: a turn by ${deg}° about an axis, then a reflection in the plane square to it`,
    } [m.kind];
};
// (Either kind of polyhedron in space: a blend, or a pure one.)
export const spatialMotion = (Gr, h) => (Gr.pure ? spaceMotion(Gr, h) : blendMotion(Gr, h));
export const solveIn = (S, pairs, proper = null) => (S.pure ? spaceSolve(S, pairs, proper) : blendSolve(S, pairs, proper));
