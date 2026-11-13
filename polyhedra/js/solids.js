// The finite regular polyhedra: vertices, faces, Petrie polygons, stars.

import {
    add,
    cameraView,
    clamp,
    cross,
    cross2,
    dot,
    EPS,
    len,
    mean,
    PHI,
    qnorm,
    scale,
    sub,
    unit
} from './math.js';

const cubeVerts = () => {
    const V = [];
    for (const x of [-1, 1]) {
        for (const y of [-1, 1]) {
            for (const z of [-1, 1]) {
                V.push([x, y, z]);
            }
        }
    }
    return V;
};
const signs = f => {
    const V = [];
    for (const s of [-1, 1]) {
        for (const t of [-1, 1]) {
            V.push(...f(s, t));
        }
    }
    return V;
};

const unitAll = V => V.map(unit);
const icosaPoints = () => signs((s, t) => [
    [0, s, t * PHI],
    [s, t * PHI, 0],
    [t * PHI, 0, s]
]);
const icosaVerts = () => unitAll(icosaPoints());

// The Newell vector of a polygon (points pts): its normal, scaled by its signed area, so stars work too.
export const newell = pts => {
    let nx = 0,
        ny = 0,
        nz = 0;
    pts.forEach((a, k) => {
        const b = pts[(k + 1) % pts.length];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
    });
    return [nx, ny, nz];
};
// A planar polygon's unit normal, pointing away from the center.
const outward = pts => {
    const n = unit(newell(pts));
    return dot(n, mean(pts)) < 0 ? scale(n, -1) : n;
};

// The distinct distances between vertices, smallest first.
const distances = V => {
    const ds = [];
    V.forEach((a, i) => V.forEach((b, j) => {
        if (i < j) {
            const d = len(sub(a, b));
            if (!ds.some(x => Math.abs(x - d) < 1e-6)) {
                ds.push(d);
            }
        }
    }));
    return ds.sort((x, y) => x - y);
};
const neighborsAt = (V, d) => V.map((a, i) => V.map((b, j) => j).filter(j => j !== i && Math.abs(len(sub(a, V[j])) - d) < 1e-6));

// The neighbors js of vertex i, in order around it.
const ringAround = (V, i, js) => {
    const n = V[i],
        c0 = sub(V[js[0]], scale(n, dot(V[js[0]], n)));
    const u = unit(c0),
        w = cross(n, u);
    const ang = j => Math.atan2(dot(V[j], w), dot(V[j], u));
    return [...js].sort((x, y) => ang(x) - ang(y));
};

// The great dodecahedron {5, 5/2}: the icosahedron's vertices and edges, with a pentagon through the five neighbors of each vertex.
const greatDodecahedron = () => {
    const V = icosaVerts(),
        nb = neighborsAt(V, distances(V)[0]);
    return {
        V,
        faces: V.map((v, i) => ringAround(V, i, nb[i]))
    };
};

// The great icosahedron {3, 5/2}: the icosahedron's vertices, joined to their second neighbors, with the twenty triangles those edges make.
const greatIcosahedron = () => {
    const V = icosaVerts(),
        far = neighborsAt(V, distances(V)[1]),
        faces = [];
    V.forEach((v, a) => far[a].forEach(b => far[b].forEach(c => {
        if (a < b && b < c && far[a].includes(c)) {
            faces.push([a, b, c]);
        }
    })));
    return {
        V,
        faces
    };
};

// The dual by reciprocation: a vertex along each face's normal, and a face around each vertex, through the faces at that vertex in turn (each sharing an edge with the next).
const dualOf = ({
    V,
    faces
}) => {
    const verts = faces.map(f => outward(f.map(i => V[i])));
    const around = V.map((v, i) => {
        const at = faces.map((f, k) => k).filter(k => faces[k].includes(i));
        const sides = k => {
            const f = faces[k],
                m = f.indexOf(i);
            return [f[(m + 1) % f.length], f[(m + f.length - 1) % f.length]];
        };
        const ring = [at[0]];
        for (let guard = 0; ring.length < at.length && guard < 50; guard++) {
            const cur = ring[ring.length - 1],
                prev = ring[ring.length - 2];
            const next = at.find(k => k !== cur && k !== prev && !ring.includes(k) && sides(k).some(u => sides(cur).includes(u)));
            if (next === undefined) {
                break;
            }
            ring.push(next);
        }
        return ring;
    });
    return {
        V: verts,
        faces: around
    };
};

// The regular polyhedra with planar faces: the five Platonic solids and the four Kepler–Poinsot polyhedra. p, q and h (the length of a Petrie polygon) are strings so that 5/2 and 10/3 can be written. dual and facet name where d and f lead: 'same' when facetting changes nothing (three faces at a vertex), 'degenerate' when it gives no polyhedron.
const ICOSA_VIEW = {
    up: [0, 1, PHI],
    az: 252,
    el: 11
};
export const DEFS = {
    tetrahedron: {
        p: '3',
        q: '3',
        h: '4',
        dual: 'tetrahedron',
        facet: 'same',
        verts: () => [
            [1, 1, 1],
            [1, -1, -1],
            [-1, 1, -1],
            [-1, -1, 1]
        ],
        view: {
            up: [1, 1, 1],
            az: 20,
            el: 18
        },
    },
    cube: {
        p: '4',
        q: '3',
        h: '6',
        dual: 'octahedron',
        facet: 'same',
        verts: cubeVerts,
        view: {
            up: [0, 0, 1],
            az: 238,
            el: 28
        },
    },
    octahedron: {
        p: '3',
        q: '4',
        h: '6',
        dual: 'cube',
        facet: 'degenerate',
        verts: () => [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, -1, 0],
            [0, 0, 1],
            [0, 0, -1]
        ],
        view: {
            up: [0, 0, 1],
            az: 98,
            el: 12
        },
    },
    dodecahedron: {
        p: '5',
        q: '3',
        h: '10',
        dual: 'icosahedron',
        facet: 'same',
        verts: () => cubeVerts().concat(signs((s, t) => [
            [0, s / PHI, t * PHI],
            [s / PHI, t * PHI, 0],
            [s * PHI, 0, t / PHI]
        ])),
        // Fitted to icons/owl-outline.svg, so at rest the drawing is the favicon.
        quat: [0.803711, 0.581609, 0.124755, 0.014716],
    },
    icosahedron: {
        p: '3',
        q: '5',
        h: '10',
        dual: 'dodecahedron',
        facet: 'great-dodecahedron',
        verts: icosaPoints,
        view: ICOSA_VIEW,
    },
    'great-dodecahedron': {
        title: 'great dodecahedron',
        p: '5',
        q: '5/2',
        h: '6',
        dual: 'small-stellated-dodecahedron',
        facet: 'icosahedron',
        build: greatDodecahedron,
        view: ICOSA_VIEW,
    },
    'small-stellated-dodecahedron': {
        title: 'small stellated dodecahedron',
        p: '5/2',
        q: '5',
        h: '6',
        dual: 'great-dodecahedron',
        facet: 'great-icosahedron',
        build: () => dualOf(greatDodecahedron()),
        view: ICOSA_VIEW,
    },
    'great-icosahedron': {
        title: 'great icosahedron',
        p: '3',
        q: '5/2',
        h: '10/3',
        dual: 'great-stellated-dodecahedron',
        facet: 'small-stellated-dodecahedron',
        build: greatIcosahedron,
        view: ICOSA_VIEW,
    },
    'great-stellated-dodecahedron': {
        title: 'great stellated dodecahedron',
        p: '5/2',
        q: '3',
        h: '10/3',
        dual: 'great-icosahedron',
        facet: 'same',
        build: () => dualOf(greatIcosahedron()),
        view: ICOSA_VIEW,
    },
    // The planar polyhedra: the regular tilings (see TILINGS). zoom: model units per unit of the tiling, so that edges come out much the same.
    square: {
        title: 'square tiling',
        p: '4',
        q: '4',
        h: '∞',
        dual: 'square',
        planar: 'square',
        zoom: 1 / 3
    },
    triangular: {
        title: 'triangular tiling',
        p: '3',
        q: '6',
        h: '∞',
        dual: 'hexagonal',
        planar: 'triangular',
        zoom: 0.3
    },
    hexagonal: {
        title: 'hexagonal tiling',
        p: '6',
        q: '3',
        h: '∞',
        dual: 'triangular',
        planar: 'hexagonal',
        zoom: 0.5
    },
    // The blended polyhedra: each tiling blended with a segment and a line.
    ...Object.fromEntries(['square', 'triangular', 'hexagonal'].flatMap(base => ['seg', 'line'].map(q => [`${base}-${q}`, {
        title: `blend of the ${base} tiling with a ${q === 'seg' ? 'segment' : 'line'}`,
        blend: {
            base,
            q
        },
        tag: q === 'seg' ? '{&nbsp;}' : '{∞}',
    }]))),
    // The 12 pure polyhedra, in space: each with its Petrial, but for two that are their own. word: from {4,6|4}, by the operations.
    mucube: {
        title: 'mucube',
        pure: {
            word: '',
            kind: 'pc',
            zoom: 0.5,
            colors: {
                faces: [0, 2, 4, 0],
                petrie: [0, 2, 4, 0]
            }
        },
        sym: '{4,&nbsp;6&nbsp;|&nbsp;4}',
        psym: '{∞,&nbsp;6}<sub>4,4</sub>'
    },
    muoctahedron: {
        title: 'muoctahedron',
        pure: {
            word: 'δ',
            kind: 'pc',
            zoom: 0.42,
            colors: {
                faces: [1, 1, 1, 0],
                petrie: [1, 2, 4, 0]
            }
        },
        sym: '{6,&nbsp;4&nbsp;|&nbsp;4}',
        psym: '{∞,&nbsp;4}<sub>6,4</sub>'
    },
    mutetrahedron: {
        title: 'mutetrahedron',
        pure: {
            word: 'ηπη',
            kind: 'pc',
            zoom: 0.28,
            colors: {
                faces: [0, 1, 2, 0],
                petrie: [0, 0, 0, 1]
            }
        },
        sym: '{6,&nbsp;6&nbsp;|&nbsp;3}',
        psym: '{∞,&nbsp;6}<sub>6,3</sub>'
    },
    'skew-664': {
        pure: {
            word: 'η',
            kind: 'skew',
            zoom: 0.4,
            colors: {
                faces: [0, 1, 2, 0],
                petrie: [1, 1, 1, 0]
            }
        },
        sym: '{6,&nbsp;6}<sub>4</sub>',
        psym: '{4,&nbsp;6}<sub>6</sub>'
    },
    'skew-646': {
        pure: {
            word: 'ηπδ',
            kind: 'skew',
            selfPetrie: true,
            zoom: 0.48,
            colors: {
                faces: [0, 1, 2, 0],
                petrie: [0, 1, 2, 0]
            }
        },
        sym: '{6,&nbsp;4}<sub>6</sub>'
    },
    'helical-3': {
        pure: {
            word: 'ηφ',
            kind: 'helical',
            zoom: 0.3,
            colors: {
                faces: [1, 6, 8, 7],
                petrie: [1, 8, 8, 6]
            }
        },
        sym: '{∞,&nbsp;3}<sup>(a)</sup>',
        psym: '{∞,&nbsp;3}<sup>(b)</sup>'
    },
    'helical-4': {
        pure: {
            word: 'δπδηπδ',
            kind: 'helical',
            selfPetrie: true,
            zoom: 0.42,
            colors: {
                faces: [3, 8, 1, 5],
                petrie: [3, 8, 1, 5]
            }
        },
        sym: '{∞,&nbsp;4}<sub>·,*3</sub>'
    },
};

const near = (a, b) => Math.abs(a - b) < EPS;
export const keyOf = M => M.map(c => Math.round(c * 1e4)).join(',');

// Axis and angle of a rotation matrix, angle in [0, π].
export const axisAngle = R => {
    const angle = Math.acos(clamp((R[0] + R[4] + R[8] - 1) / 2, -1, 1));
    if (angle < EPS) {
        return {
            axis: [0, 0, 1],
            angle: 0
        };
    }
    if (Math.PI - angle > EPS) {
        return {
            axis: unit([R[7] - R[5], R[2] - R[6], R[3] - R[1]]),
            angle
        };
    }
    // Half-turn: R + I = 2aaᵀ.
    const d = [R[0], R[4], R[8]];
    const i = d.indexOf(Math.max(...d));
    const row = [R[3 * i], R[3 * i + 1], R[3 * i + 2]];
    row[i] += 1;
    return {
        axis: unit(row),
        angle: Math.PI
    };
};

// Faces as the supporting planes of a convex vertex set, each listed counterclockwise as seen from outside.
const hullFaces = V => {
    const n = V.length,
        faces = [],
        normals = [];
    for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
            for (let c = b + 1; c < n; c++) {
                let nrm = cross(sub(V[b], V[a]), sub(V[c], V[a]));
                if (len(nrm) < EPS) {
                    continue;
                }
                nrm = unit(nrm);
                if (dot(nrm, V[a]) < 0) {
                    nrm = scale(nrm, -1);
                }
                const h = dot(nrm, V[a]);
                if (V.some(v => dot(v, nrm) > h + EPS) || normals.some(m => len(sub(m, nrm)) < EPS)) {
                    continue;
                }
                const ids = V.map((v, i) => i).filter(i => near(dot(V[i], nrm), h));
                const center = mean(ids.map(i => V[i]));
                const u = unit(sub(V[ids[0]], center)),
                    w = cross(nrm, u);
                const ang = i => {
                    const d = sub(V[i], center);
                    return Math.atan2(dot(d, w), dot(d, u));
                };
                normals.push(nrm);
                faces.push(ids.sort((x, y) => ang(x) - ang(y)));
            }
        }
    }
    return faces;
};

// Turn faces (vertex cycles) so that every edge is run one way by one of its faces and the other way by the other.
const orientFaces = faces => {
    const out = faces.map(f => [...f]),
        done = out.map(() => false),
        queue = [0];
    done[0] = true;
    const has = (f, a, b) => {
        const m = f.indexOf(a);
        return m >= 0 && f[(m + 1) % f.length] === b;
    };
    while (queue.length) {
        const f = out[queue.shift()];
        f.forEach((a, m) => {
            const b = f[(m + 1) % f.length];
            out.forEach((g, k) => {
                if (done[k] || !(has(g, a, b) || has(g, b, a))) {
                    return;
                }
                if (has(g, a, b)) {
                    g.reverse();
                }
                done[k] = true;
                queue.push(k);
            });
        });
    }
    return out;
};

const faceRecord = (V, ids) => {
    const pts = ids.map(i => V[i]),
        normal = outward(pts);
    return {
        ids,
        normal,
        h: dot(normal, pts[0]),
        center: mean(pts),
        orient: dot(newell(pts), normal) < 0 ? -1 : 1
    };
};

export const buildSolid = name => {
    const def = DEFS[name];
    const built = def.build ? def.build() : null;
    const V = built ? unitAll(built.V) : unitAll(def.verts()); // circumradius 1
    const n = V.length;
    const convex = !built;

    // The convex hull: its symmetries are the polyhedron's, and it decides front and back for the ink drawing of a convex solid.
    const HULL_FACES = hullFaces(V).map(ids => faceRecord(V, ids));
    const hullLen = distances(V)[0];
    const HULL_EDGES = [];
    V.forEach((a, i) => V.forEach((b, j) => {
        if (i < j && near(len(sub(a, b)), hullLen)) {
            HULL_EDGES.push([i, j]);
        }
    }));

    // The polyhedron's own faces: the hull's, or (Kepler–Poinsot) its stars.
    const FACES = convex ? HULL_FACES : orientFaces(built.faces).map(ids => faceRecord(V, ids));
    const EDGES = [];
    const edgeIndex = new Map();
    FACES.forEach(f => f.ids.forEach((a, m) => {
        const b = f.ids[(m + 1) % f.ids.length];
        if (!edgeIndex.has(`${a},${b}`)) {
            edgeIndex.set(`${a},${b}`, EDGES.length);
            edgeIndex.set(`${b},${a}`, EDGES.length);
            EDGES.push(a < b ? [a, b] : [b, a]);
        }
    }));
    const isSide = (ids, i, j) => {
        const m = ids.indexOf(i);
        return m >= 0 && (ids[(m + 1) % ids.length] === j || ids[(m + ids.length - 1) % ids.length] === j);
    };
    const EDGE_FACES = EDGES.map(([i, j]) => FACES.map((f, k) => k).filter(k => isSide(FACES[k].ids, i, j)));

    // Distance from the center to the hull along the unit vector d, and the feature of the hull the ray leaves through: vertex, edge or face.
    const surface = d => Math.min(...HULL_FACES.filter(f => dot(f.normal, d) > EPS).map(f => f.h / dot(f.normal, d)));
    const exit = d => {
        const p = scale(d, surface(d));
        if (V.some(v => len(sub(v, p)) < 1e-5)) {
            return 'v';
        }
        if (HULL_EDGES.some(([i, j]) => len(sub(scale(add(V[i], V[j]), 0.5), p)) < 1e-5)) {
            return 'e';
        }
        return 'f';
    };

    const lengths = EDGES.map(([i, j]) => len(sub(V[i], V[j])));
    const flat = FACES.every(f => f.ids.every(i => Math.abs(dot(V[i], f.normal) - f.h) < 1e-6));
    if (EDGE_FACES.some(f => f.length !== 2) || !flat || Math.max(...lengths) - Math.min(...lengths) > 1e-6 ||
        (convex && FACES.length - EDGES.length + n !== 2)) {
        throw new Error(`${name}: construction failed`);
    }

    // Petrie polygons: zigzag along the edges, turning left and right in turn, so that any two consecutive edges share a face but no three do. A left turn at cur follows the face around prev→cur in its own direction; a right turn follows the face on the other side, backwards.
    const leftOf = new Map();
    FACES.forEach((f, k) => f.ids.forEach((a, m) => leftOf.set(`${a},${f.ids[(m + 1) % f.ids.length]}`, k)));
    const along = (k, v, d) => {
        const ids = FACES[k].ids,
            m = ids.indexOf(v);
        return ids[(m + d + ids.length) % ids.length];
    };
    const PETRIE = [],
        PETRIE_FIRST = []; // and the turn each takes at its second vertex
    const seenPetrie = new Set();
    for (const [a, b] of EDGES) {
        for (const first of [true, false]) {
            const poly = [a];
            let prev = a,
                cur = b,
                left = first;
            do {
                poly.push(cur);
                const next = left ? along(leftOf.get(`${prev},${cur}`), cur, 1) : along(leftOf.get(`${cur},${prev}`), cur, -1);
                prev = cur;
                cur = next;
                left = !left;
            } while (!(prev === a && cur === b && left === first) && poly.length <= 2 * EDGES.length);
            poly.pop();
            const key = poly.map((v, m) => edgeIndex.get(`${v},${poly[(m + 1) % poly.length]}`)).sort((x, y) => x - y).join();
            if (!seenPetrie.has(key)) {
                seenPetrie.add(key);
                PETRIE.push(poly);
                PETRIE_FIRST.push(first);
            }
        }
    }
    const hn = PETRIE[0].length;
    if (PETRIE.some(p => p.length !== hn) || PETRIE.length * hn !== 2 * EDGES.length) {
        throw new Error(`${name}: Petrie polygons failed`);
    }

    // The dual, reciprocated in the midsphere: a vertex out along each face normal, at the distance that makes every dual edge cross its original edge at the midpoint. Its faces go around each original vertex, through the faces there in turn.
    const midR = len(scale(add(V[EDGES[0][0]], V[EDGES[0][1]]), 0.5));
    const c = (midR * midR) / FACES[0].h;
    const around = dualOf({
        V,
        faces: FACES.map(f => f.ids)
    }).faces;
    const DUAL = {
        c,
        verts: FACES.map(f => scale(f.normal, c)),
        faces: around
    };

    return {
        name,
        def,
        title: def.title || name,
        convex,
        V,
        EDGES,
        FACES,
        EDGE_FACES,
        HULL_FACES,
        HULL_EDGES,
        surface,
        exit,
        edgeIndex,
        PETRIE,
        PETRIE_FIRST,
        DUAL,
        pn: FACES[0].ids.length,
        qn: EDGES.filter(e => e.includes(0)).length,
        q0: def.quat ? qnorm(def.quat) : cameraView(def.view),
    };
};

// The outer surface of a star polyhedron, as pieces of its faces: each face is cut along the lines where the other faces' planes cross it, and a piece is kept if it lies in the face and on the outside of the solid (just beyond it, the winding number of the surface is 0; just inside, not). These are what a solid model of it shows.
export const outerPieces = S => {
    const ray = unit([0.3127, 0.5413, 0.7811]);
    const faces = S.FACES.map(f => {
        const pts = f.ids.map(i => S.V[i]),
            N = newell(pts),
            n = f.normal;
        const e1 = unit(sub(pts[0], f.center)),
            e2 = cross(n, e1);
        const to2 = p => {
            const d = sub(p, f.center);
            return [dot(d, e1), dot(d, e2)];
        };
        return {
            pts,
            N,
            n,
            e1,
            e2,
            to2,
            poly: pts.map(to2),
            center: f.center,
            h: dot(n, f.center)
        };
    });
    // The winding number of a polygon (2D) about a point, counted with sign.
    const wind = (poly, p) => {
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
        return w;
    };
    // The surface's winding number about a point: along a ray, each face it passes through, as many times as that face winds there, signed by which way the face is turned.
    const surfaceWind = x => faces.reduce((w, F) => {
        const dn = dot(F.n, ray);
        if (Math.abs(dn) < 1e-9) {
            return w;
        }
        const t = (F.h - dot(F.n, x)) / dn;
        if (t <= 1e-9) {
            return w;
        }
        const k = wind(F.poly, F.to2(add(x, scale(ray, t)))); // in F's frame, whose normal is n
        return w + k * Math.sign(dot(F.N, F.n)) * Math.sign(dot(F.N, ray));
    }, 0);
    const pieces = [];
    faces.forEach((F, k) => {
        // Cells: the convex hull of the face, cut by each other face's line.
        let cells = [hullOf2(F.poly)];
        faces.forEach((G, m) => {
            if (m === k || len(cross(F.n, G.n)) < 1e-6) {
                return;
            }
            // In F's plane, G's plane is a·x = b.
            const a = [dot(G.n, F.e1), dot(G.n, F.e2)],
                b = G.h - dot(G.n, F.center);
            cells = cells.flatMap(cell => splitConvex(cell, a, b)).filter(cell => cell.length >= 3 && Math.abs(area2(cell)) > 1e-9);
        });
        cells.forEach(cell => {
            const c2 = cell.reduce((u, p) => [u[0] + p[0] / cell.length, u[1] + p[1] / cell.length], [0, 0]);
            if (wind(F.poly, c2) === 0) {
                return;
            }
            const c3 = add(F.center, add(scale(F.e1, c2[0]), scale(F.e2, c2[1])));
            if (surfaceWind(add(c3, scale(F.n, 1e-4))) !== 0 || surfaceWind(sub(c3, scale(F.n, 1e-4))) === 0) {
                return;
            }
            pieces.push({
                face: k,
                pts: cell.map(p => add(F.center, add(scale(F.e1, p[0]), scale(F.e2, p[1]))))
            });
        });
    });
    // Its creases: the sides of each piece that it does not share with another piece of the same face (where faces meet, edges and the lines where faces pass through each other).
    const k3 = p => p.map(x => Math.round(x * 1e5)).join();
    const sideKey = (a, b) => [k3(a), k3(b)].sort().join('|');
    const shared = new Map();
    pieces.forEach(pc => pc.pts.forEach((a, i) => {
        const key = `${pc.face}:${sideKey(a, pc.pts[(i + 1) % pc.pts.length])}`;
        shared.set(key, (shared.get(key) || 0) + 1);
    }));
    // (And which vertex of the polyhedron each crease ends at, if either: there, at a corner of the outline, it ends on the rounding.)
    const vid = p => S.V.findIndex(v => len(sub(v, p)) < 1e-6);
    pieces.forEach(pc => {
        pc.creaseSides = pc.pts.map((a, i) => i).filter(i => shared.get(`${pc.face}:${sideKey(pc.pts[i], pc.pts[(i + 1) % pc.pts.length])}`) < 2);
        pc.creases = pc.creaseSides.map(i => [pc.pts[i], pc.pts[(i + 1) % pc.pts.length]]);
        pc.creaseEnds = pc.creases.map(([a, b]) => [vid(a), vid(b)]);
        pc.ptIds = pc.pts.map(vid);
    });
    return pieces;
};
// 2D helpers: twice a polygon's signed area, a convex hull, and a convex polygon split by the line a·x = b into its two sides.
export const area2 = poly => poly.reduce((s, p, k) => s + cross2(p, poly[(k + 1) % poly.length]), 0);
const hullOf2 = pts => {
    const P = [...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const half = list => {
        const h = [];
        for (const p of list) {
            while (h.length >= 2 && cross2([h[h.length - 1][0] - h[h.length - 2][0], h[h.length - 1][1] - h[h.length - 2][1]], [p[0] - h[h.length - 2][0], p[1] - h[h.length - 2][1]]) <= 1e-12) {
                h.pop();
            }
            h.push(p);
        }
        return h;
    };
    return half(P).slice(0, -1).concat(half([...P].reverse()).slice(0, -1));
};
export const splitConvex = (poly, a, b) => {
    const side = p => a[0] * p[0] + a[1] * p[1] - b,
        lo = [],
        hi = [];
    poly.forEach((p, k) => {
        const q = poly[(k + 1) % poly.length],
            sp = side(p),
            sq = side(q);
        if (sp <= 1e-12) {
            lo.push(p);
        }
        if (sp >= -1e-12) {
            hi.push(p);
        }
        if ((sp < -1e-12 && sq > 1e-12) || (sp > 1e-12 && sq < -1e-12)) {
            const t = sp / (sp - sq),
                x = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
            lo.push(x);
            hi.push(x);
        }
    });
    return [lo, hi];
};
