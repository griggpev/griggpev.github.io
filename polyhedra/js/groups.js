// Symmetry groups, their conjugacy classes and how to describe them.

import {
    cross,
    DEG,
    det3,
    dot,
    EPS,
    I3,
    len,
    mmul,
    mvec,
    rotation,
    scale,
    stretch,
    sub,
    transpose,
    unit,
} from './math.js';
import {
    axisAngle,
    keyOf
} from './solids.js';

export const buildGroup = S => {
    // The symmetries of the polyhedron are those of its hull.
    const {
        V,
        HULL_FACES: FACES,
        HULL_EDGES: EDGES
    } = S;
    const f = FACES[0],
        v = f.ids[0];
    const degree = EDGES.filter(e => e.includes(v)).length;

    // Rotations: close up under a turn about a face and a turn about a vertex.
    const rotations = [I3];
    const seen = new Set([keyOf(I3)]);
    const gens = [rotation(f.normal, 2 * Math.PI / f.ids.length), rotation(unit(V[v]), 2 * Math.PI / degree)];
    for (let i = 0; i < rotations.length; i++) {
        for (const g of gens) {
            const M = mmul(g, rotations[i]);
            const k = keyOf(M);
            if (!seen.has(k)) {
                seen.add(k);
                rotations.push(M);
            }
        }
    }
    if (rotations.length !== 2 * EDGES.length) {
        throw new Error(`${S.name}: found ${rotations.length} rotations`);
    }

    // The other coset: rotations times the mirror through a face center and one of its vertices.
    const sigma = stretch(unit(cross(f.normal, V[v])), -1);
    const vkeys = new Set(V.map(p => p.map(c => Math.round(c * 1e5)).join()));
    if (!V.every(p => vkeys.has(mvec(sigma, p).map(c => Math.round(c * 1e5)).join()))) {
        throw new Error(`${S.name}: mirror is not a symmetry`);
    }

    const info = M => {
        if (det3(M) > 0) {
            return {
                M,
                proper: true,
                ...axisAngle(M)
            };
        }
        // An improper M is R(a, θ + π) composed with the reflection across a⊥, where -M = R(a, θ).
        const {
            axis,
            angle
        } = axisAngle(M.map(c => -c));
        if (angle < EPS) {
            return {
                M,
                proper: false,
                inversion: true,
                axis: [0, 0, 1],
                angle: 0
            };
        }
        // (angle is past 0 here, so θ + π is past π: in (-π, π], θ - π.)
        return {
            M,
            proper: false,
            axis,
            angle: angle + Math.PI - 2 * Math.PI
        };
    };

    const G = rotations.map(info).concat(rotations.map(R => info(mmul(R, sigma))));
    const index = new Map(G.map((g, i) => [keyOf(g.M), i]));
    const lookup = M => {
        const i = index.get(keyOf(M));
        if (i === undefined) {
            throw new Error('not a symmetry');
        }
        return i;
    };
    const TIMES = G.map(a => G.map(b => lookup(mmul(a.M, b.M))));
    const INV = G.map(g => lookup(transpose(g.M)));
    const fold = a => rotations.filter(R => len(sub(mvec(R, a), a)) < 1e-5).length;

    const find = M => {
        const i = index.get(keyOf(M));
        return i === undefined ? 0 : i;
    };
    return {
        G,
        R: rotations.length,
        TIMES,
        INV,
        fold,
        find,
        mul: (a, b) => TIMES[a][b],
        inv: a => INV[a]
    };
};

// The symmetry sending vertex a to vertex b for each [a, b] in pairs (a proper one, if asked).
const moving = (S, Gr, pairs, proper = false) => {
    const i = Gr.G.findIndex(g => (!proper || g.proper) && pairs.every(([a, b]) => len(sub(mvec(g.M, S.V[a]), S.V[b])) < 1e-5));
    if (i < 0) {
        throw new Error(`${S.name}: no such symmetry`);
    }
    return i;
};
const steps = c => c.map((v, m) => [v, c[(m + 1) % c.length]]);

// The neighbors of vertex v in order around it: each and the next are the two neighbors of v on one face.
const ringAt = (S, v) => {
    const pairs = S.FACES.map(f => f.ids).filter(ids => ids.includes(v))
        .map(ids => {
            const m = ids.indexOf(v),
                n = ids.length;
            return [ids[(m + n - 1) % n], ids[(m + 1) % n]];
        });
    const ring = [pairs[0][0]],
        used = new Set([0]);
    let cur = pairs[0][1];
    while (ring.length < pairs.length) {
        ring.push(cur);
        const k = pairs.findIndex((p, i) => !used.has(i) && p.includes(cur));
        if (k < 0) {
            throw new Error(`${S.name}: no ring at a vertex`);
        }
        used.add(k);
        cur = pairs[k][0] === cur ? pairs[k][1] : pairs[k][0];
    }
    return ring;
};

// The turns a click can make, each one step of what it turns about:
// - about a face, each vertex of the face on to the next along its edges: on a planar face, a rotation about its center (by 144° on a pentagram); on a Petrial's face, a Petrie polygon, the Petrie element, a rotatory reflection;
// - about a vertex, each neighbor on to the next around it: a rotation by 360°/q (144° where q = 5/2). A Petrial has the same vertices, edges and vertex figures, so the same turns;
// - about an edge, the half-turn swapping its ends.
export const turnsOf = (S, Gr) => ({
    faces: S.FACES.map(f => moving(S, Gr, steps(f.ids))),
    petrie: S.PETRIE.map(p => moving(S, Gr, steps(p))),
    vertices: S.V.map((x, v) => moving(S, Gr, [
        [v, v], ...steps(ringAt(S, v))
    ])),
    edges: S.EDGES.map(([i, j]) => moving(S, Gr, [
        [i, j],
        [j, i]
    ], true)),
});

// How each kind of axis and mirror is described in words. F names a face: 'face' on a convex solid, or, where the hull's faces are not the polyhedron's own (a star, a Petrial), the hull face's shape ('square').
const axesFor = F => ({
    vv: ['vertex', 'through two opposite vertices'],
    ff: [F, `through the centers of two opposite ${F}s`],
    ee: ['edge', 'through the midpoints of two opposite edges'],
    fv: ['vertex', `through a vertex and the center of the opposite ${F}`],
});

const mirrorKind = (S, n, F) => {
    const inPlane = p => Math.abs(dot(p, n)) < 1e-5;
    const vIn = S.V.filter(inPlane).length;
    const eIn = S.EDGES.filter(([i, j]) => inPlane(S.V[i]) && inPlane(S.V[j])).length;
    if (eIn === 1) {
        return ['through an edge', 'through one edge and the midpoint of the opposite edge'];
    }
    if (eIn === 2) {
        return ['through edges', 'through two opposite edges'];
    }
    if (vIn >= 4) {
        return ['through 4 vertices', 'through four vertices'];
    }
    if (vIn === 2) {
        return ['through 2 vertices', 'through two opposite vertices'];
    }
    return [`between ${F}s`, `halfway between two opposite ${F}s`];
};

const describe = (S, Gr, i, F) => {
    const g = Gr.G[i];
    if (i === 0) {
        return {
            label: 'identity',
            text: 'the identity',
            sort: [0, 0, 0, 0]
        };
    }
    if (g.inversion) {
        return {
            label: 'inversion',
            text: 'the central inversion, which sends each point to the point opposite it',
            sort: [1, 0, 0, 0]
        };
    }
    const ends = [S.exit(g.axis), S.exit(scale(g.axis, -1))];
    const [word, phrase] = axesFor(F)[[...ends].sort().join('')];
    const fold = Gr.fold(g.axis);
    const deg = Math.round(Math.abs(g.angle) * DEG);
    if (g.proper) {
        // Counterclockwise as seen from the vertex end, if the axis has one.
        const hand = ends[0] === 'v' ? 'counterclockwise' : 'clockwise';
        return deg === 180 ? {
            label: `${word} half-turns`,
            text: `a half-turn about an axis ${phrase}`,
            sort: [0, 1, fold, deg]
        } : {
            label: `${word} turns, ${deg}°`,
            text: `a rotation by ${deg}° about an axis ${phrase}`,
            sort: [0, 1, fold, deg],
            hand,
            handText: `, ${hand} as seen from the vertex`
        };
    }
    if (deg === 0) {
        const [short, where] = mirrorKind(S, g.axis, F);
        return {
            label: 'mirrors',
            short,
            text: `a reflection in a mirror plane ${where}`,
            sort: [1, 1, 0, 0]
        };
    }
    return {
        label: `rotatory, ${deg}°`,
        text: `a rotatory reflection: a ${deg}° turn about an axis ${phrase}, then a reflection in the plane perpendicular to it`,
        sort: [1, 2, fold, deg],
    };
};

// Conjugacy classes of the first n elements (the rotations, or everything).
export const classesOf = (S, Gr, n, F = 'face') => {
    const owner = new Array(n).fill(-1);
    const list = [];
    for (let g = 0; g < n; g++) {
        if (owner[g] >= 0) {
            continue;
        }
        const members = new Set();
        for (let h = 0; h < n; h++) {
            members.add(Gr.TIMES[Gr.TIMES[h][g]][Gr.INV[h]]);
        }
        const k = list.length;
        members.forEach(m => {
            owner[m] = k;
        });
        list.push({
            members: [...members].sort((a, b) => a - b),
            ...describe(S, Gr, g, F)
        });
    }

    tellApart(list);

    // With the central inversion present, each orientation-reversing class is -1 times a rotation class; list it in its partner's place so the two columns of Figure 2 pair up.
    const inv = Gr.G.findIndex((g, i) => i < n && g.inversion);
    if (inv >= 0) {
        for (const c of list) {
            if (c.members[0] >= Gr.R) {
                c.sort = [1, ...list[owner[Gr.TIMES[inv][c.members[0]]]].sort];
            }
        }
    }

    list.sort(cmpClasses);
    list.forEach((c, k) => c.members.forEach(m => {
        owner[m] = k;
    }));
    return {
        list,
        owner
    };
};

// Two classes that would read the same get told apart: by the hand of a turn, then by what a mirror runs through, then by number.
export const tellApart = list => {
    const count = () => {
        const by = new Map();
        list.forEach(c => by.set(c.label, (by.get(c.label) || 0) + 1));
        return by;
    };
    let by = count();
    for (const c of list) {
        if (by.get(c.label) < 2) {
            continue;
        }
        if (c.hand) {
            c.label += c.hand === 'counterclockwise' ? ', ccw' : ', cw';
            c.text += c.handText;
            c.sort = [...c.sort, c.hand === 'counterclockwise' ? 0 : 1];
        } else if (c.short) {
            c.label += ` ${c.short}`;
        }
    }
    by = count();
    const seen = new Map();
    for (const c of list) {
        if (by.get(c.label) < 2) {
            continue;
        }
        const k = (seen.get(c.label) || 0) + 1;
        seen.set(c.label, k);
        c.label += ` (${k})`;
    }
};

export const cmpClasses = (a, b) => {
    for (let k = 0; k < Math.max(a.sort.length, b.sort.length); k++) {
        const d = (a.sort[k] || 0) - (b.sort[k] || 0);
        if (d) {
            return d;
        }
    }
    return a.members.length - b.members.length;
};
