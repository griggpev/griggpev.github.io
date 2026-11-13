// The 48 regular polyhedra (polyhedra/index.html), family by family: the 18 finite ones (the Platonic and Kepler–Poinsot solids and their Petrials), drawn in the style of the site's dodecahedron icon; the 6 planar ones (the regular tilings and their Petrials), seen through a window, with the 12 blended ones reached from them; and the 12 pure ones, in space. The up and down arrows change family. A click on a vertex, edge or face turns the polyhedron about it, one step (shift-click turns it back); the space bar applies a random non-trivial symmetry. P, D and F take the Petrial, the dual and the facetting; H and S the halving and the skewing; B and Shift-B the blends.
// Coordinates: x right, y up, z toward the viewer, orthographic. Everything about a solid (faces, its symmetry group, the conjugacy classes and how to describe them) is computed from its vertex list. Every finished move snaps to an exact group element, so nothing drifts.

import {
    add,
    bezier,
    cameraView,
    clamp,
    COUNT_MS,
    cross2,
    det3,
    dot,
    EASE,
    EASE_VIEW,
    EASY_EASE,
    I3,
    len,
    matchRotation,
    mean,
    mod,
    matq,
    mmul,
    mvec,
    qaxis,
    qmat,
    qmul,
    qnorm,
    scale,
    slerp,
    smoothstep,
    sub,
    transpose,
    unit,
    WHEEL_CSS,
    WHEEL_DEG,
    WHEEL_EASE,
    WHEEL_FIG,
    WHEEL_MS,
    WHEEL_R,
    wheelTurn,
} from './math.js';
import {
    buildSolid,
    DEFS,
    newell,
    outerPieces
} from './solids.js';
import {
    buildGroup,
    classesOf,
    turnsOf
} from './groups.js';
import {
    applyAffine,
    buildPlanar,
    compose,
    describePlanar,
    latticeGroup,
    patchOf,
    planarClasses,
    SQ2,
} from './planar.js';
import {
    blendGroupOf,
    blendPatchOf,
    buildBlend,
    describeBlend,
    liftToBlend
} from './blend.js';
import {
    buildPure,
    describeSpace,
    pureGroupOf,
    solveIn
} from './pure.js';
import {
    alongArc,
    CENTER,
    cornerOffset,
    darkTheme,
    drawLoops,
    drawWeave,
    finiteStrand,
    EDGE_ON,
    frontOf,
    HIDDEN,
    INSET,
    loopColor,
    loopPaint,
    outline,
    PETRIE_IN,
    ROPE,
    ropeJ,
    ropeNodes,
    SCALE,
    screen,
    segDist,
    segmentsOf,
    VIEWBOX,
    winds,
} from './look.js';
import {
    buildScene,
    draw
} from './draw-finite.js';
import {
    buildPlanarScene,
    drawPaths,
    drawPlanar,
    insideWindow,
    planarPose,
    screenNodes,
    trimToWindow,
    WIN_DIAG,
    WIN_H,
    WINDOW,
} from './draw-planar.js';
import {
    BLEND_VIEW,
    blendPose,
    blendProject,
    buildBlendScene,
    drawBlend
} from './draw-blend.js';
import {
    list,
    path,
    readPalette,
    rgb,
    svgBackend,
    theme
} from './dl.js';
import {
    glBackend
} from './gl.js';
import {
    buildMove,
    overlayFor,
    reducedMotion
} from './moves.js';

// Families of polyhedra, stepped through with the up and down arrows; their members with the left and right arrows. The rest of a family (the Kepler–Poinsot polyhedra, the Petrials) is reached by the operations and the map. The 12 blended polyhedra belong with the tilings, reached from them by B (with a segment) and Shift-B (with a line).
const FAMILIES = [{
    kind: 'finite',
    name: 'Platonic solids',
    heading: 'There are 18 finite regular polyhedra.',
    count: 18,
    members: ['tetrahedron', 'cube', 'octahedron', 'dodecahedron', 'icosahedron'],
    start: 'dodecahedron',
    facet: true,
    blend: false,
    pure: false,
}, {
    kind: 'planar',
    name: 'Regular tilings',
    heading: 'There are 6 planar regular polyhedra.',
    count: 6,
    members: ['square', 'triangular', 'hexagonal'],
    start: 'square',
    facet: false,
    blend: true,
    pure: false,
}, {
    // The pure polyhedra, in space; F is φ2, H halving η, S skewing σ.
    kind: 'pure',
    name: 'Petrie–Coxeter polyhedra',
    heading: 'There are 12 pure regular polyhedra.',
    count: 12,
    members: ['mucube', 'muoctahedron', 'mutetrahedron', 'skew-664', 'skew-646', 'helical-3', 'helical-4'],
    start: 'mucube',
    facet: true,
    blend: false,
    pure: true,
}];
// (A polyhedron's name: one of DEFS's own, not, say, 'constructor'.)
const known = name => Object.hasOwn(DEFS, name);
const familyKind = name => (!known(name) ? 'finite' : DEFS[name].pure ? 'pure' : DEFS[name].blend || DEFS[name].planar ? 'planar' : 'finite');
const familyOf = name => FAMILIES.findIndex(f => f.kind === familyKind(name));

const solids = {};
const solidOf = (name, phase = 0) => {
    if (DEFS[name].pure) {
        if (!solids[name]) {
            solids[name] = buildPure(name);
        }
        return solids[name];
    }
    if (DEFS[name].blend || DEFS[name].planar) {
        const key = `${name}@${phase}`;
        if (!solids[key]) {
            solids[key] = DEFS[name].blend ? buildBlend(name, phase, solidOf(DEFS[name].blend.base, phase)) : buildPlanar(name, phase);
        }
        return solids[key];
    }
    if (!solids[name]) {
        const S = buildSolid(name);
        // The marked flag: on the face turned most toward the viewer at rest.
        const V0 = qmat(S.q0);
        const face = S.FACES.reduce((b, f, k) => (mvec(V0, f.normal)[2] > mvec(V0, S.FACES[b].normal)[2] ? k : b), 0);
        const ids = S.FACES[face].ids;
        S.flag = {
            face,
            vertex: ids[0],
            other: ids[1]
        };
        // The faces as loops (see drawLoops): the faces themselves, the Petrie polygons, and the dual's faces (around each vertex, on the dual's own vertices).
        const corners = S.FACES.map(f => f.ids.map((v, j) => cornerOffset(f.ids.map(i => S.V[i]), j)));
        // The face in which a, v, b are consecutive (either way round).
        const faceAt = (a, v, b) => S.FACES.findIndex(f => {
            const ids = f.ids,
                m = ids.indexOf(v),
                x = ids[(m + 1) % ids.length],
                y = ids[(m + ids.length - 1) % ids.length];
            return m >= 0 && ((x === a && y === b) || (x === b && y === a));
        });
        S.LOOPS = {
            faces: S.FACES.map((f, k) => ({
                nodes: f.ids.map((v, j) => ({
                    base: S.V[v],
                    off: corners[k][j]
                })),
                vis: f.ids.map(() => k)
            })),
            // At each vertex a Petrie polygon turns through the one face holding both of its edges there; it takes that face's corner. Along each edge it runs parallel to the edge on that face's side, then at the middle jogs steeply across to the next face's side, through a point on the edge itself. The two Petrie polygons on an edge trade sides there, in one short, steep crossing.
            petrie: S.PETRIE.map(poly => {
                const n = poly.length;
                const fs = poly.map((v, i) => faceAt(poly[(i + n - 1) % n], v, poly[(i + 1) % n]));
                const inward = (fi, a, b) => {
                    const pa = S.V[a],
                        pb = S.V[b],
                        u = unit(sub(pb, pa)),
                        d = sub(S.FACES[fi].center, scale(add(pa, pb), 0.5));
                    return unit(sub(d, scale(u, dot(d, u))));
                };
                // Where the two faces at an edge fold sharply onto each other (on the great dodecahedron, great icosahedron and great stellated dodecahedron), the ways into them nearly coincide, and the two strands along it would all but merge: each stays on its face's side, pushed apart along the fold to at least the spacing of the cube's (whose faces meet square).
                const apart = (nF, nG) => {
                    const m = sub(nF, nG),
                        d = len(m),
                        k = d < SQ2 ? (SQ2 / Math.max(d, 1e-6) - 1) / 2 : 0;
                    return [add(nF, scale(m, k)), sub(nG, scale(m, k))];
                };
                const nodes = [],
                    vis = [],
                    J = ropeJ(len(sub(S.V[S.EDGES[0][0]], S.V[S.EDGES[0][1]])));
                // (Into each face along each edge: the face before the edge's far end, then the one after.)
                const sides = poly.map((v, i) => [inward(fs[i], v, poly[(i + 1) % n]), inward(fs[(i + 1) % n], v, poly[(i + 1) % n])]);
                poly.forEach((v, i) => {
                    const w = poly[(i + 1) % n],
                        F = fs[i],
                        G = fs[(i + 1) % n];
                    nodes.push({
                        base: S.V[v],
                        off: scale(corners[F][S.FACES[F].ids.indexOf(v)], PETRIE_IN)
                    });
                    vis.push(F);
                    ropeNodes(S.V[v], S.V[w], ...apart(...sides[i]), J).forEach((nd, m) => {
                        nodes.push(nd);
                        vis.push(m < ROPE ? F : G);
                    });
                });
                // (Drawn, it is laid out on the screen: see strandScreen.)
                const edge = len(sub(S.V[poly[0]], S.V[poly[1]]));
                return {
                    nodes,
                    vis,
                    strand: {
                        V: poly.map(v => S.V[v]),
                        sides,
                        lam: J / edge,
                    },
                };
            }),
            // The dual's faces, around each vertex, on the dual's own vertices.
            dual: S.DUAL.faces.map((fs, v) => {
                const pts = fs.map(f => S.DUAL.verts[f]);
                return {
                    nodes: pts.map((q, j) => ({
                        base: q,
                        off: cornerOffset(pts, j)
                    })),
                    vis: fs.map(() => v)
                };
            }),
        };
        const P0 = S.PETRIE[0],
            F0 = S.FACES[0].ids;
        S.petrialFlag = {
            vertex: P0[0],
            other: P0[1],
            prev: P0[P0.length - 1]
        };
        S.faceFlag = {
            vertex: F0[0],
            other: F0[1],
            prev: F0[F0.length - 1]
        };
        // The two Petrie loops that cross at each edge, and where in each.
        const along = S.EDGES.map(() => []);
        S.PETRIE.forEach((poly, k) => poly.forEach((v, i) => {
            // left: the turn this polygon takes at the far end of the edge (the turns alternate, so at poly[m] it is the first turn for m odd).
            along[S.edgeIndex.get(`${v},${poly[(i + 1) % poly.length]}`)].push({
                loop: k,
                j: i * (2 * ROPE + 2) + 1 + ROPE,
                left: (i % 2 === 0) === S.PETRIE_FIRST[k]
            });
        }));
        S.LOOPS.cross = along;
        if (!S.convex) {
            S.PIECES = outerPieces(S);
        }
        solids[name] = S;
    }
    return solids[name];
};

const groups = {};
const capitalize = w => w[0].toUpperCase() + w.slice(1);

// Faces named by their shape, where 'face' would not do: a star's hull, a Petrial's polygons (see classesOf).
const POLYGON = {
    3: 'triangle',
    4: 'square',
    5: 'pentagon',
    6: 'hexagon'
};
const groupOf = (name, phase = 0) => {
    if (DEFS[name].pure || DEFS[name].blend) {
        const S = solidOf(name, phase);
        return {
            Gr: S.pure ? pureGroupOf(S) : blendGroupOf(S),
            shifts: null,
            classes: {
                solid: null,
                petrial: null
            }
        };
    }
    if (DEFS[name].planar) {
        const key = `${name}@${phase}`;
        if (!groups[key]) {
            const S = solidOf(name, phase),
                Gr = latticeGroup(S.tiling.lattice),
                F = POLYGON[S.pn];
            groups[key] = {
                Gr,
                shifts: null,
                classes: {
                    solid: {
                        rotations: planarClasses(S, Gr, Gr.R),
                        all: planarClasses(S, Gr, 2 * Gr.R)
                    },
                    petrial: {
                        rotations: planarClasses(S, Gr, Gr.R, F),
                        all: planarClasses(S, Gr, 2 * Gr.R, F)
                    },
                },
            };
        }
        return groups[key];
    }
    if (!groups[name]) {
        const S = solidOf(name),
            Gr = buildGroup(S);
        // The symmetries are the hull's. Only a convex solid's hull faces are its faces; otherwise they are named by their shape.
        const F = POLYGON[S.HULL_FACES[0].ids.length];
        const named = {
            rotations: classesOf(S, Gr, Gr.R, F),
            all: classesOf(S, Gr, 2 * Gr.R, F)
        };
        groups[name] = {
            Gr,
            shifts: turnsOf(S, Gr),
            classes: {
                solid: S.convex ? {
                    rotations: classesOf(S, Gr, Gr.R),
                    all: classesOf(S, Gr, 2 * Gr.R)
                } : named,
                faces: named,
                petrial: named,
            },
        };
    }
    return groups[name];
};

// What draws the figure: WebGL, or SVG where there is none.
const backend = {
    R: null
};

// Position in the carousel, wrapped into [-N/2, N/2).
const wrap = (o, N) => mod(o + N / 2, N) - N / 2;

const init = () => {
    const toy = document.querySelector('.tt-toy');
    if (!toy) {
        return;
    }
    const svg = toy.querySelector('svg');
    // The figure is drawn with WebGL; with SVG where there is none, if its context is lost, or if ?gl=0 asks for it.
    const useSvg = () => {
        if (backend.R && backend.R.kind === 'webgl') {
            backend.R.el.remove();
        }
        backend.R = svgBackend(svg);
    };
    if (new URLSearchParams(location.search).get('gl') !== '0') {
        try {
            backend.R = glBackend(toy, {
                lost: () => {
                    useSvg();
                    wake();
                }
            });
        } catch (e) {
            console.warn('WebGL failed; drawing with SVG.', e);
        }
    }
    if (!backend.R) {
        useSvg();
    }
    theme.dark = darkTheme();
    theme.mix = theme.dark ? 1 : 0;
    readPalette(theme.dark);
    const strip = document.querySelector('.tt-strip');
    const ghostLayer = document.querySelector('.tt-ghosts');
    const familyLabel = document.getElementById('tt-family');
    const main = document.querySelector('.tt-main');
    const margin = document.querySelector('.tt-margin');
    const keys = document.querySelector('.tt-keys');
    const caption = document.getElementById('tt-cap');
    const say = document.getElementById('tt-say'); // for screen readers only

    const state = {
        family: 0,
        member: 0,
        solid: null,
        group: null,
        classes: null,
        scene: null,
        form: 'solid', // 'solid' (convex, ink), 'faces' (star), or 'petrial'
        view: [1, 0, 0, 0],
        zoom: 1, // the dual settles from its midsphere size
        pos: 0, // the product of every move so far
        current: 0, // the symmetry performed last
        mode: 'rotations', // or 'all'
        flag: false,
        flagAt: null, // the flag shown: the base flag's image under this symmetry (see centerFlag)
        moves: 0,
        queue: [],
        anim: null,
        spin: null,
        viewEase: null, // a view settling into the rest view
        drag: null,
        shifts: null, // the turn about each face, vertex and edge (turnsOf)
        aim: null, // the mouse, over the figure, in its SVG units
        aimKey: null, // what is under it, and since when (for the halo's fade)
        aimAt: null,
        aimBack: false, // shift held: a click would turn the other way
        phase: 0, // where a planar polyhedron sits on its lattice
        pan: [0, 0, 0], // the middle of a tiling's window, in the world
        cam: {
            zeta: 1
        }, // a blend's heights, as drawn (0: flat, as its tiling)
        glide: null, // a tiling coasting after a drag
        spotKey: null, // a zigzag picked out with F, by its key
    };

    let map = null; // Figure 2, made below
    const size = () => (state.mode === 'all' ? 2 * state.group.R : state.group.R);
    const randomMove = () => {
        const pool = state.group.pool && state.group.pool[state.mode];
        if (pool) {
            return pool[1 + Math.floor(Math.random() * (pool.length - 1))];
        }
        return 1 + Math.floor(Math.random() * (size() - 1)); // never the identity
    };
    const classText = i => {
        if (state.group.pure) {
            return describeSpace(state.group, i);
        }
        if (state.group.blend) {
            return describeBlend(state.group, i);
        }
        const c = state.mode === 'rotations' && i < state.group.R ? state.classes.rotations : state.classes.all;
        // A planar symmetry beyond those classed in advance, described afresh.
        if (i >= c.owner.length) {
            return describePlanar(state.solid, state.group, i, state.form === 'petrial' ? POLYGON[state.solid.pn] : 'face').text;
        }
        return c.list[c.owner[i]].text;
    };

    /* What is under a point of the figure (at, in the SVG's own units), as the figure stands now: { kind, k } for vertex k ('v'), edge k ('e') or face k ('f'), or null. A vertex or edge counts if the point is near it (nearer on the colored loops, which run just inside the edges) and no face hides it. Otherwise a solid or a star is cast through like a ray from the eye: of the faces whose outline holds the point, the nearest of those turned toward the viewer, or failing that the nearest of all. A Petrial's faces are skew, with no inside, so anywhere on the figure picks the face loop passing nearest, favoring the near side. */
    const VB = VIEWBOX.split(' ').map(Number);
    const svgPoint = e => {
        const r = svg.getBoundingClientRect();
        return [VB[0] + (VB[2] * (e.clientX - r.left)) / r.width, VB[1] + (VB[3] * (e.clientY - r.top)) / r.height];
    };
    const poseNow = () => mmul(qmat(state.view), state.group.G[state.pos].M);
    const featureUnder = at => {
        if (state.solid.spatial) {
            return blendFeatureUnder(at);
        }
        if (state.solid.planar) {
            return planarFeatureUnder(at);
        }
        const S = state.solid,
            T = poseNow(),
            P = S.V.map(v => mvec(T, v)),
            Q = P.map(screen);
        const front = frontOf(S, P, T),
            looped = state.form !== 'solid';
        const reachV = looped ? 18 : 26,
            reachE = looped ? 7 : 14;

        // How near the viewer face k is over the screen point q (-Infinity if it is not there), and whether a point at depth z over q is behind a face other than its own.
        const planes = S.FACES.map(f => {
            const ps = f.ids.map(i => P[i]);
            return {
                ps,
                n: newell(ps),
                q: f.ids.map(i => Q[i])
            };
        });
        const depth = (k, q) => {
            const {
                ps,
                n
            } = planes[k];
            if (!winds(planes[k].q, q) || Math.abs(n[2]) < 1e-3 * len(n)) {
                return -Infinity;
            } // edge-on
            return (dot(n, ps[0]) - n[0] * (q[0] - CENTER) / SCALE - n[1] * (CENTER - q[1]) / SCALE) / n[2];
        };
        const hidden = (q, z, own) => S.FACES.some((f, k) => !own(k) && depth(k, q) > z + 1e-3);

        // On a Petrial the strands run close by the edges: a vertex or edge counts only if the point is about as near it as any strand in front (so the crossing at an edge's middle is the edge's).
        let strand = Infinity;
        if (state.form === 'petrial') {
            S.LOOPS.petrie.forEach(loop => {
                const q = finiteStrand(loop.strand, T, 1);
                q.forEach((a, j) => {
                    if (front[loop.vis[j]] >= 0.5) {
                        strand = Math.min(strand, segDist(at, a, q[(j + 1) % q.length]));
                    }
                });
            });
        }

        let best = null,
            bestD = strand + 1.5;
        S.V.forEach((v, i) => {
            const d = Math.hypot(at[0] - Q[i][0], at[1] - Q[i][1]);
            if (d < reachV && d < bestD && !hidden(Q[i], P[i][2], k => S.FACES[k].ids.includes(i))) {
                best = {
                    kind: 'v',
                    k: i
                };
                bestD = d;
            }
        });
        if (best) {
            return best;
        }
        S.EDGES.forEach(([i, j], e) => {
            const a = Q[i],
                b = Q[j],
                dx = b[0] - a[0],
                dy = b[1] - a[1],
                L2 = dx * dx + dy * dy;
            const t = L2 < 1e-9 ? 0 : clamp(((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / L2, 0, 1);
            const q = [a[0] + t * dx, a[1] + t * dy],
                d = Math.hypot(at[0] - q[0], at[1] - q[1]);
            if (d < reachE && d < bestD && !hidden(q, P[i][2] + t * (P[j][2] - P[i][2]), k => S.EDGE_FACES[e].includes(k))) {
                best = {
                    kind: 'e',
                    k: e
                };
                bestD = d;
            }
        });
        if (best) {
            return best;
        }

        let face = -1,
            bestKey = -Infinity;
        if (state.form === 'petrial') {
            if (!winds(outline(Q).corners.map(c => c.a), at)) {
                return null;
            }
            S.LOOPS.petrie.forEach((loop, k) => {
                const q = finiteStrand(loop.strand, T, 1);
                q.forEach((a, j) => {
                    const key = -segDist(at, a, q[(j + 1) % q.length]) - 60 * (1 - front[loop.vis[j]]);
                    if (key > bestKey) {
                        bestKey = key;
                        face = k;
                    }
                });
            });
        } else {
            S.FACES.forEach((f, k) => {
                const z = depth(k, at);
                if (z === -Infinity) {
                    return;
                }
                const key = z + (front[k] >= 0.5 ? 10 : 0);
                if (key > bestKey) {
                    bestKey = key;
                    face = k;
                }
            });
        }
        return face < 0 ? null : {
            kind: 'f',
            k: face
        };
    };

    // What a click on a vertex, edge or face performs: the turn about it (turnsOf), counterclockwise as you look at it, or clockwise with back. With rotations only, a Petrial's face, whose own turn reverses orientation, turns two steps: the least rotation about it.
    const turnAbout = (hit, back) => {
        if (state.solid.spatial) {
            return blendTurn(hit, back);
        }
        if (state.solid.planar) {
            return planarTurn(hit, back);
        }
        const {
            kind,
            k
        } = hit, Gr = state.group, pos = state.pos;
        const set = kind === 'v' ? 'vertices' : kind === 'e' ? 'edges' : state.form === 'petrial' ? 'petrie' : 'faces';
        let s = state.shifts[set][k];
        if (state.mode === 'rotations' && !Gr.G[s].proper) {
            s = Gr.mul(s, s);
        }
        // The shifts are in the solid's own frame; carry them to where it stands.
        const here = h => Gr.mul(Gr.mul(pos, h), Gr.inv(pos));
        const a = here(s),
            b = here(Gr.inv(s)),
            g = Gr.G[a];
        const ccw = mvec(qmat(state.view), g.axis)[2] * g.angle >= 0;
        return ccw !== back ? a : b;
    };

    /* The planar polyhedra. The patch drawn is made afresh around whatever part of the tiling is in the window whenever the window drifts too near its edge, which, the tiling being the same everywhere, nothing shows. */
    const PATCH_SLACK = 1.4;
    // (A pure polyhedron, all in space, is cut to a ball inside the window, as a blend with a line is once risen. A tiling too keeps its size as a blend's window opens or closes: see inkScale.)
    const planarPoseNow = (A = null) => {
        const S = state.solid,
            M = state.group.G[state.pos].M,
            MA = A ? compose(A, M) : M,
            k = inkScale(),
            z = S.zoom * state.zoom * k;
        const pose = S.spatial ? blendPose(MA, z, state.pan, {
            view: state.view,
            zeta: S.pure ? 1 : state.cam.zeta,
            line: S.q === 'line' || S.pure
        }) : planarPose(MA, z, state.pan);
        pose.ink = k;
        return pose;
    };
    // A blend's patch reaches across the window as the camera sees it, and (for the line) up and down through the layers shown.
    const blendReach = pose => pose.reach + 0.9;
    const blendPatchAround = (S, pose) => blendPatchOf(S, pose.pre, S.pure ? pose.ball + 1.4 * Math.max(1, S.edge) : blendReach(pose) + 0.8, pose.ball);
    // (While the window opens, a patch for all it will show once open, made once: see setWide.)
    const openPose = (pose, k = inkOpen()) => (pose.ink && k < pose.ink ? {
        ...pose,
        ball: (pose.ball * pose.ink) / k,
        reach: (pose.reach * pose.ink) / k
    } : pose);
    const windowReach = pose => WIN_DIAG / (SCALE * pose.zoom) + 0.75; // tiling units, with a face to spare
    const patchAround = (S, pose) => patchOf(S, [pose.pre[0], pose.pre[1], 0], windowReach(pose) + PATCH_SLACK);
    // (A scene made afresh keeps the time its faces were muted.)
    const rescene = scene => {
        scene.mutedAt = state.scene.mutedAt;
        state.scene = scene;
    };
    const ensurePatch = pose => {
        const p = state.scene.patch;
        if (state.solid.spatial) {
            // (Not while a blend goes: see operateBlend.)
            if (op && op.frozen && !op.swapped) {
                return;
            }
            const dz = state.solid.q === 'line' ? Math.abs(pose.pre[2] - p.center[2]) + pose.ball - p.H : -1;
            const off = state.solid.pure ? len(sub(pose.pre, p.center)) : Math.hypot(pose.pre[0] - p.center[0], pose.pre[1] - p.center[1]);
            if (off + (state.solid.pure ? pose.ball + 0.3 : blendReach(pose)) <= p.R && dz <= 0) {
                return;
            }
            rescene(buildBlendScene(state.solid, state.form, blendPatchAround(state.solid, openPose(pose))));
            return;
        }
        if (state.anim && state.anim.band) {
            return;
        } // a flip brings its own (see startNext)
        if (p && !p.band && len(sub(pose.pre, p.center)) + windowReach(pose) <= p.R) {
            return;
        }
        rescene(buildPlanarScene(state.solid, state.form, patchAround(state.solid, pose)));
    };

    // What is under a point of a planar figure, inside its window: a vertex, an edge, or the face there; on a Petrial, the zigzag passing nearest.
    const planarFeatureUnder = at => {
        const S = state.solid,
            patch = state.scene.patch,
            pose = planarPoseNow();
        if (!insideWindow(at, 6)) {
            return null;
        }
        const Q = patch.V.map(v => screen(pose.map(v))),
            petrial = state.form === 'petrial';
        const reachV = petrial ? 18 : 24,
            reachE = petrial ? 7 : 13;
        // The zigzag passing nearest; a vertex or edge counts only if about as near (so the crossing at an edge's middle is the edge's).
        let zig = null,
            strand = Infinity;
        if (petrial) {
            patch.LOOPS.petrie.forEach((loop, k) => {
                const X = screenNodes(loop, S.inset, pose.A2);
                for (let i = 0; i + 3 < X.length; i += 2) {
                    const d = segDist(at, [X[i], X[i + 1]], [X[i + 2], X[i + 3]]);
                    if (d < strand) {
                        strand = d;
                        zig = {
                            kind: 'f',
                            k
                        };
                    }
                }
            });
        }
        let best = null,
            bestD = strand + 1.5;
        Q.forEach((q, i) => {
            const d = Math.hypot(at[0] - q[0], at[1] - q[1]);
            if (d < reachV && d < bestD) {
                best = {
                    kind: 'v',
                    k: i
                };
                bestD = d;
            }
        });
        if (best) {
            return best;
        }
        patch.EDGES.forEach(([i, j], e) => {
            const d = segDist(at, Q[i], Q[j]);
            if (d < reachE && d < bestD) {
                best = {
                    kind: 'e',
                    k: e
                };
                bestD = d;
            }
        });
        if (best) {
            return best;
        }
        if (petrial) {
            return zig;
        }
        const k = patch.FACES.findIndex(f => winds(f.ids.map(i => Q[i]), at));
        return k < 0 ? null : {
            kind: 'f',
            k
        };
    };

    // The turn about it: by 360°/q about a vertex, a half-turn about the midpoint of an edge, by 360°/p about the center of a face, counterclockwise as seen (clockwise with back). On a Petrial, one step along the zigzag, a glide reflection (two steps, a translation, with rotations only), rightward on screen (leftward with back).
    const planarTurn = ({
        kind,
        k
    }, back) => {
        const S = state.solid,
            Gr = state.group,
            patch = state.scene.patch,
            M = Gr.G[state.pos].M;
        const W = v => applyAffine(M, v);
        if (kind === 'f' && state.form === 'petrial') {
            const z = patch.PETRIE[k].verts.map(v => W(patch.V[v])),
                i = Math.floor(z.length / 2) - 1;
            let s = -1;
            for (const P of Gr.PG) {
                const L2 = P.L2,
                    m2 = p => [L2[0] * p[0] + L2[1] * p[1], L2[2] * p[0] + L2[3] * p[1], 0];
                const t = sub(z[i + 1], m2(z[i]));
                if (len(sub(add(m2(z[i + 1]), t), z[i + 2])) < 1e-6 && len(sub(add(m2(z[i + 2]), t), z[i + 3])) < 1e-6) {
                    s = Gr.lookup(L2, t);
                    break;
                }
            }
            if (s < 0) {
                return 0;
            }
            if (state.mode === 'rotations' && !Gr.G[s].proper) {
                s = Gr.mul(s, s);
            }
            const g = Gr.G[s],
                d = g.kind === 'glide' ? scale(g.u, g.glide) : g.t;
            const right = Math.abs(d[0]) > 0.2 * Math.abs(d[1]) ? d[0] > 0 : d[1] > 0;
            return right !== back ? s : Gr.inv(s);
        }
        const [a, b] = kind === 'e' ? patch.EDGES[k] : [0, 0];
        const c = kind === 'v' ? W(patch.V[k]) : kind === 'e' ? W(scale(add(patch.V[a], patch.V[b]), 0.5)) : W(patch.FACES[k].center);
        const th = (2 * Math.PI) / (kind === 'v' ? S.qn : kind === 'e' ? 2 : S.pn);
        const turn = x => {
            const C = Math.cos(x),
                Sn = Math.sin(x);
            return Gr.lookup([C, -Sn, Sn, C], [c[0] - (C * c[0] - Sn * c[1]), c[1] - (Sn * c[0] + C * c[1]), 0]);
        };
        return Math.max(0, turn(back ? -th : th));
    };

    /* A blend: what is under a point (the nearest of what is near enough, nearer the eye winning ties), and the turn about it, found from where it sends a few points. */
    const blendFeatureUnder = at => {
        const S = state.solid,
            patch = state.scene.patch,
            pose = planarPoseNow();
        if (!insideWindow(at, 6)) {
            return null;
        }
        const pj = blendProject(state.scene, pose),
            r2 = pose.ball * pose.ball,
            VW = pj.verts.W,
            VV = pj.verts.Vv;
        // (Only what is drawn: what is in the ball, and on a Petrial in the chunks in view.)
        const inBall = (W, i) => W[3 * i] ** 2 + W[3 * i + 1] ** 2 + W[3 * i + 2] ** 2 <= r2;
        const proj = patch.V.map((p, i) => ({
            q: screen([VV[3 * i], VV[3 * i + 1]]),
            z: VV[3 * i + 2],
            shown: inBall(VW, i),
        }));
        const petrial = state.form === 'petrial',
            reachV = petrial ? 16 : 22,
            reachE = petrial ? 6 : 12;
        let zig = null,
            strand = Infinity;
        if (petrial) {
            pj.strands.forEach((set, k) => {
                const V = set.Vv,
                    W = set.W,
                    per = state.scene.loops[k].per,
                    n = V.length / 3;
                for (let c = 0; c < set.vis.length; c++) {
                    if (!set.vis[c]) {
                        continue;
                    }
                    for (let i = per * c; i < Math.min(n - 1, per * c + per); i++) {
                        if (!inBall(W, i) && !inBall(W, i + 1)) {
                            continue;
                        }
                        const d = segDist(at, screen([V[3 * i], V[3 * i + 1]]), screen([V[3 * i + 3], V[3 * i + 4]]));
                        if (d < strand) {
                            strand = d;
                            zig = {
                                kind: 'f',
                                k
                            };
                        }
                    }
                }
            });
        }
        const better = (d, z, best) => !best || d < best.d - 4 || (d < best.d + 4 && z > best.z);
        let best = null;
        proj.forEach((p, i) => {
            const d = Math.hypot(at[0] - p.q[0], at[1] - p.q[1]);
            if (p.shown && d < reachV && d < strand + 1.5 && better(d, p.z, best)) {
                best = {
                    kind: 'v',
                    k: i,
                    d,
                    z: p.z
                };
            }
        });
        if (best) {
            return {
                kind: best.kind,
                k: best.k
            };
        }
        patch.EDGES.forEach(([i, j], e) => {
            if (!proj[i].shown || !proj[j].shown) {
                return;
            }
            const d = segDist(at, proj[i].q, proj[j].q);
            if (d < reachE && d < strand + 1.5 && better(d, (proj[i].z + proj[j].z) / 2, best)) {
                best = {
                    kind: 'e',
                    k: e,
                    d,
                    z: (proj[i].z + proj[j].z) / 2
                };
            }
        });
        if (best) {
            return {
                kind: best.kind,
                k: best.k
            };
        }
        if (petrial) {
            return zig;
        }
        // A face: a closed one by its outline; a helix by any turn of it.
        let face = null;
        patch.FACES.forEach((f, k) => {
            const ids = f.ids,
                n = S.pn,
                spans = f.closed ? [ids] : Array.from({
                    length: Math.max(0, ids.length - n + 1)
                }, (x, i) => ids.slice(i, i + n));
            spans.forEach(span => {
                if (!span.every(i => proj[i].shown) || !winds(span.map(i => proj[i].q), at)) {
                    return;
                }
                const z = span.reduce((sum, i) => sum + proj[i].z, 0) / span.length;
                if (!face || z > face.z) {
                    face = {
                        kind: 'f',
                        k,
                        z
                    };
                }
            });
        });
        return face ? {
            kind: 'f',
            k: face.k
        } : null;
    };

    // The turn about it: about a vertex, its neighbors one step around it; about an edge, the half-turn swapping its ends; about a face (or a Petrial's face), one step along it. Counterclockwise as seen (or not, with back); with rotations only, an orientation-reversing turn turns twice, the least rotation about it.
    const blendTurn = (hit, back) => {
        const S = state.solid,
            Gr = state.group,
            patch = state.scene.patch,
            M = Gr.G[state.pos].M,
            pose = planarPoseNow();
        const W = p => applyAffine(M, p),
            seenAt = p => {
                const v = mvec(pose.Vc, sub(p, [state.pan[0], state.pan[1], 0]));
                return [v[0], v[1]];
            };
        const orient = (a, b, center, from) => {
            if (a < 0) {
                return 0;
            }
            let s1 = a,
                s2 = b;
            if (state.mode === 'rotations' && !Gr.G[s1].proper) {
                s1 = Gr.mul(s1, s1);
                s2 = s2 >= 0 ? Gr.mul(s2, s2) : -1;
            }
            if (s2 < 0) {
                return s1;
            }
            // Which of the two turns looks counterclockwise.
            const c = seenAt(center),
                p = seenAt(from),
                q = seenAt(applyAffine(Gr.G[s1].M, from));
            const ccw = cross2(sub(p, c), sub(q, c)) > 0;
            return ccw !== back ? s1 : s2;
        };
        if (hit.kind === 'e') {
            const [i, j] = patch.EDGES[hit.k], a = W(patch.V[i]), b = W(patch.V[j]);
            return Math.max(0, solveIn(S, [
                [a, b],
                [b, a]
            ], true));
        }
        if (hit.kind === 'v') {
            // The ring of neighbors, from the faces through the vertex.
            // (Faces come traced either way round: neighbors are next to each other around the vertex if a face passes from one to the other through it.)
            const v = hit.k,
                ring = [];
            const nbr = patch.EDGES.filter(e => e.includes(v)).map(([i, j]) => (i === v ? j : i));
            const adj = new Map(nbr.map(x => [x, new Set()]));
            patch.FACES.forEach(f => {
                const n = f.ids.length;
                f.ids.forEach((x, m) => {
                    if (x !== v || (!f.closed && (m === 0 || m === n - 1))) {
                        return;
                    }
                    const pv = f.ids[(m + n - 1) % n],
                        nx = f.ids[(m + 1) % n];
                    if (adj.has(pv) && adj.has(nx)) {
                        adj.get(pv).add(nx);
                        adj.get(nx).add(pv);
                    }
                });
            });
            let cur = nbr[0];
            for (let g = 0; g < 12 && cur !== undefined; g++) {
                ring.push(cur);
                cur = [...(adj.get(cur) || [])].find(x => !ring.includes(x));
            }
            if (ring.length < 3) {
                return 0;
            }
            const V0 = W(patch.V[v]),
                [n0, n1, n2] = ring.map(i => W(patch.V[i]));
            return orient(solveIn(S, [
                [V0, V0],
                [n0, n1],
                [n1, n2]
            ]), solveIn(S, [
                [V0, V0],
                [n1, n0],
                [n2, n1]
            ]), V0, n0);
        }
        const ids = (state.form === 'petrial' ? patch.LOOPS.petrie : patch.FACES)[hit.k].ids;
        const i0 = state.form === 'petrial' ? Math.floor(ids.length / 2) - 2 : 0,
            n = ids.length,
            at = m => W(patch.V[ids[(i0 + m) % n]]);
        const fwd = solveIn(S, [
                [at(0), at(1)],
                [at(1), at(2)],
                [at(2), at(3)]
            ]),
            bwd = solveIn(S, [
                [at(1), at(0)],
                [at(2), at(1)],
                [at(3), at(2)]
            ]);
        return orient(fwd, bwd, mean([0, 1, 2, 3].map(at)), at(0));
    };

    /* Frame loop: runs only while something is moving. */
    let raf = 0;
    const wake = () => {
        if (!raf) {
            raf = requestAnimationFrame(frame);
        }
    };

    // The old faces of an operation go gray (scene.mutedAt), and what the pointer is on comes in, each over a moment; the theme fades.
    const CSS_EASE = bezier(0.25, 0.1, 0.25, 1);
    const since = (t0, dur, now) => (t0 == null ? 0 : clamp((now - t0) / dur, 0, 1));
    const frame = now => {
        raf = 0;
        let busy = false;
        if (theme.fade) {
            const e = since(theme.fade.t0, 450, now);
            theme.mix = theme.fade.from + (theme.fade.to - theme.fade.from) * CSS_EASE(e);
            if (e >= 1) {
                theme.fade = null;
            } else {
                busy = true;
            }
        }
        // The flag, if shown, is the one chosen in the middle (centerFlag).
        if (state.flag && state.flagAt === null) {
            state.flagAt = centerFlag();
        }
        const flagM = state.flag ? state.group.G[state.flagAt].M : null;
        let fx = {
            flag: state.flag,
            flagM,
            spot: state.spotKey
        };
        // The carousel turning (stepTrans); a tiling coming in on left or right, its tiles falling into place.
        if (trans && stepTrans(now)) {
            busy = true;
        }
        if (trans && trans.kind === 'tiles' && state.solid.planar) {
            fx.fall = {
                mode: 'in',
                t: trans.fallIn || 0
            };
        }

        if (state.viewEase) {
            const {
                from,
                t0,
                dur
            } = state.viewEase, t = since(t0, dur, now);
            state.view = slerp(from, state.solid.q0, EASE_VIEW(t));
            if (t >= 1) {
                state.view = state.solid.q0;
                state.viewEase = null;
            } else {
                busy = true;
            }
        }

        if (state.glide) {
            const dt = Math.min(48, now - state.glide.last),
                v = state.glide.v;
            state.glide.last = now;
            state.pan = add(state.pan, scale(v, dt));
            state.glide.v = scale(v, Math.exp(-dt / 320));
            if (len(v) * SCALE * state.solid.zoom < 0.02) {
                state.glide = null;
            } else {
                busy = true;
            }
        }

        if (state.spin) {
            const dt = Math.min(48, now - state.spin.last);
            state.spin.last = now;
            const w = state.spin.w,
                speed = len(w);
            state.view = qnorm(qmul(qaxis(scale(w, 1 / speed), speed * dt), state.view));
            state.spin.w = scale(w, Math.exp(-dt / 320));
            if (speed < 4e-5) {
                state.spin = null;
            } else {
                busy = true;
            }
        }

        // An operation in progress: it sets fills and fades, may swap the solid underneath, and draws its face loops on top.
        // (What it sets holds only while it runs: the frame it finishes on draws the new polyhedron as it is at rest.)
        let opDraw = null;
        if (op) {
            const ofx = {};
            const r = op.update(now - op.t0, ofx);
            if (r === 'done') {
                finishOp();
            } else {
                Object.assign(fx, ofx);
                opDraw = r;
                busy = true;
            }
        }
        if (!state.anim && !op && state.queue.length) {
            startNext(now);
        }

        const S = state.solid,
            Gr = state.group;
        const V = qmat(state.view);
        let A = I3;
        fx.view = V;

        if (state.anim) {
            const m = state.anim;
            const t = since(m.t0, m.dur, now);
            if (t >= 1) {
                finish();
            } else {
                A = m.at(EASE(t));
                // (Nothing is laid over the figure while it moves: the axis and mirror show only beforehand, under the pointer.)
                if (m.band) {
                    fx.band = {
                        ...m.band,
                        c: Math.cos(Math.PI * EASE(t))
                    };
                }
                busy = true;
            }
        }
        const pose = S.planar || S.spatial ? planarPoseNow(A === I3 ? null : A) : null;
        if (pose) {
            ensurePatch(pose);
        }

        // At rest, a vertex, edge or face under the pointer shows what a click on it would do: the axis (and mirror) of its symmetry, and what it turns about.
        const resting = !state.anim && !op && !trans && !(state.drag && state.drag.moved);
        const aimed = resting && state.aim ? featureUnder(state.aim) : null;
        if (resting) {
            toy.classList.toggle('is-aiming', aimed !== null);
        }
        if (resting && !state.queue.length) {
            prepareBlends();
            prepareNear();
            const h = aimed ? turnAbout(aimed, state.aimBack) : null;
            if (h !== null) {
                const o = overlayFor(S, Gr, h);
                fx = {
                    ...fx,
                    ...o,
                    axisAlpha: 0.55,
                    mirrorAlpha: 0.55,
                    centerAlpha: o.center ? 0.6 : 0,
                    aim: aimed
                };
            }
        }

        const aimKey = fx.aim ? `${fx.aim.kind}${fx.aim.k}` : null;
        if (aimKey !== state.aimKey) {
            state.aimKey = aimKey;
            state.aimAt = now;
        }
        fx.aimFade = CSS_EASE(since(state.aimAt, 120, now));
        fx.muted = CSS_EASE(since(state.scene.mutedAt, 350, now));
        if ((aimKey && fx.aimFade < 1) || (state.scene.mutedAt != null && fx.muted < 1)) {
            busy = true;
        }

        const dl = list();
        if (pose && S.spatial) {
            drawBlend(dl, state.scene, S, pose, fx);
        } else if (pose) {
            drawPlanar(dl, state.scene, S, pose, fx);
        } else {
            const T = mmul(mmul(V, A), Gr.G[state.pos].M);
            draw(dl, state.scene, S, state.zoom === 1 ? T : T.map(x => x * state.zoom), fx);
            // (Coming in as a wider window closes, at the size it will be.)
            dl.scale = inkScale();
        }
        // An operation's faces being traced, over the figure.
        if (opDraw) {
            opDraw(dl.group());
        }
        // The old tiling's tiles falling away, over the new one's falling in.
        if (trans && trans.kind === 'tiles' && trans.out && trans.out.t < 1) {
            const o = trans.out;
            drawPlanar(dl.group(), o.scene, o.S, o.pose, {
                fall: {
                    mode: 'out',
                    t: o.t
                }
            });
        }
        backend.R.render(dl);
        if (busy || state.queue.length || now < wideUntil) {
            wake();
        }
    };

    // Every move performs one symmetry g, always the same motion on screen whatever came before: a turn about g's axis, a pass through g's mirror, or (for the identity) nothing but a flash of the faces. A move is a given g, a random one, or a click on the figure at `at`: the turn about whichever vertex, edge or face is there as the move begins (if a click came during another move, the one that has come to rest where it clicked).
    const startNext = now => {
        const Gr = state.group;
        const item = state.queue.shift();
        let g = item.g;
        if (item.at) {
            const hit = featureUnder(item.at);
            if (!hit) {
                return;
            }
            g = turnAbout(hit, item.back);
        }
        if (g === undefined) {
            g = Gr.planar || Gr.blend ? nearMiddle(randomMove()) : randomMove();
        }
        const next = Gr.mul(g, state.pos);
        state.anim = {
            ...buildMove(state.solid, Gr, g, now),
            g,
            next,
            band: Gr.planar ? flipBand(g) : null
        };
        state.current = g;
        state.moves += 1;
        say.textContent = g === 0 ? 'The identity.' : `${capitalize(classText(g))}.`;
    };

    // A tiling's or a blend's random move, carried to the middle of the window by the translation that brings the origin nearest it.
    const nearMiddle = g => {
        const Gr = state.group,
            P = Gr.blend ? Gr.P : Gr,
            [i, j] = P.toLattice(state.pan).map(Math.round);
        const t = P.lookup([1, 0, 0, 1], P.fromLattice(i, j)),
            tau = Gr.blend ? liftToBlend(state.solid, t) : t;
        return Gr.mul(Gr.mul(tau, g), Gr.inv(tau));
    };
    // A reflection squashes the tiling through its mirror (see bandSlab): a band along the mirror wide enough to fill the window at the start, and a patch to fill the band.
    const flipBand = g => {
        const el = state.group.G[g],
            S = state.solid;
        if (el.kind !== 'refl' && el.kind !== 'glide') {
            return null;
        }
        const pose = planarPoseNow(),
            n = [-el.u[1], el.u[0], 0],
            reach = WIN_DIAG / (SCALE * pose.zoom);
        const D = Math.abs(dot(sub(state.pan, el.p), n)) + reach + 0.1;
        const foot = add(el.p, scale(el.u, dot(sub(state.pan, el.p), el.u))),
            along = reach + Math.abs(el.glide) + 1.2;
        const M = state.group.G[state.pos].M;
        const keep = ctr => {
            const w = applyAffine(M, ctr);
            return Math.abs(dot(sub(w, el.p), n)) <= D + 0.8 && Math.abs(dot(sub(w, foot), el.u)) <= along;
        };
        const patch = patchOf(S, [pose.pre[0], pose.pre[1], 0], Math.hypot(2 * D + 0.8, along) + 1, keep);
        patch.band = true;
        state.scene = buildPlanarScene(S, state.form, patch);
        return {
            p: el.p,
            u: el.u,
            D
        };
    };

    const finish = () => {
        state.pos = state.anim.next;
        state.anim = null;
        if (pendingOp) {
            const k = pendingOp;
            pendingOp = null;
            operate(k);
        }
    };

    const enqueue = item => {
        if (trans || op) {
            return;
        } // not while changing solids
        if (state.queue.length < 3) {
            state.queue.push(item);
        }
        wake();
    };

    /* Words for Schläfli symbols. p, q and h are strings: '5/2', '10/3'. */
    const SKEW = {
        4: 'skew quadrilaterals',
        6: 'skew hexagons',
        10: 'skew decagons',
        '10/3': 'skew decagrams'
    };
    const sym = (a, b, r) => `{${a},&nbsp;${b}}${r ? `<sub>${r}</sub>` : ''}`;
    const baseForm = S => (S.convex || S.planar || S.spatial ? 'solid' : 'faces');
    const title = () => (state.form === 'petrial' ? `Petrial of the ${state.solid.title}` : state.solid.title);
    const keyOfNode = (name, form) => `${name}${form === 'petrial' ? '-petrial' : ''}`;
    // (And back: a key's polyhedron, and whether it is the Petrial.)
    const nodeOf = key => {
        const petrial = key.endsWith('-petrial');
        return {
            name: petrial ? key.slice(0, -8) : key,
            petrial
        };
    };

    // Figure 1's caption names the polyhedron and its Schläfli symbol.
    const describeSolid = () => {
        const S = state.solid,
            d = S.def,
            petrial = state.form === 'petrial';
        const t = title();
        toy.setAttribute('aria-label', `${capitalize(t)}. Press to apply a random symmetry.`);
        if (S.pure) {
            // A pure polyhedron: its name, if it has one, and its symbol.
            const sm = petrial ? d.psym : d.sym;
            caption.innerHTML = d.title ? `The ${petrial ? 'Petrial of the ' : ''}${d.title}, ${sm}.` : `The pure polyhedron ${sm}${petrial ? `, the Petrial of ${d.sym}` : ''}.`;
            const word = {
                pc: petrial ? 'Their Petrials, with helical faces' : 'Petrie–Coxeter polyhedra',
                skew: 'Pure polyhedra with skew faces',
                helical: 'Pure polyhedra with helical faces'
            } [d.pure.kind];
            setLabel(word, petrial);
        } else if (S.blend) {
            // A blend is named by what it blends: P # { } or P # {∞}.
            const b = S.base.def;
            caption.innerHTML = `The ${t}, ${petrial ? sym(b.h, b.q, b.p) : sym(b.p, b.q)}&nbsp;#&nbsp;${d.tag}.`;
            setLabel(`${petrial ? 'Petrials blended' : 'Blended'} with a ${S.q === 'seg' ? 'segment' : 'line'}`, petrial);
        } else {
            caption.innerHTML = `The ${t}, ${petrial ? sym(d.h, d.q, d.p) : sym(d.p, d.q)}.`;
            const kind = S.convex || S.planar ? FAMILIES[state.family].name : 'Kepler–Poinsot polyhedra';
            setLabel(petrial ? `Petrials of the ${S.planar ? 'regular tilings' : kind}` : kind, petrial);
        }
        try {
            history.replaceState(null, '', `#${keyOfNode(S.name, state.form)}`);
        } catch {
            /* file:// in some browsers */ }
    };

    // Shift-F: the flag, shown in the middle of the screen. Of all the flags (each the base flag's image under a symmetry), the one whose chamber is nearest the middle of the window, and nearest the viewer; after that it goes with the polyhedron, so a move carries it along.
    // (A flag's chamber: the middle of its vertex v, the midpoint of its edge from v to o, and c, its face's middle, or on a Petrial or a blend the midpoint of its other edge.)
    const chamber = (v, o, c) => mean([v, mean([v, o]), c]);
    const centerFlag = () => {
        const S = state.solid,
            Gr = state.group,
            form = state.form;
        if (S.spatial) {
            const pose = planarPoseNow(),
                c0 = chamber(S.u0, S.u1, mean([S.u0, S.uPrev]));
            let best = 0,
                key = Infinity;
            for (const t of state.scene.patch.flags || []) {
                const v = pose.map(Gr.act(t, c0)),
                    k = Math.hypot(v[0], v[1]) - 0.15 * v[2];
                if (k < key) {
                    key = k;
                    best = Gr.idx(t);
                }
            }
            return best;
        }
        if (S.planar) {
            const pose = planarPoseNow(),
                fl = S.flag,
                pre = pose.pre;
            const c0 = chamber(fl.v, fl.o, form === 'petrial' ? mean([fl.v, fl.prev]) : fl.c);
            let best = 0,
                key = Infinity;
            Gr.PG.forEach((P, a) => {
                const Lc = mvec(P.L, c0),
                    [i0, j0] = Gr.toLattice(sub(pre, Lc)).map(Math.round);
                for (let i = i0 - 1; i <= i0 + 1; i++) {
                    for (let j = j0 - 1; j <= j0 + 1; j++) {
                        const w = add(Lc, Gr.fromLattice(i, j)),
                            k = Math.hypot(w[0] - pre[0], w[1] - pre[1]);
                        if (k < key - 1e-9) {
                            key = k;
                            best = Gr.idx([a, i, j]);
                        }
                    }
                }
            });
            return best;
        }
        // A finite polyhedron: the chamber on the face (or corner) in front, nearest the middle.
        const T = poseNow(),
            V = S.V;
        const base = form === 'solid' ? S.flag : form === 'petrial' ? S.petrialFlag : S.faceFlag;
        const c0 = chamber(V[base.vertex], V[base.other], form === 'solid' ? S.FACES[base.face].center : mean([V[base.vertex], V[base.prev]]));
        let best = 0,
            key = Infinity;
        Gr.G.forEach((g, h) => {
            const w = mvec(T, mvec(g.M, c0)),
                k = Math.hypot(w[0], w[1]) - 0.6 * w[2];
            if (k < key) {
                key = k;
                best = h;
            }
        });
        return best;
    };
    const toggleFlag = () => {
        state.flag = !state.flag;
        state.flagAt = null;
        say.textContent = state.flag ? 'The flag, in the middle.' : 'No flag.';
        syncHints();
        wake();
    };

    // Control-F (on a Mac): a face picked out, at random from those nearest the middle of the window, on a tiling or a blend (a tiling's faces, a blend's skew faces or helices, or a Petrial's zigzags); again, none. On a finite polyhedron: one of a Petrial's Petrie polygons, or of a star's faces, at random (a convex solid's faces are all in ink).
    const pickFace = () => {
        const S = state.solid;
        if (state.spotKey !== null) {
            state.spotKey = null;
            say.textContent = 'All the faces.';
            syncHints();
            wake();
            return;
        }
        if (!S.planar && !S.spatial) {
            if (state.form === 'solid') {
                say.textContent = 'Control-F picks out a face of a Petrial, a star polyhedron, a tiling or a blend.';
                return;
            }
            // (Of those in view: a face turned toward you, a Petrie polygon lying mostly in front.)
            const T = poseNow(),
                petrial = state.form === 'petrial';
            const n = (petrial ? S.PETRIE : S.FACES).length,
                z = k => (petrial ?
                    S.PETRIE[k].reduce((t, v) => t + mvec(T, S.V[v])[2], 0) / S.PETRIE[k].length :
                    (det3(T) < 0 ? -1 : 1) * S.FACES[k].orient * unit(newell(S.FACES[k].ids.map(i => mvec(T, S.V[i]))))[2]);
            const order = [...Array(n).keys()].sort((a, b) => z(b) - z(a)),
                seen = order.slice(0, Math.max(1, Math.ceil(n / 3)));
            state.spotKey = seen[Math.floor(Math.random() * seen.length)];
            say.textContent = `${petrial ? 'Petrie polygon' : 'Face'} ${state.spotKey + 1} of ${n}.`;
            syncHints();
            wake();
            return;
        }
        const pose = planarPoseNow(),
            from = q => Math.hypot(q[0] - CENTER, q[1] - CENTER);
        let seen;
        if (S.planar && state.form === 'solid') {
            seen = state.scene.patch.FACES.map(f => ({
                key: f.key,
                d: from(screen(pose.map(f.center)))
            }));
        } else {
            seen = (S.spatial ? state.scene.loops : state.scene.patch.LOOPS.petrie).map(l => {
                const qs = l.nodes.map(nd => screen(pose.map(nd.base))).filter(q => insideWindow(q, 24));
                return qs.length ? {
                    key: l.key,
                    d: Math.min(...qs.map(from))
                } : null;
            }).filter(Boolean);
        }
        seen.sort((a, b) => a.d - b.d);
        const near = seen.filter(x => x.d <= seen[0].d + 0.12 * SCALE).slice(0, 5);
        if (!near.length) {
            return;
        }
        state.spotKey = near[Math.floor(Math.random() * near.length)].key;
        say.textContent = 'One face picked out.';
        syncHints();
        wake();
    };

    // The label over the picker turns on the wheel whenever it changes: with the family (labelTurn, the way the arrows went), or with an operation (forward into a Petrial, back out of one).
    let labelTurn = 0,
        labelPetrial = false;
    const setLabel = (text, petrial) => {
        const old = familyLabel.textContent,
            d = labelTurn || (petrial || !labelPetrial ? 1 : -1);
        labelTurn = 0;
        labelPetrial = petrial;
        if (old === text) {
            return;
        }
        const copy = familyLabel.cloneNode(true);
        familyLabel.textContent = text;
        if (old) {
            wheelBlock(familyLabel, copy, d);
        }
    };

    // Switch to a polyhedron. keep: the same symmetries carry over (a Petrial, a facetting, a planar dual), so the position stays, re-indexed into the new solid's group if it has its own. phase: where a planar polyhedron sits on its lattice. moveMap: false when an operation is already moving the map's marker. carry: a position in the new solid's group, carried over from the old (by a blend, B); zeta: how far its heights have risen to start from, 0 (flat) to 1 (see blendPose). patch: a blend's patch made beforehand, for it to use; zoom: the zoom to start from (see operateBlend).
    const setSolid = (name, {
        form = null,
        view = null,
        keep = false,
        keepMotion = false,
        moveMap = true,
        phase = 0,
        carry = null,
        zeta = 1,
        patch = null,
        zoom = 1
    } = {}) => {
        if (!known(name)) {
            name = 'dodecahedron';
        }
        if (familyOf(name) !== state.family) {
            changeFamily(familyOf(name));
        }
        const S = solidOf(name, phase),
            {
                Gr,
                classes,
                shifts
            } = groupOf(name, phase);
        form = form || baseForm(S);
        // (A polyhedron that is its own Petrial is shown as itself, even when its Petrial is asked for, as by a link.)
        if (form === 'petrial' && S.pure && S.def.pure.selfPetrie) {
            form = baseForm(S);
        }
        // A star's place in the carousel is the Platonic solid whose vertices it shares: the icosahedron, or (for the great stellated dodecahedron) the dodecahedron.
        const home = S.spatial ? S.home : S.convex || S.planar ? name : S.V.length === 20 ? 'dodecahedron' : 'icosahedron';
        const k = FAMILIES[state.family].members.indexOf(home);
        // (The flag shown stays where it is when the symmetries do; otherwise it is chosen afresh, in the middle.)
        let kept = {
            pos: 0,
            current: 0,
            moves: 0,
            flagAt: null
        };
        if (carry !== null) {
            kept = {
                pos: carry,
                current: 0,
                moves: state.moves,
                flagAt: null
            };
        } else if (keep && state.group === Gr) {
            kept = {
                pos: state.pos,
                current: state.current,
                moves: state.moves,
                flagAt: state.flagAt
            };
        } else if (keep && state.group) {
            const old = state.group,
                re = i => Gr.find(old.G[i].M);
            kept = {
                pos: re(state.pos),
                current: re(state.current),
                moves: state.moves,
                flagAt: state.flagAt === null ? null : re(state.flagAt)
            };
        }
        Object.assign(state, {
            member: k >= 0 ? k : state.member,
            solid: S,
            phase: S.planar || S.blend ? phase : 0,
            form,
            group: Gr,
            classes: classes[form],
            shifts,
            view: view || S.q0,
            zoom,
            ...kept,
            ...(keep || carry !== null ? {} : {
                pan: [0, 0, 0],
                glide: null
            }),
            spotKey: null,
            cam: {
                zeta
            },
            ...(keepMotion ? {} : {
                spin: null,
                viewEase: null
            }),
            queue: [],
            anim: null,
        });
        // A blend, or a pure polyhedron, has (on a wide screen) a larger window, and a patch for all of it.
        setWide(S.spatial);
        state.scene = S.spatial ? buildBlendScene(S, form, patch || blendPatchAround(S, openPose(planarPoseNow()))) :
            S.planar ? buildPlanarScene(S, form, patchAround(S, planarPoseNow())) : buildScene(S, form);
        describeSolid();
        syncHints();
        // A blend has its own map and its own title.
        syncMap();
        syncHeading(S.blend ? 1 : -1);
        if (moveMap && map) {
            map.go(keyOfNode(name, form));
        }
        wake();
    };

    /* Operations: P the Petrial, D the dual, F the facetting (R0, R1, R2) ↦ (R0, R1R2R1, R2); among the pure polyhedra H the halving and S the skewing too; and B and Shift-B the blends (see operateBlend). Each traces the new faces in color over the old figure, then takes the old faces away, and leaves the figure on the new polyhedron. */
    let op = null,
        pendingOp = null;

    // Faces trace out together, staggered; each pen moves at a steady pace. Petrie polygons go more nearly one at a time.
    const traceTimes = (n, segs, oneByOne) => {
        const each = reducedMotion.matches ? 1 : oneByOne ? Math.min(1500, 400 + 80 * segs) : Math.min(1600, 300 + 130 * segs);
        const gap = reducedMotion.matches || n < 2 ? 0 : oneByOne ? Math.min(each * 0.6, 3400 / (n - 1)) : Math.min(220, 900 / (n - 1));
        return {
            each,
            starts: Array.from({
                length: n
            }, (x, k) => k * gap),
            end: (n - 1) * gap + each
        };
    };
    const progressAt = (times, loops, t) => loops.map((loop, k) => alongArc(loop, EASY_EASE(clamp((t - times.starts[k]) / times.each, 0, 1)), INSET));
    const pause = ms => (reducedMotion.matches ? 1 : ms);
    // In a window: the loop nearest the middle traces first, a little slower; the rest follow it out, each starting as the wave reaches it (dist: how near the middle each comes).
    const radiate = (loops, each, spread) => {
        if (reducedMotion.matches) {
            return {
                durs: loops.map(() => 1),
                starts: loops.map(() => 0),
                end: 1
            };
        }
        const far = Math.max(1e-6, ...loops.map(l => l.dist));
        const lead = loops.reduce((b, l, k) => (l.dist < loops[b].dist ? k : b), 0);
        const durs = loops.map((l, k) => (k === lead ? 1.3 * each : each));
        const starts = loops.map((l, k) => (k === lead ? 0 : 0.35 * each + (spread * l.dist) / far));
        return {
            durs,
            starts,
            end: Math.max(1, ...starts.map((x, k) => x + durs[k]))
        };
    };
    // Re-facing (see operate): the old faces as plain loops, in as they go quiet (by t1) and out as the new ones are in (from tA to tB); a light fill of each new planar face while it traces (from start to stop), gone as the new faces settle; and each new face bolder while it traces.
    const plainAlpha = (t, t1, tA, tB) => 0.7 * smoothstep(0, t1, t) * (1 - smoothstep(tA, tB, t));
    const traceFill = (t, start, stop, settle) => Number((0.17 * smoothstep(start, start + 250, t) * (1 - smoothstep(stop + 150, stop + 900, t)) * (1 - settle)).toFixed(3));
    const boldness = (prog, segs) => k => 1 + 0.7 * Math.sin(Math.PI * clamp(prog[k] / segs[k], 0, 1));

    const shake = () => {
        if (reducedMotion.matches || !strip.animate) {
            return;
        }
        strip.animate([0, -8, 7, -4, 2, 0].map(x => ({
            transform: `translateX(${x}px)`
        })), {
            duration: 380,
            easing: 'ease-out'
        });
    };

    const finishOp = () => {
        const o = op;
        op = null;
        state.zoom = 1;
        if (o.done) {
            o.done();
        }
        wake();
    };

    // Where an operation leads from here, or why it leads nowhere.
    const destination = kind => {
        const S = state.solid,
            d = S.def,
            petrial = state.form === 'petrial',
            t = title();
        // B: a tiling to its blend with a segment; Shift-B, with a line. On a blend with a segment Shift-B goes on to the blend with a line; else on a blend, back to the tiling (the same on their Petrials).
        if (kind === 'blend' || kind === 'blend-line') {
            if (S.planar) {
                return {
                    name: `${S.name}-${kind === 'blend' ? 'seg' : 'line'}`,
                    form: state.form,
                    phase: S.phase
                };
            }
            if (S.blend && kind === 'blend-line' && S.q === 'seg') {
                return {
                    name: `${d.blend.base}-line`,
                    form: state.form,
                    phase: S.phase
                };
            }
            if (S.blend) {
                return {
                    name: d.blend.base,
                    form: state.form,
                    phase: S.phase
                };
            }
            return {
                refuse: 'Only the planar polyhedra blend: B takes a tiling, or its Petrial, to its blend with a segment, and Shift-B to its blend with a line.'
            };
        }
        if (S.pure) {
            // As in Figure 2: P (but for the two that are their own Petrials), D between the Petrie–Coxeter polyhedra and between {6,4}_6 and {4,6}_6, and the one-way facetting φ2, halving η and skewing σ.
            if (kind === 'petrial') {
                return d.pure.selfPetrie ? {
                    refuse: `The ${t} is its own Petrial: the Petrie polygons of ${S.def.sym} make a polyhedron of the same kind.`
                } : {
                    name: S.name,
                    form: petrial ? 'solid' : 'petrial'
                };
            }
            const node = keyOfNode(S.name, state.form),
                next = (PURE_STEPS[kind] || {})[node];
            if (next) {
                const {
                    name,
                    petrial: pet
                } = nodeOf(next);
                return {
                    name,
                    form: pet ? 'petrial' : 'solid'
                };
            }
            return {
                refuse: {
                    dual: `The dual of the ${t} is not among the pure polyhedra.`,
                    facet: `Facetting (φ<sub>2</sub>) goes from {6,&nbsp;6}<sub>4</sub> and {4,&nbsp;6}<sub>6</sub> only.`,
                    halve: `Halving (η) goes from {4,&nbsp;6&nbsp;|&nbsp;4} and {4,&nbsp;6}<sub>6</sub> only.`,
                    skew: `Skewing (σ) goes from {6,&nbsp;4&nbsp;|&nbsp;4}, and σδ from {6,&nbsp;4}<sub>6</sub>, only.`
                } [kind] || 'That operation does not apply here.'
            };
        }
        if (S.blend) {
            if (kind === 'petrial') {
                return {
                    name: S.name,
                    form: petrial ? 'solid' : 'petrial',
                    phase: S.phase
                };
            }
            if (kind === 'dual') {
                return {
                    refuse: `The dual of the ${t} cannot be built in space: each of its vertices would sit at the center of a face, and ` +
                        (S.q === 'seg' && !petrial ? 'the centers of these skew faces all lie in the one plane midway between the layers.' : petrial ? 'its faces, zigzags, have no centers.' : 'its faces, helices, have no centers.')
                };
            }
            return {
                refuse: 'There is no facetting among the blended polyhedra.'
            };
        }
        if (S.planar) {
            if (kind === 'petrial') {
                return {
                    name: S.name,
                    form: petrial ? 'solid' : 'petrial',
                    phase: S.phase
                };
            }
            if (kind === 'dual' && !petrial) {
                return {
                    name: d.dual,
                    form: 'solid',
                    phase: S.dualPhase
                };
            }
            if (kind === 'dual') {
                // A zigzag's center would be at infinity.
                return {
                    refuse: `The dual of the ${t} would be ${sym(d.q, d.h, d.p)}, which cannot be built in the plane: ` +
                        'each of its vertices would sit at the center of a zigzag, and a zigzag has no center.'
                };
            }
            return {
                refuse: 'There is no facetting among the planar polyhedra.'
            };
        }
        if (kind === 'petrial') {
            return {
                name: S.name,
                form: petrial ? baseForm(S) : 'petrial'
            };
        }
        if (kind === 'dual') {
            if (!petrial) {
                return {
                    name: d.dual,
                    form: baseForm(solidOf(d.dual))
                };
            }
            // The dual of {h, q}_p is {q, h}_p, but it would need a vertex at the center of each skew face, and those centers all sit at the middle.
            return {
                refuse: `The dual of the ${t} would be ${sym(d.q, d.h, d.p)}, which cannot be built in space: ` +
                    `its vertices would sit at the centers of the ${SKEW[d.h]}, and those centers all coincide at the middle.`
            };
        }
        if (d.facet === 'same') {
            return {
                refuse: `Facetting leaves the ${t} as it is: with three faces at each vertex, <i>R</i><sub>1</sub><i>R</i><sub>2</sub><i>R</i><sub>1</sub> = <i>R</i><sub>2</sub><i>R</i><sub>1</sub><i>R</i><sub>2</sub>, ` +
                    'so (<i>R</i><sub>0</sub>, <i>R</i><sub>1</sub><i>R</i><sub>2</sub><i>R</i><sub>1</sub>, <i>R</i><sub>2</sub>) is only a change of base flag.'
            };
        }
        if (d.facet === 'degenerate') {
            return {
                refuse: `Facetting the ${t} would pair each edge at a vertex with the edge opposite it, ` +
                    'so only two of the new faces would meet at each vertex: that is no polyhedron.'
            };
        }
        return {
            name: d.facet,
            form: petrial ? 'petrial' : baseForm(solidOf(d.facet))
        };
    };

    const operate = kind => {
        if (op || trans) {
            return;
        }
        if (state.anim || state.queue.length) {
            state.queue.length = 0;
            pendingOp = kind;
            return;
        }
        const to = destination(kind);
        if (to.refuse) {
            shake();
            say.innerHTML = to.refuse;
            if (map) {
                map.wobble();
            }
            return;
        }
        if (kind === 'blend' || kind === 'blend-line') {
            operateBlend(to);
            return;
        }
        if (state.solid.spatial) {
            operateBlendForm(to);
            return;
        }
        if (state.solid.planar) {
            operatePlanar(kind, to);
            return;
        }

        const S = state.solid,
            from = state.form;
        // The operation follows the live view, so a drag or a coasting spin carries straight through it: each frame, the figure being operated on is the current view times `off` (its position when the operation began, re-expressed if the solid underneath is swapped).
        const live = () => mmul(qmat(state.view), op.off);
        const frontNow = (X, T) => frontOf(X, X.V.map(v => mvec(T, v)), T);
        const TS = solidOf(to.name);

        if (kind !== 'dual') {
            // Re-facing (p and f): the same vertices and edges, new faces. The old faces go quiet first: where they are planar (a convex solid or a star), the faces go pale, the ink (a star's creases) thins to a skeleton, and the faces come forward as plain loops; a Petrial's colored loops fade to gray. Then the new faces trace out nearly one at a time, each bolder while it traces, over a light fill of its own plane if it is planar, so you can see which face it is. Last the old faces go, and where the new faces are planar they close in onto the edges as the ink comes back and the faces fill in from pale.
            const toPetrial = to.form === 'petrial',
                fromShaded = from !== 'petrial';
            const newSet = toPetrial ? TS.LOOPS.petrie : TS.LOOPS.faces;
            const count = newSet.length;
            const segs = newSet.map(segmentsOf);
            const times = traceTimes(count, Math.max(...segs), true);
            const t1 = pause(fromShaded ? 450 : 400);
            const tA = t1 + times.end,
                tB = tA + pause(700),
                tC = toPetrial ? tB : tB + pause(800);
            const swap = () => setSolid(to.name, {
                form: to.form,
                view: state.view,
                keep: true,
                keepMotion: true,
                moveMap: false
            });
            if (!fromShaded) {
                state.scene.mutedAt = performance.now();
            }
            op = {
                t0: performance.now(),
                total: tC,
                off: state.group.G[state.pos].M,
                update(t, fx) {
                    if (t >= tB && !this.swapped && !toPetrial) {
                        this.swapped = true;
                        swap();
                    }
                    const settle = this.swapped ? EASY_EASE(clamp((t - tB) / (tC - tB), 0, 1)) : 0;
                    // The faces' fills go pale while the new faces trace over them in full color, and come back from pale on the new solid.
                    fx.shadeDim = this.swapped ? 1 - settle : EASY_EASE(clamp(t / t1, 0, 1));
                    // (Planar faces shrink to the plain loops drawn here, so the solid's own are not drawn; a Petrial's own loops stay, grayed, until the new faces are in.)
                    if (fromShaded || this.swapped) {
                        fx.ownLoops = 0;
                    }
                    if (this.swapped) {
                        fx.skeleton = 1 - settle;
                        fx.bare = 1 - settle;
                        fx.edgesOff = 1 - settle;
                    } else if (fromShaded) {
                        // The edges thin and go as the faces shrink to loops, so none runs between them while the new faces are drawn.
                        fx.skeleton = EASY_EASE(clamp(t / t1, 0, 1));
                        fx.edgesOff = fx.skeleton;
                        fx.bare = smoothstep(tA, tB, t);
                    } else {
                        // The old colored faces, grayed, sit back while the new ones trace.
                        fx.loops = (1 - 0.55 * smoothstep(0, t1, t)) * (1 - smoothstep(tA, tB, t));
                    }
                    if (t >= tC) {
                        return 'done';
                    }
                    const T = live(),
                        oldFront = frontNow(S, T),
                        newFront = frontNow(TS, T),
                        newVis = id => newFront[id];
                    const faces = plainAlpha(t, t1, tA, tB),
                        prog = progressAt(times, newSet, t - t1),
                        bold = boldness(prog, segs);
                    // The old faces as plain loops, a light fill of each new face's plane while it traces, and the new faces.
                    return g => {
                        if (fromShaded) {
                            drawLoops(g, S.LOOPS.faces, T, 1, INSET, id => oldFront[id], null, faces, 1, HIDDEN, loopPaint(S.LOOPS.faces, {
                                plain: true
                            }));
                        }
                        if (toPetrial) {
                            drawWeave(g, newSet, TS.LOOPS.cross, drawLoops(g, newSet, T, 1, INSET, newVis, prog, 1, bold), det3(T) < 0);
                        } else {
                            TS.FACES.forEach((f, k) => {
                                const start = t1 + times.starts[k],
                                    a = traceFill(t, start, start + times.each, settle);
                                if (a > 0.001) {
                                    g.shape({
                                        path: path().poly(f.ids.map(i => screen(mvec(T, TS.V[i]))), true),
                                        fill: rgb(loopColor(k, count)),
                                        alpha: a
                                    });
                                }
                            });
                            drawLoops(g, newSet, T, 1, INSET * (1 - settle), newVis, prog, 1 - settle, bold);
                        }
                    };
                },
                done() {
                    if (!this.swapped) {
                        swap();
                    }
                },
            };
        } else {
            // The dual: a regular q-gon (or q-gram) around each vertex, its edges crossing the edges at their midpoints. Then the original goes, and the dual settles to its usual size, closing onto its edges as its ink (a star's creases) comes back and its faces fill in.
            // (Only a shaded solid has a dual here: see destination.)
            const D = S.DUAL,
                L = S.LOOPS;
            const Rd = matchRotation(TS.V, D.verts.map(unit)),
                qRd = matq(Rd);
            // Color each traced face as the target colors the face it becomes.
            const colors = S.V.map(v => {
                let best = 0,
                    bestDot = -2;
                TS.FACES.forEach((f, j) => {
                    const c = dot(unit(mvec(Rd, f.center)), unit(v));
                    if (c > bestDot) {
                        bestDot = c;
                        best = j;
                    }
                });
                return loopColor(best, TS.FACES.length);
            });
            const paint = v => rgb(colors[v]);
            const times = traceTimes(L.dual.length, segmentsOf(L.dual[0])),
                t1 = pause(450);
            const tA = t1 + times.end,
                tB = tA + pause(650),
                tC = tB + pause(800);
            // Reciprocation can make the dual much larger than the original (the great dodecahedron's is 1.6 times its size): pull back so it fits while it traces, and come back in as it settles.
            const fit = Math.min(1, 1.08 / Math.max(1, D.c)),
                tz = pause(500);
            op = {
                t0: performance.now(),
                total: tC,
                off: state.group.G[state.pos].M,
                update(t, fx) {
                    let z, settle = 0;
                    const back = 1 + (fit - 1) * EASY_EASE(clamp(t / tz, 0, 1));
                    fx.ownLoops = 0;
                    if (t < tB) {
                        // The original thins to a skeleton while the dual traces, then goes.
                        fx.skeleton = fx.shadeDim = EASY_EASE(clamp(t / t1, 0, 1));
                        fx.ink = 1 - smoothstep(tA, tB, t);
                        z = back;
                        state.zoom = back;
                    } else {
                        if (!this.swapped) {
                            // Swap in the dual, viewed so that nothing moves.
                            this.swapped = true;
                            setSolid(to.name, {
                                form: to.form,
                                view: qnorm(qmul(state.view, qRd)),
                                keepMotion: true,
                                moveMap: false
                            });
                            this.off = mmul(transpose(Rd), this.off);
                        }
                        settle = EASY_EASE(clamp((t - tB) / (tC - tB), 0, 1));
                        z = (fit + (1 - fit) * settle) * (1 + (1 / D.c - 1) * settle);
                        state.zoom = D.c * z;
                        fx.ink = settle;
                        fx.shadeDim = 1 - settle;
                    }
                    if (t >= tC) {
                        return 'done';
                    }
                    const T = live(),
                        ahead = S.V.map(v => smoothstep(-EDGE_ON, EDGE_ON, mvec(T, unit(v))[2]));
                    return g => drawLoops(g, L.dual, T, z, INSET * (1 - settle), id => ahead[id], progressAt(times, L.dual, t - t1), 1 - settle, 1, HIDDEN, paint);
                },
            };
        }
        finishOperate(S, to);
    };
    // Every operation's end: the figure operated on noted (for the console and tests), and the map's marker flowing to the new node only as the operation finishes (a blend's moves with its swap: see operateBlend).
    const finishOperate = (S, to, moveMap = true) => {
        op.solid0 = S;
        if (map && moveMap) {
            map.go(keyOfNode(to.name, to.form), pause(850), Math.max(0, op.total - pause(950)));
        }
        wake();
    };

    // Where B (or Shift-B) takes the polyhedron, and the position there.
    const blendStart = to => {
        const S = state.solid,
            Gr0 = state.group,
            TS = solidOf(to.name, to.phase);
        const planarPos = S.blend ? Gr0.P.idx(Gr0.G[state.pos].tuple.slice(0, 3)) : state.pos;
        return {
            TS,
            carry: TS.blend ? liftToBlend(TS, planarPos) : planarPos
        };
    };
    // (Into a blend from its tiling: the tiling's part, and the whole; and the size, as a share of the blend's, that the blend comes in at.)
    const B_IN = () => ({
        tA: pause(450),
        tB: pause(450) + pause(1300)
    });
    const blendInZoom = TS => {
        const {
            tA,
            tB
        } = B_IN();
        return (1 + (TS.blendZoom - 1) * EASY_EASE(tA / tB)) / TS.blendZoom;
    };
    // (The figure's width once the wide window is open, as a share of it now.)
    const openRatio = () => (wider.matches ? toy.offsetWidth / wideWidth() : 1);
    // (Nothing moving, the polyhedron still S: for work done beforehand.)
    const atRest = S => !op && !trans && !state.anim && !state.queue.length && !state.drag && !state.glide && !state.spin && state.solid === S;
    // Work done beforehand, one item at a time, while it stays at rest.
    const inTurn = (items, S, make) => {
        const next = i => {
            if (i < items.length && atRest(S)) {
                make(items[i]);
                setTimeout(() => next(i + 1), 60);
            }
        };
        next(0);
    };
    // The incoming blend's patch, for its pose as it comes in (flat, at the size zoom it comes in at, the window as it will be once open), which covers every pose after it: made now, or found made beforehand (see prepareBlends). (A patch does not depend on the view.)
    const prepared = [];
    const blendPatchFor = (to, zoom) => {
        const {
            TS,
            carry
        } = blendStart(to);
        if (!TS.blend) {
            return null;
        }
        const ink = wideOn ? inkScale() : openRatio();
        const key = `${to.name}@${to.phase} ${carry} ${state.pan.map(x => x.toFixed(5))} ${(zoom * ink).toFixed(5)}`;
        const had = prepared.find(x => x.key === key);
        if (had) {
            return had.patch;
        }
        const M = groupOf(to.name, to.phase).Gr.G[carry].M;
        const pose = blendPose(M, TS.zoom * zoom * ink, state.pan, {
            view: [1, 0, 0, 0],
            zeta: 0,
            line: TS.q === 'line'
        });
        const patch = blendPatchAround(TS, pose);
        prepared.unshift({
            key,
            patch
        });
        prepared.length = Math.min(prepared.length, 4);
        return patch;
    };
    // While nothing moves, the patches that the arrows would want are made beforehand too: those of the pure polyhedra to either side, and of the first in the families above and below, as setSolid will make them, fresh (see blendPatchOf, which keeps them).
    let nearTimer = 0,
        nearFor = '';
    const prepareNear = () => {
        const sig = `${state.family} ${state.member}`;
        if (sig === nearFor || nearTimer || reducedMotion.matches) {
            return;
        }
        nearTimer = setTimeout(() => {
            nearTimer = 0;
            const S0 = state.solid;
            if (!atRest(S0)) {
                return;
            }
            nearFor = sig;
            const fam = FAMILIES[state.family],
                N = fam.members.length;
            const names = [...new Set([
                ...[1, -1].map(d => fam.members[mod(state.member + d, N)]),
                ...[1, -1].map(d => FAMILIES[mod(state.family + d, FAMILIES.length)].start),
            ])].filter(name => DEFS[name].pure);
            // (Its window as it will be: open already, or about to open.)
            const k = wideOn ? inkScale() : 1,
                kOpen = wideOn ? inkOpen() : openRatio();
            inTurn(names, S0, name => {
                const S = solidOf(name),
                    {
                        Gr
                    } = groupOf(name);
                const pose = blendPose(Gr.G[0].M, S.zoom * k, [0, 0, 0], {
                    view: S.q0,
                    zeta: 1,
                    line: true
                });
                pose.ink = k;
                blendPatchAround(S, openPose(pose, kOpen));
            });
        }, 600);
    };
    // While nothing moves, the patches that B and Shift-B would want are made beforehand, one at a time, so that pressing either starts at once.
    let prepTimer = 0,
        prepFor = '';
    const prepareBlends = () => {
        const S = state.solid;
        if (!(S.planar || S.blend) || reducedMotion.matches) {
            return;
        }
        const sig = `${S.name}@${state.phase} ${state.form} ${state.pos} ${state.pan.join()} ${state.zoom}`;
        if (sig === prepFor || prepTimer) {
            return;
        }
        prepTimer = setTimeout(() => {
            prepTimer = 0;
            if (!atRest(S)) {
                return;
            }
            prepFor = sig;
            const kinds = S.planar ? ['blend', 'blend-line'] : S.q === 'seg' ? ['blend-line'] : [];
            inTurn(kinds, S, kind => {
                const to = destination(kind);
                blendPatchFor(to, S.planar ? blendInZoom(solidOf(to.name, to.phase)) : state.zoom);
            });
        }, 450);
    };

    // B. Into a blend the camera tilts over the plane as the heights grow from nothing (at first the blend is drawn exactly as its tiling); between blends they sink to nothing and grow again, in one motion; back to the tiling they sink, and the camera comes back overhead. The position carries over: down to the plane's symmetries, and up into the new blend. A blend's patch is costly to make, so none is made while anything moves: the blend coming in has its own made beforehand, for the whole of its part (its window opening first, if it does), and the one going keeps its own, the size changing as it sinks only toward less of it in view (the rest of the change is the tiling's, or the new blend's).
    const operateBlend = to => {
        const S = state.solid,
            {
                TS,
                carry
            } = blendStart(to);
        state.spin = null;
        const OVER = [1, 0, 0, 0],
            from = state.view;
        const swap = (view, zeta, extra = {}) => setSolid(to.name, {
            form: to.form,
            phase: to.phase,
            keepMotion: true,
            carry,
            view,
            zeta,
            ...extra
        });
        let total, step, endView;
        if (!S.blend) {
            // From a tiling: its shading goes and it grows toward the blend's size as the window opens; then the blend, drawn just as the tiling is, rises out of it, still growing, as the camera tilts.
            const {
                tA,
                tB
            } = B_IN(), bz = TS.blendZoom;
            const Z = t => 1 + (bz - 1) * EASY_EASE(clamp(t / tB, 0, 1));
            const patch = blendPatchFor(to, blendInZoom(TS));
            setWide(true);
            total = tB;
            endView = BLEND_VIEW;
            step = (t, fx, o) => {
                if (t < tA) {
                    fx.shadeFade = 1 - EASY_EASE(t / tA);
                    state.zoom = Z(t);
                    return;
                }
                if (!o.swapped) {
                    o.swapped = true;
                    swap(OVER, 0, {
                        patch,
                        zoom: Z(t) / bz
                    });
                }
                const e = EASY_EASE(clamp((t - tA) / (tB - tA), 0, 1));
                state.view = slerp(OVER, BLEND_VIEW, e);
                state.cam.zeta = e;
                fx.cycles = smoothstep(0.1, 0.7, e); // the edges become the faces' cycles
                state.zoom = Z(t) / bz;
            };
        } else if (TS.blend) {
            // Between blends, one dip: the heights sink to nothing and grow again, and the size goes over from one blend's to the other's, on the old one if it is the smaller (so less of it comes into view), else on the new one.
            const T = pause(1300),
                tA = T / 2,
                ratio = TS.zoom / S.zoom,
                z0 = state.zoom,
                grow = ratio > 1;
            const dip = t => 0.5 + 0.5 * Math.cos(2 * Math.PI * clamp(t / T, 0, 1));
            // (How far the size has gone over, in the half it goes over in.)
            const over = (t, a, b) => 1 + (ratio - 1) * EASY_EASE(clamp((t - a) / (b - a), 0, 1));
            const patch = blendPatchFor(to, z0);
            // (At the bottom of the dip the old blend, its colors not the new one's, fades out over the new as both begin to rise.)
            const oldScene = state.scene,
                oldM = state.group.G[state.pos].M,
                fade = pause(320);
            let zOld = z0;
            total = T;
            endView = from;
            step = (t, fx, o) => {
                state.cam.zeta = dip(t);
                if (t < tA) {
                    state.zoom = zOld = grow ? z0 * over(t, 0, tA) : z0;
                    return null;
                }
                if (!o.swapped) {
                    o.swapped = true;
                    swap(from, 0, {
                        patch,
                        zoom: grow ? z0 : z0 / ratio
                    });
                }
                state.zoom = grow ? z0 : (z0 * over(t, tA, T)) / ratio;
                const a = 1 - EASY_EASE(clamp((t - tA) / fade, 0, 1));
                if (a <= 0.002) {
                    return null;
                }
                return g => {
                    const pose = blendPose(oldM, S.zoom * zOld * inkScale(), state.pan, {
                        view: state.view,
                        zeta: state.cam.zeta,
                        line: S.q === 'line'
                    });
                    pose.ink = inkScale();
                    drawBlend(g, oldScene, S, pose, {
                        ink: a,
                        loops: a
                    });
                };
            };
        } else {
            // Back to the tiling: the heights sink as the camera comes back overhead; then the tiling, drawn just as the flat blend was, shrinks to its own size as its shading comes back and the window closes.
            const tA = pause(1100),
                tB = tA + pause(600),
                bz = S.blendZoom;
            total = tB;
            endView = OVER;
            step = (t, fx, o) => {
                if (t < tA) {
                    const e = EASY_EASE(t / tA);
                    state.view = slerp(from, OVER, e);
                    state.cam.zeta = 1 - e;
                    fx.cycles = 1 - smoothstep(0.3, 0.9, e);
                    return;
                }
                if (!o.swapped) {
                    o.swapped = true;
                    swap(OVER, 1, {
                        zoom: bz
                    });
                }
                const e = EASY_EASE(clamp((t - tA) / (tB - tA), 0, 1));
                state.zoom = bz + (1 - bz) * e;
                fx.shadeFade = e;
            };
        }
        op = {
            t0: performance.now(),
            total,
            // (The patch kept as it is: see ensurePatch.)
            frozen: true,
            update(t, fx) {
                if (t >= total) {
                    if (!this.swapped) {
                        this.swapped = true;
                        swap(endView, 1);
                    }
                    state.view = endView;
                    state.cam.zeta = 1;
                    return 'done';
                }
                return step(t, fx, this) || null;
            },
        };
        finishOperate(S, to, false);
    };

    // A blend's Petrial and back, as on a tiling: the old faces go gray and faint, and the new ones are drawn in over them, each by a pen running along it through the window: first the one nearest the middle, a little slower, then the rest as a wave reaches them. Then the old go, and the blend is its Petrial (or the Petrial its blend).
    const operateBlendForm = to => {
        const S = state.solid,
            from = state.form,
            toPetrial = to.form === 'petrial';
        // (Or, among the pure polyhedra, another one altogether: placed by the same motion, so it stands where the old one does, from its own patch.)
        const TS = solidOf(to.name, to.phase),
            same = TS === S;
        const pose0 = planarPoseNow(),
            carry = same ? null : groupOf(to.name).Gr.idx(state.group.tupleOf(state.pos));
        const scene = buildBlendScene(TS, to.form, same ? state.scene.patch : blendPatchAround(TS, pose0)),
            loops = scene.loops;
        // Where each new loop is in view: the stretch of it, as far along it as from its first node in the ball and the window to its last (and a node on, to the border), and how near the middle it comes.
        const proj = blendProject(scene, pose0),
            r2 = pose0.ball * pose0.ball,
            edge = (WIN_H - 6) / SCALE;
        const spans = loops.map((l, k) => {
            const {
                W,
                Vv: V,
                vis
            } = proj.strands[k], n = l.arc.length;
            let a = -1,
                b = -1,
                dist = Infinity;
            for (let c = 0; c < vis.length; c++) {
                if (!vis[c]) {
                    continue;
                }
                for (let i = c * l.per; i <= Math.min(n - 1, c * l.per + l.per); i++) {
                    if (W[3 * i] ** 2 + W[3 * i + 1] ** 2 + W[3 * i + 2] ** 2 > r2 || Math.abs(V[3 * i]) > edge || Math.abs(V[3 * i + 1]) > edge) {
                        continue;
                    }
                    if (a < 0) {
                        a = i;
                    }
                    b = i;
                    dist = Math.min(dist, Math.hypot(V[3 * i], V[3 * i + 1]));
                }
            }
            return a < 0 ? null : {
                s0: l.arc[Math.max(0, a - 1)],
                s1: l.arc[Math.min(n - 1, b + 1)],
                dist
            };
        });
        const shown = spans.map((sp, k) => k).filter(k => spans[k]);
        const wave = radiate(shown.map(k => spans[k]), toPetrial ? 1350 : 650, toPetrial ? 1500 : 1600),
            end = wave.end;
        const starts = new Float64Array(loops.length),
            durs = new Float64Array(loops.length).fill(1);
        shown.forEach((k, j) => {
            starts[k] = wave.starts[j];
            durs[k] = wave.durs[j];
        });
        // A Petrie–Coxeter polyhedron's faces are planar, and filled: as on a finite polyhedron, going they go pale, the ink thins and goes, and they show as plain loops while the new faces are drawn; coming, each new face is lightly filled while it is drawn, and last the loops close in onto the edges as the faces fill in from pale and the ink comes back.
        const fromFilled = Boolean(state.scene.filled),
            toFilled = Boolean(scene.filled);
        const t1 = pause(from === 'solid' ? 450 : 400),
            tA = t1 + end,
            tB = tA + pause(700),
            tC = toFilled ? tB + pause(800) : tB;
        const trace = new Float64Array(loops.length);
        if (!fromFilled) {
            state.scene.mutedAt = performance.now();
        }
        const old = fromFilled ? buildBlendScene(S, from, state.scene.patch) : null,
            all = old ? new Float64Array(old.loops.length).fill(Infinity) : null;
        // (Between two pure polyhedra shown at different sizes, the size goes over as the new one is drawn in, so nothing jumps at the swap.)
        const ratio = TS.zoom / S.zoom;
        const swap = () => setSolid(to.name, same ? {
            form: to.form,
            phase: to.phase,
            view: state.view,
            keep: true,
            keepMotion: true,
            moveMap: false
        } : {
            form: to.form,
            view: state.view,
            keepMotion: true,
            moveMap: false,
            carry
        });
        op = {
            t0: performance.now(),
            total: tC,
            update(t, fx) {
                if (t >= tB && toFilled && !this.swapped) {
                    this.swapped = true;
                    swap();
                }
                if (!same && !this.swapped) {
                    state.zoom = 1 + (ratio - 1) * EASY_EASE(clamp(t / tA, 0, 1));
                }
                const settle = this.swapped ? EASY_EASE(clamp((t - tB) / (tC - tB), 0, 1)) : 0;
                if (this.swapped) {
                    fx.shadeDim = 1 - settle;
                    fx.skeleton = 1 - settle;
                    fx.bare = 1 - settle;
                    fx.edgesOff = 1 - settle;
                } else if (fromFilled) {
                    fx.shadeDim = EASY_EASE(clamp(t / t1, 0, 1));
                    fx.skeleton = fx.shadeDim;
                    fx.edgesOff = fx.shadeDim;
                    fx.bare = smoothstep(tA, tB, t);
                } else {
                    // The old faces: gray (see mutedAt), fainter while the new are drawn, then gone.
                    const fade = (1 - 0.55 * smoothstep(0, t1, t)) * (1 - smoothstep(tA, tB, t));
                    if (from === 'petrial') {
                        fx.loops = fade;
                    } else {
                        fx.ink = fade;
                    }
                }
                if (t >= tC) {
                    return 'done';
                }
                shown.forEach(k => {
                    const e = EASY_EASE(clamp((t - t1 - starts[k]) / durs[k], 0, 1)),
                        sp = spans[k];
                    trace[k] = e > 0 ? sp.s0 + e * (sp.s1 - sp.s0) : 0;
                });
                const plain = plainAlpha(t, t1, tA, tB);
                return g => {
                    const pose = planarPoseNow();
                    if (old && !this.swapped && plain > 0.002) {
                        drawBlend(g, old, S, pose, {
                            trace: all,
                            plain: true,
                            ink: plain
                        });
                    }
                    if (toFilled) {
                        // (Those wholly in the ball, as drawFills has them.)
                        const pj = blendProject(scene, pose, 1 - settle),
                            V = pj.verts.Vv,
                            W = pj.verts.W,
                            rr = pose.ball * pose.ball,
                            gf = g.group({
                                clip: WINDOW
                            });
                        loops.forEach((l, k) => {
                            if (!spans[k] || !l.closed || !l.normal || l.ids.some(i => W[3 * i] ** 2 + W[3 * i + 1] ** 2 + W[3 * i + 2] ** 2 > rr)) {
                                return;
                            }
                            const start = t1 + starts[k],
                                a = traceFill(t, start, start + durs[k], settle);
                            if (a > 0.001) {
                                gf.shape({
                                    path: path().poly(l.ids.map(i => screen([V[3 * i], V[3 * i + 1]])), true),
                                    fill: rgb(l.color),
                                    alpha: a,
                                    convex: true
                                });
                            }
                        });
                    }
                    drawBlend(g, scene, TS, pose, {
                        trace,
                        spread: 1 - settle,
                        ink: 1 - settle
                    });
                };
            },
            done() {
                if (!this.swapped) {
                    swap();
                }
            },
        };
        finishOperate(S, to);
    };

    // The same operations on a planar polyhedron, in its window: the new faces trace out from the middle in a wave, the old ones go, and the figure settles on the new polyhedron. The symmetries are the same throughout, so the position carries over.
    const operatePlanar = (kind, to) => {
        const S = state.solid,
            from = state.form,
            TS = solidOf(to.name, to.phase);
        const rim = WIN_DIAG / (SCALE * Math.min(S.zoom, TS.zoom)),
            pose0 = planarPoseNow();
        const patch = patchOf(S, [pose0.pre[0], pose0.pre[1], 0], rim + 0.75 + PATCH_SLACK);
        // What the window shows of a set of loops, as it stands now: zigzags cut down to their stretch in it, so a pen starts at its border.
        const visible = loops => loops.map(l => trimToWindow(l, S.inset, pose0.A2)).filter(Boolean);
        const progress = (times, loops, t) => loops.map((l, k) => alongArc(l, EASY_EASE(clamp((t - times.starts[k]) / times.durs[k], 0, 1)), S.inset));
        const screenPoly = (loop, A) => {
            const X = screenNodes(loop, 0, A),
                q = [];
            for (let i = 0; i < X.length; i += 2) {
                q.push([X[i], X[i + 1]]);
            }
            return q;
        };

        if (kind === 'petrial') {
            const toPetrial = to.form === 'petrial',
                fromSolid = from === 'solid';
            const newSet = visible(toPetrial ? patch.LOOPS.petrie : patch.LOOPS.faces),
                segs = newSet.map(segmentsOf);
            const oldSet = fromSolid ? visible(patch.LOOPS.faces) : null;
            const times = radiate(newSet, toPetrial ? 1350 : 650, toPetrial ? 1500 : 1600);
            const t1 = pause(fromSolid ? 450 : 400);
            const tA = t1 + times.end,
                tB = tA + pause(700),
                tC = toPetrial ? tB : tB + pause(800);
            if (!fromSolid) {
                state.scene.mutedAt = performance.now();
            }
            const swap = () => setSolid(to.name, {
                form: to.form,
                phase: to.phase,
                view: state.view,
                keep: true,
                keepMotion: true,
                moveMap: false
            });
            op = {
                t0: performance.now(),
                total: tC,
                update(t, fx) {
                    if (t >= tB && !this.swapped && !toPetrial) {
                        this.swapped = true;
                        swap();
                    }
                    const settle = this.swapped ? EASY_EASE(clamp((t - tB) / (tC - tB), 0, 1)) : 0;
                    // The faces' fills go pale while the new faces trace over them in full color, and come back from pale on the new solid.
                    fx.shadeDim = this.swapped ? 1 - settle : EASY_EASE(clamp(t / t1, 0, 1));
                    if (this.swapped) {
                        fx.skeleton = 1 - settle;
                        fx.bare = 1 - settle;
                        fx.edgesOff = 1 - settle;
                    } else if (fromSolid) {
                        // (As on a finite polyhedron: the edges go as the faces shrink.)
                        fx.skeleton = EASY_EASE(clamp(t / t1, 0, 1));
                        fx.edgesOff = fx.skeleton;
                        fx.bare = smoothstep(tA, tB, t);
                    } else {
                        fx.loops = (1 - 0.55 * smoothstep(0, t1, t)) * (1 - smoothstep(tA, tB, t));
                    }
                    if (t >= tC) {
                        return 'done';
                    }
                    const pose = planarPoseNow();
                    const faces = plainAlpha(t, t1, tA, tB),
                        prog = progress(times, newSet, t - t1),
                        bold = boldness(prog, segs);
                    // A light fill of each new face while it traces (in the window), the old faces as plain loops, and the new faces.
                    return g => {
                        const gf = g.group({
                            clip: WINDOW
                        });
                        if (!toPetrial) {
                            newSet.forEach((l, k) => {
                                const start = t1 + times.starts[k],
                                    a = traceFill(t, start, start + times.durs[k], settle);
                                if (a > 0.001) {
                                    gf.shape({
                                        path: path().poly(screenPoly(l, pose.A2), true),
                                        fill: rgb(l.color),
                                        alpha: a
                                    });
                                }
                            });
                        }
                        if (oldSet) {
                            drawPaths(g, oldSet, S.inset, pose.A2, {
                                alpha: faces,
                                paint: loopPaint(oldSet, {
                                    plain: true
                                })
                            });
                        }
                        drawPaths(g, newSet, S.inset * (1 - settle), pose.A2, {
                            progress: prog,
                            alpha: 1 - settle,
                            weight: bold
                        });
                    };
                },
                done() {
                    if (!this.swapped) {
                        swap();
                    }
                },
            };
        } else {
            // The dual: a face around each vertex, through the centers of the faces there. Then the original goes, and the dual settles to its own size (the hexagons' edges are 1/√3 of the triangles').
            const L = visible(patch.LOOPS.dual);
            const times = radiate(L, 650, 1400),
                t1 = pause(450);
            const tA = t1 + times.end,
                tB = tA + pause(650),
                tC = tB + pause(800),
                z0 = S.zoom / TS.zoom;
            op = {
                t0: performance.now(),
                total: tC,
                update(t, fx) {
                    let settle = 0;
                    if (t < tB) {
                        fx.skeleton = fx.shadeDim = EASY_EASE(clamp(t / t1, 0, 1));
                        fx.ink = 1 - smoothstep(tA, tB, t);
                    } else {
                        if (!this.swapped) {
                            this.swapped = true;
                            setSolid(to.name, {
                                form: to.form,
                                phase: to.phase,
                                view: state.view,
                                keep: true,
                                keepMotion: true,
                                moveMap: false
                            });
                        }
                        settle = EASY_EASE(clamp((t - tB) / (tC - tB), 0, 1));
                        state.zoom = z0 + (1 - z0) * settle;
                        fx.ink = settle;
                        fx.shadeDim = 1 - settle;
                    }
                    if (t >= tC) {
                        return 'done';
                    }
                    const pose = planarPoseNow();
                    return g => drawPaths(g, L, S.inset * (1 - settle), pose.A2, {
                        progress: progress(times, L, t - t1),
                        alpha: 1 - settle
                    });
                },
            };
        }
        finishOperate(S, to);
    };

    /* The carousel: the polyhedron alone, a caret to either side. It turns on a wheel, the polyhedron going fading out as the next comes in fading in: left and right on an upright drum (its neighbors), up and down on one lying across (the families). Onto a tiling, the tiles fall away instead, and the new ones fall into place. */
    let trans = null,
        pending = null;

    const metrics = () => ({
        W: strip.clientWidth,
        w: toy.offsetWidth,
        h: toy.offsetHeight,
        top: toy.offsetTop
    });

    // Place a drawing over the figure, turned wheel degrees on the drum about axis (see wheelTurn), with opacity fade. It keeps the size it was drawn at, centered on the figure, as the window opens or closes round it (see setWide).
    const placeAt = (el, m, fade, wheel = 0, axis = 'X') => {
        const r = axis === 'X' ? m.h : m.w,
            w = el.drawnAt;
        Object.assign(el.style, {
            width: `${w}px`,
            left: `${(m.W - w) / 2}px`,
            top: `${m.top + (m.w - w) / 2}px`,
            transform: wheel ? wheelTurn(wheel, WHEEL_R * r, 4 * r, 'px', axis) : 'none',
            opacity: fade.toFixed(3),
            visibility: fade < 0.004 ? 'hidden' : 'visible',
        });
    };

    // A copy of the figure as it looks now, in the ghost layer, to go away as the figure itself comes in.
    const snapshot = () => {
        const el = document.createElement('div');
        el.className = 'tt-ghost';
        el.drawnAt = toy.offsetWidth;
        el.append(backend.R.snapshot());
        ghostLayer.append(el);
        return el;
    };

    const begin = t => {
        trans = {
            ...t,
            t0: performance.now()
        };
        // Either way the live figure itself comes in (so its view can ease, and as the window opens or closes it is drawn as it will be). A family change turns through a window: clip above and below only.
        // (Not to the column either, on a wide screen: the old figure may have had the wider window.)
        if (t.kind === 'v') {
            strip.style.clipPath = 'inset(0 -100vw)';
            if (wider.matches) {
                ghostLayer.style.overflow = 'visible';
            }
        }
        wake();
    };

    const slide = d => {
        if (op) {
            return;
        }
        if (trans) {
            pending = ['h', d];
            return;
        }
        if (!d) {
            return;
        }
        const fam = FAMILIES[state.family],
            from = state.view,
            S0 = state.solid;
        // A tiling's tiles fall away: the old tiling (if it is a tiling itself, on its faces), drawn live as it goes, over the new one, in the same frame (see frame).
        const out = S0.planar && state.form === 'solid' ? {
            S: S0,
            pose: planarPoseNow(),
            scene: buildPlanarScene(S0, 'solid', state.scene.patch),
            t: 0
        } : null;
        const clone = out ? null : snapshot();
        setSolid(fam.members[mod(state.member + d, fam.members.length)]);
        if (state.solid.planar) {
            // Onto a tiling: the old figure's tiles fall out of place, and the new one's fall into it.
            begin({
                kind: 'tiles',
                d,
                clone,
                out,
                dur: pause(1500)
            });
            return;
        }
        // The new solid arrives turned the way the old one was, and settles into its own rest view as it slides in.
        if (!reducedMotion.matches) {
            state.view = from;
            state.viewEase = {
                from,
                t0: performance.now(),
                dur: 1100
            };
        }
        begin({
            kind: 'h',
            d,
            clone,
            dur: pause(WHEEL_MS)
        });
    };

    const switchFamily = d => {
        if (op) {
            return;
        }
        if (trans) {
            pending = ['v', d];
            return;
        }
        const clone = snapshot();
        state.family = mod(state.family + d, FAMILIES.length);
        familyChrome(d);
        // (The label turns with it: see setLabel.)
        labelTurn = d;
        setSolid(FAMILIES[state.family].start);
        begin({
            kind: 'v',
            d,
            clone,
            dur: pause(WHEEL_MS)
        });
    };

    // A step of the carousel, from the frame loop (one clock for all that moves): whether it goes on.
    const stepTrans = now => {
        const t = since(trans.t0, trans.dur, now);
        const m = metrics();
        const p = WHEEL_EASE(t),
            w = WHEEL_FIG * p;
        if (trans.kind === 'tiles') {
            // The old tiles fall over the first 60%, the new ones from 35% on.
            const tOut = clamp(t / 0.6, 0, 1);
            trans.fallIn = clamp((t - 0.35) / 0.65, 0, 1);
            if (trans.out) {
                trans.out.t = tOut;
            } else {
                placeAt(trans.clone, m, 1 - EASY_EASE(tOut));
            }
        } else {
            // The old polyhedron turns away round the drum (to the left, for the next one), or the old family goes over the top of the wheel (for d = 1), fading out, as the new one, the live figure, comes in from the other side, fading in.
            const [axis, s, r] = trans.kind === 'h' ? ['Y', -1, m.w] : ['X', 1, m.h];
            placeAt(trans.clone, m, 1 - p, s * trans.d * w, axis);
            Object.assign(toy.style, {
                transform: wheelTurn(-s * trans.d * (WHEEL_FIG - w), WHEEL_R * r, 4 * r, 'px', axis),
                opacity: p.toFixed(3)
            });
        }
        if (t < 1) {
            return true;
        }

        if (trans.clone) {
            trans.clone.remove();
        }
        strip.style.clipPath = '';
        ghostLayer.style.overflow = '';
        trans = null;
        Object.assign(toy.style, {
            transform: '',
            opacity: ''
        });
        wake();
        alignPanel();
        if (pending) {
            const [kind, d] = pending;
            pending = null;
            if (kind === 'h') {
                slide(d);
            } else {
                switchFamily(d);
            }
        }
        return Boolean(trans);
    };

    /* The map starts level with the top of the graphic. On one screen (wide), a tall map rises only as far as it must to end above the credit under it. */
    const wide = window.matchMedia('(min-width: 64rem)');
    const wider = window.matchMedia('(min-width: 78rem)');
    const layout = document.querySelector('.tt-layout');
    const foot = document.querySelector('.tt-foot');
    const alignPanel = () => {
        const off = Math.max(0, Math.round(toy.getBoundingClientRect().top - main.getBoundingClientRect().top));
        let right = off;
        if (wider.matches) {
            const outer = el => (el && el.offsetHeight ? el.offsetHeight + parseFloat(getComputedStyle(el).marginTop) : 0);
            const below = parseFloat(getComputedStyle(layout).paddingBottom) + Math.max(outer(foot), outer(keys));
            const room = window.innerHeight - below - (main.getBoundingClientRect().top + window.scrollY) - margin.offsetHeight;
            right = Math.max(0, Math.min(off, Math.floor(room)));
        }
        margin.style.marginTop = wide.matches ? `${right}px` : '';
    };
    window.addEventListener('resize', alignPanel);
    if (document.fonts) {
        document.fonts.ready.then(alignPanel);
    }

    /* Click a vertex, edge or face to turn the solid about it (shift-click, the other way); drag to turn the view. */
    let suppressClick = false;

    toy.addEventListener('click', e => {
        if (suppressClick) {
            suppressClick = false;
            return;
        }
        // From the keyboard (Enter, or Space with the figure focused): a random symmetry, as the space bar gives anywhere else.
        if (e.detail === 0) {
            enqueue({});
            return;
        }
        const at = svgPoint(e);
        if (featureUnder(at)) {
            enqueue({
                at,
                back: e.shiftKey
            });
        }
    });

    // The mouse over the figure, for the preview of what a click would do.
    toy.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch') {
            return;
        }
        state.aim = svgPoint(e);
        state.aimBack = e.shiftKey;
        wake();
    });
    toy.addEventListener('pointerleave', () => {
        state.aim = null;
        toy.classList.remove('is-aiming');
        wake();
    });
    const onShift = e => {
        if (e.key === 'Shift' && state.aim && state.aimBack !== e.shiftKey) {
            state.aimBack = e.shiftKey;
            wake();
        }
    };
    document.addEventListener('keydown', onShift);
    document.addEventListener('keyup', onShift);

    toy.addEventListener('pointerdown', e => {
        if (e.button !== 0) {
            return;
        }
        state.drag = {
            id: e.pointerId,
            x0: e.clientX,
            y0: e.clientY,
            x: e.clientX,
            y: e.clientY,
            t: e.timeStamp,
            moved: false,
            w: [0, 0, 0]
        };
        state.spin = null;
        state.glide = null;
        state.viewEase = null;
    });

    toy.addEventListener('pointermove', e => {
        const d = state.drag;
        if (!d || e.pointerId !== d.id) {
            return;
        }
        if (!d.moved) {
            if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) {
                return;
            }
            d.moved = true;
            toy.setPointerCapture(e.pointerId);
            toy.classList.add('is-dragging');
        }
        const dx = e.clientX - d.x,
            dy = e.clientY - d.y,
            dist = Math.hypot(dx, dy),
            dt = Math.max(8, e.timeStamp - d.t);
        if (dist > 0 && state.solid.planar) {
            // A tiling is dragged along under its window. (A blend turns, as a solid does.)
            const k = VB[2] / (svg.getBoundingClientRect().width * SCALE * state.solid.zoom * state.zoom);
            const step = [-dx * k, dy * k, 0];
            state.pan = add(state.pan, step);
            d.v = d.v ? d.v.map((c, i) => 0.35 * c + 0.65 * step[i] / dt) : scale(step, 1 / dt);
        } else if (dist > 0) {
            const axis = [dy / dist, dx / dist, 0];
            const angle = dist * 3.4 / toy.getBoundingClientRect().width;
            state.view = qnorm(qmul(qaxis(axis, angle), state.view));
            d.w = d.w.map((c, i) => 0.35 * c + 0.65 * axis[i] * angle / dt);
        }
        d.x = e.clientX;
        d.y = e.clientY;
        d.t = e.timeStamp;
        wake();
    });

    const endDrag = e => {
        const d = state.drag;
        if (!d || e.pointerId !== d.id) {
            return;
        }
        if (d.moved) {
            suppressClick = true;
            setTimeout(() => {
                suppressClick = false;
            }, 300);
            if (state.solid.planar) {
                if (d.v && e.timeStamp - d.t < 90) {
                    state.glide = {
                        v: d.v,
                        last: performance.now()
                    };
                }
            } else if (e.timeStamp - d.t < 90 && len(d.w) > 2e-4) {
                state.spin = {
                    w: d.w,
                    last: performance.now()
                };
            }
        }
        state.drag = null;
        toy.classList.remove('is-dragging');
        if (d.moved) {
            toy.blur();
        } // a drag shouldn't leave a focus ring
        wake();
    };
    toy.addEventListener('pointerup', endDrag);
    toy.addEventListener('pointercancel', endDrag);

    /* Keys: left and right change solid, up and down change family, and Space applies a random symmetry. The key legend lights up. */
    // A key pressed shows on its hint, and on its caret, if it has one.
    const CARET_OF = {
        ArrowLeft: '.tt-prev',
        ArrowRight: '.tt-next',
        ArrowUp: '.tt-caret-up',
        ArrowDown: '.tt-caret-down'
    };
    const press = name => {
        [keys && keys.querySelector(`[data-key="${name}"]`), CARET_OF[name] && document.querySelector(CARET_OF[name])].forEach(el => {
            if (!el) {
                return;
            }
            el.classList.add('is-down');
            clearTimeout(el.upTimer);
            el.upTimer = setTimeout(() => el.classList.remove('is-down'), 160);
        });
    };
    // (A switch is not for typing in: the keys go on working there.)
    const typing = el => el && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === 'INPUT' && !/^(checkbox|radio)$/.test(el.type)));
    // On a Mac, Control-F is free (Command-F finds); elsewhere it is Find.
    const MAC = /mac|iphone|ipad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
    document.addEventListener('keydown', e => {
        if (typing(e.target)) {
            return;
        }
        if (MAC && e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            press('ctrl-f');
            if (!e.repeat) {
                pickFace();
            }
            return;
        }
        if (e.altKey || e.ctrlKey || e.metaKey) {
            return;
        }
        const k = e.key;
        if (k === 'F' && e.shiftKey) {
            // Shift-F: the flag on or off, in the middle of the screen.
            press('F');
            if (!e.repeat) {
                toggleFlag();
            }
            return;
        }
        if (/^r$/i.test(k) && !e.shiftKey) {
            // R: rotations only, or all symmetries.
            press('r');
            if (!e.repeat) {
                toggleMode();
            }
            return;
        }
        if (k === 'ArrowLeft' || k === 'ArrowRight') {
            e.preventDefault();
            press(k);
            if (!e.repeat) {
                slide(k === 'ArrowLeft' ? -1 : 1);
            }
        } else if (k === 'ArrowUp' || k === 'ArrowDown') {
            e.preventDefault();
            press(k);
            if (!e.repeat) {
                switchFamily(k === 'ArrowUp' ? -1 : 1);
            }
        } else if (/^[pdf]$/i.test(k) && !e.shiftKey) {
            const key = k.toLowerCase();
            if (key === 'f' && !FAMILIES[state.family].facet) {
                return;
            }
            press(key);
            if (!e.repeat) {
                operate({
                    p: 'petrial',
                    d: 'dual',
                    f: 'facet'
                } [key]);
            }
        } else if (/^[hs]$/i.test(k) && !e.shiftKey) {
            // Among the pure polyhedra: H halving, S skewing.
            if (!FAMILIES[state.family].pure) {
                return;
            }
            const key = k.toLowerCase();
            press(key);
            if (!e.repeat) {
                operate(key === 'h' ? 'halve' : 'skew');
            }
        } else if (/^b$/i.test(k)) {
            // B: blended with a segment; Shift-B, with a line.
            if (!FAMILIES[state.family].blend) {
                return;
            }
            press(e.shiftKey ? 'B' : 'b');
            if (!e.repeat) {
                operate(e.shiftKey ? 'blend-line' : 'blend');
            }
        } else if (k === ' ' || k === 'Spacebar') {
            press('space');
            if (e.target === toy) {
                return;
            } // the button's own click handles it
            if (e.target.closest && e.target.closest('button, a, summary, [role="button"], input')) {
                return;
            }
            e.preventDefault();
            if (!e.repeat) {
                enqueue({});
            }
        }
    });
    // A mouse click shouldn't leave a button holding focus, or the next Space would press it again instead of turning the solid.
    document.addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('button, [role="button"], label');
        if (b && e.detail > 0) {
            b.blur();
            const inp = b.querySelector && b.querySelector('input');
            if (inp) {
                setTimeout(() => inp.blur(), 0);
            }
        }
    });

    /* Controls: the keys, whose hints along the bottom also work as clicks, and the carets (left and right of the figure, up and down after the title). */
    const toggleMode = () => {
        state.mode = state.mode === 'rotations' ? 'all' : 'rotations';
        say.textContent = state.mode === 'all' ? 'All symmetries.' : 'Rotations only.';
        syncHints();
    };
    const syncHints = () => {
        if (!keys) {
            return;
        }
        const fam = FAMILIES[state.family];
        keys.querySelectorAll('.tt-hint').forEach(h => {
            const only = h.dataset.only;
            h.hidden = (only && !fam[only]) || (h.hasAttribute('data-mac') && !MAC);
        });
        const sw = keys.querySelector('.tt-mode-input');
        if (sw) {
            sw.checked = state.mode === 'all';
        }
        const on = (act, v) => {
            const h = keys.querySelector(`[data-act="${act}"]`);
            if (h) {
                h.classList.toggle('is-on', v);
                h.setAttribute('aria-pressed', String(v));
            }
        };
        on('flag', state.flag);
        on('face', state.spotKey !== null);
    };
    const act = (name, key) => {
        if (name === 'left right') {
            slide(key === 'ArrowLeft' ? -1 : 1);
            return;
        }
        if (name === 'up down') {
            switchFamily(key === 'ArrowUp' ? -1 : 1);
            return;
        }
        if (name === 'random') {
            enqueue({});
            return;
        }
        if (name === 'flag') {
            toggleFlag();
            return;
        }
        if (name === 'face') {
            pickFace();
            return;
        }
        operate(name);
    };
    if (keys) {
        // (The switch is a checkbox, and toggles itself.)
        const sw = keys.querySelector('.tt-mode-input');
        if (sw) {
            sw.addEventListener('change', () => {
                if ((state.mode === 'all') !== sw.checked) {
                    toggleMode();
                }
            });
        }
        keys.addEventListener('click', e => {
            const h = e.target.closest('.tt-hint');
            if (!h || !h.dataset.act) {
                return;
            }
            const k = e.target.closest('kbd');
            act(h.dataset.act, k ? k.dataset.key : (h.dataset.act === 'left right' ? 'ArrowRight' : 'ArrowDown'));
        });
    }
    document.querySelectorAll('.tt-caret').forEach(b => b.addEventListener('click', () => {
        const d = b.dataset.nav;
        if (d === 'left' || d === 'right') {
            slide(d === 'left' ? -1 : 1);
        } else {
            switchFamily(d === 'up' ? -1 : 1);
        }
    }));

    /* Figure 2, the map: the polyhedra of the family, joined by the operations, laid out after McMullen and Schulte. A red drop marks where you are; an operation sends it flowing along its edge. */
    const SVGNS = 'http://www.w3.org/2000/svg';
    const mapSvg = document.querySelector('.tt-map-svg');
    const mapCap = document.getElementById('tt-map-cap');
    // Stacked for a narrow margin: each component of the slide's graph turned on its side, so P and D run down the columns and F across.
    const MAP_NODES = {
        'tetrahedron': [78, 40, '{3, 3}'],
        'tetrahedron-petrial': [182, 40, '{4, 3}', '3'],
        'octahedron-petrial': [78, 108, '{6, 4}', '3'],
        'cube-petrial': [182, 108, '{6, 3}', '4'],
        'octahedron': [78, 160, '{3, 4}'],
        'cube': [182, 160, '{4, 3}'],
        'icosahedron-petrial': [44, 232, '{10, 5}'],
        'icosahedron': [44, 284, '{3, 5}'],
        'dodecahedron': [44, 336, '{5, 3}'],
        'dodecahedron-petrial': [44, 388, '{10, 3}'],
        'great-dodecahedron-petrial': [130, 232, '{6, 5/2}'],
        'great-dodecahedron': [130, 284, '{5, 5/2}'],
        'small-stellated-dodecahedron': [130, 336, '{5/2, 5}'],
        'small-stellated-dodecahedron-petrial': [130, 388, '{6, 5}'],
        'great-stellated-dodecahedron-petrial': [218, 232, '{10/3, 3}'],
        'great-stellated-dodecahedron': [218, 284, '{5/2, 3}'],
        'great-icosahedron': [218, 336, '{3, 5/2}'],
        'great-icosahedron-petrial': [218, 388, '{10/3, 5/2}'],
    };
    const MAP_EDGES = [
        ['tetrahedron', 'tetrahedron-petrial', 'P'],
        ['octahedron-petrial', 'octahedron', 'P'],
        ['octahedron', 'cube', 'D'],
        ['cube-petrial', 'cube', 'P'],
        ['icosahedron-petrial', 'icosahedron', 'P'],
        ['icosahedron', 'dodecahedron', 'D'],
        ['dodecahedron', 'dodecahedron-petrial', 'P'],
        ['great-dodecahedron-petrial', 'great-dodecahedron', 'P'],
        ['great-dodecahedron', 'small-stellated-dodecahedron', 'D'],
        ['small-stellated-dodecahedron', 'small-stellated-dodecahedron-petrial', 'P'],
        ['great-stellated-dodecahedron-petrial', 'great-stellated-dodecahedron', 'P'],
        ['great-stellated-dodecahedron', 'great-icosahedron', 'D'],
        ['great-icosahedron', 'great-icosahedron-petrial', 'P'],
        ['icosahedron-petrial', 'great-dodecahedron-petrial', 'F'],
        ['icosahedron', 'great-dodecahedron', 'F'],
        ['small-stellated-dodecahedron', 'great-icosahedron', 'F'],
        ['small-stellated-dodecahedron-petrial', 'great-icosahedron-petrial', 'F'],
    ];
    const OP_OF = {
        P: 'petrial',
        D: 'dual',
        F: 'facet',
        H: 'halve',
        S: 'skew',
        SD: 'skew'
    };
    const triple = n => `(<i>R</i><sub>0</sub>, ${n}, <i>R</i><sub>2</sub>)`;
    const MAPS = {
        finite: {
            viewBox: '0 0 260 404',
            nodes: MAP_NODES,
            edges: MAP_EDGES,
            groups: [
                [130, 14, 'Tetrahedral'],
                [130, 82, 'Octahedral'],
                [130, 206, 'Icosahedral']
            ],
            caption: 'You are here, in red, among the 18 finite regular polyhedra, after McMullen and Schulte. P is the Petrial, D the dual, ' +
                `and F the facetting ${triple('<i>R</i><sub>1</sub>')} &#8614; ${triple('<i>R</i><sub>1</sub><i>R</i><sub>2</sub><i>R</i><sub>1</sub>')}. Click a polyhedron to go there.`,
        },
        // The planar part of the slide on the 6 planar and 12 blended apeirohedra, stacked like the octahedral part above.
        planar: {
            viewBox: '0 0 260 176',
            nodes: {
                'square': [78, 40, '{4, 4}'],
                'square-petrial': [182, 40, '{∞, 4}', '4'],
                'triangular-petrial': [78, 108, '{∞, 6}', '3'],
                'hexagonal-petrial': [182, 108, '{∞, 3}', '6'],
                'triangular': [78, 160, '{3, 6}'],
                'hexagonal': [182, 160, '{6, 3}'],
            },
            edges: [
                ['square', 'square-petrial', 'P'],
                ['triangular-petrial', 'triangular', 'P'],
                ['triangular', 'hexagonal', 'D'],
                ['hexagonal-petrial', 'hexagonal', 'P'],
            ],
            groups: [
                [130, 14, 'Square'],
                [130, 82, 'Hexagonal']
            ],
            caption: 'You are here, in red, among the 6 planar regular polyhedra, after McMullen and Schulte. ' +
                'P is the Petrial and D the dual; the square tiling is its own dual. B blends a tiling with a segment, Shift-B with a line. Click a polyhedron to go there.',
        },
    };
    // The blended part of the same slide: each with a segment, then each with a line, the Petrials across.
    const blendRows = (q, y0) => {
        const withQ = ` # ${q === 'seg' ? '{ }' : '{∞}'}`;
        return Object.fromEntries([
                ['square', '{4, 4}', '{∞, 4}', '4'],
                ['triangular', '{3, 6}', '{∞, 6}', '3'],
                ['hexagonal', '{6, 3}', '{∞, 3}', '6']
            ]
            .flatMap(([base, a, b, sub], r) => [
                [`${base}-${q}`, [70, y0 + 38 * r, a + withQ]],
                [`${base}-${q}-petrial`, [192, y0 + 38 * r, b, sub, withQ]]
            ]));
    };
    MAPS.blended = {
        viewBox: '0 0 260 272',
        nodes: {
            ...blendRows('seg', 40),
            ...blendRows('line', 182)
        },
        edges: ['seg', 'line'].flatMap(q => ['square', 'triangular', 'hexagonal'].map(base => [`${base}-${q}`, `${base}-${q}-petrial`, 'P'])),
        groups: [
            [130, 14, 'With a segment'],
            [130, 156, 'With a line']
        ],
        caption: 'You are here, in red, among the 12 blended regular polyhedra, after McMullen and Schulte. P is the Petrial; ' +
            'Shift-B goes from a blend with a segment to the blend with a line, and B back to the tiling. Click a polyhedron to go there.',
    };
    // Figure 2 is the family's map, or on a blend the blends' map.
    let mapKind = null;
    // The 12 pure polyhedra (slide 25, after McMullen and Schulte), in three columns: the Petrie–Coxeter polyhedra down the middle with what comes of them. One-way operations (">") have one arrowhead.
    MAPS.pure = {
        viewBox: '0 0 300 318',
        nodes: {
            'muoctahedron-petrial': [50, 30, '{∞, 4}', '6,4'],
            'muoctahedron': [150, 30, '{6, 4 | 4}'],
            'helical-4': [50, 96, '{∞, 4}', '·,*3'],
            'mucube': [150, 96, '{4, 6 | 4}'],
            'mucube-petrial': [250, 96, '{∞, 6}', '4,4'],
            'skew-664': [150, 162, '{6, 6}', '4'],
            'helical-3': [250, 162, '{∞, 3}⁽ᵃ⁾'],
            'skew-646': [50, 228, '{6, 4}', '6'],
            'skew-664-petrial': [150, 228, '{4, 6}', '6'],
            'helical-3-petrial': [250, 228, '{∞, 3}⁽ᵇ⁾'],
            'mutetrahedron-petrial': [50, 294, '{∞, 6}', '6,3'],
            'mutetrahedron': [150, 294, '{6, 6 | 3}'],
        },
        edges: [
            ['muoctahedron-petrial', 'muoctahedron', 'P'],
            ['muoctahedron', 'mucube', 'D'],
            ['mucube', 'mucube-petrial', 'P'],
            ['muoctahedron', 'helical-4', '>S'],
            ['mucube', 'skew-664', '>H'],
            ['skew-664', 'helical-3', '>F'],
            ['skew-664', 'skew-664-petrial', 'P'],
            ['helical-3', 'helical-3-petrial', 'P'],
            ['skew-646', 'skew-664-petrial', 'D'],
            ['skew-664-petrial', 'helical-3-petrial', '>F'],
            ['skew-664-petrial', 'mutetrahedron', '>H'],
            ['skew-646', 'mutetrahedron-petrial', '>SD'],
            ['mutetrahedron-petrial', 'mutetrahedron', 'P'],
        ],
        groups: [],
        caption: 'You are here, in red, among the 12 pure regular polyhedra, after McMullen and Schulte; all come from the cubical honeycomb {4, 3, 4}. ' +
            'P is the Petrial, D the dual, F the facetting φ<sub>2</sub>, H the halving η: (<i>R</i><sub>0</sub>, <i>R</i><sub>1</sub>, <i>R</i><sub>2</sub>) &#8614; (<i>R</i><sub>0</sub><i>R</i><sub>1</sub><i>R</i><sub>0</sub>, <i>R</i><sub>2</sub>, <i>R</i><sub>1</sub>), ' +
            'and S the skewing σ = πδηπδ (SD: σ then δ). Click a polyhedron to go there.',
    };
    // Where each operation leads, from each node (see destination).
    const PURE_STEPS = {};
    MAPS.pure.edges.forEach(([a, b, k]) => {
        const kind = OP_OF[k.replace('>', '')];
        if (kind === 'petrial') {
            return;
        }
        (PURE_STEPS[kind] = PURE_STEPS[kind] || {})[a] = b;
        if (!k.startsWith('>')) {
            PURE_STEPS[kind][b] = a;
        }
    });
    // (familyOnly: changing family, before its polyhedron is set, as for syncHeading.)
    const syncMap = (familyOnly = false) => {
        const kind = !familyOnly && state.solid && state.solid.blend ? 'blended' : FAMILIES[state.family].kind;
        if (kind === mapKind && map) {
            return;
        }
        const swap = mapKind !== null;
        mapKind = kind;
        if (mapCap) {
            mapCap.innerHTML = MAPS[kind].caption;
        }
        map = makeMap(MAPS[kind]);
        if (map) {
            map.layout();
        }
        if (swap && mapSvg && mapSvg.animate && !reducedMotion.matches) {
            mapSvg.animate([{
                opacity: 0
            }, {
                opacity: 1
            }], {
                duration: 320,
                easing: 'ease-out'
            });
        }
    };

    const makeMap = spec => {
        if (!mapSvg) {
            return null;
        }
        const el = (name, attrs, parent) => {
            const e = document.createElementNS(SVGNS, name);
            for (const [k, v] of Object.entries(attrs)) {
                e.setAttribute(k, v);
            }
            if (parent) {
                parent.append(e);
            }
            return e;
        };
        mapSvg.replaceChildren();
        const defs = el('defs', {}, mapSvg);
        // The gooey filter: blur, then a hard alpha threshold, so nearby blobs run together like liquid.
        const goo = el('filter', {
            id: 'tt-goo',
            x: '-20%',
            y: '-40%',
            width: '140%',
            height: '180%'
        }, defs);
        el('feGaussianBlur', {
            in: 'SourceGraphic',
            stdDeviation: 5,
            result: 'b'
        }, goo);
        el('feColorMatrix', {
            in: 'b',
            mode: 'matrix',
            values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9'
        }, goo);
        mapSvg.setAttribute('viewBox', spec.viewBox);
        for (const [x, y, t] of spec.groups) {
            el('text', {
                x,
                y,
                class: 'tt-map-group'
            }, mapSvg).textContent = t;
        }
        const edgeLayer = el('g', {
            class: 'tt-map-edges'
        }, mapSvg);
        const drops = el('g', {
            class: 'tt-map-drop',
            filter: 'url(#tt-goo)'
        }, mapSvg);
        const nodeLayer = el('g', {}, mapSvg);
        const pill = {
            from: el('rect', {}, drops),
            to: el('rect', {}, drops)
        };
        const beads = [0, 1, 2].map(() => el('circle', {
            r: 0
        }, drops));

        const nodes = {};
        for (const [key, [x, y, label, sub, after]] of Object.entries(spec.nodes)) {
            const g = el('g', {
                class: 'tt-map-node',
                tabindex: 0,
                role: 'button'
            }, nodeLayer);
            const text = el('text', {
                x,
                y
            }, g);
            text.textContent = label;
            if (sub) {
                el('tspan', {
                    'baseline-shift': 'sub',
                    class: 'tt-map-sub'
                }, text).textContent = sub;
            }
            if (after) {
                el('tspan', {}, text).textContent = after;
            }
            const {
                name,
                petrial
            } = nodeOf(key), t = DEFS[name].title || name;
            g.setAttribute('aria-label', `${capitalize(petrial ? `Petrial of the ${t}` : t)}, ${label}${sub ? ` sub ${sub}` : ''}`);
            g.addEventListener('click', () => navigate(key));
            g.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate(key);
                }
            });
            nodes[key] = {
                x,
                y,
                g,
                text,
                box: null
            };
        }
        const edges = spec.edges.map(([a, b, kind]) => ({
            a,
            b,
            kind,
            line: el('path', {
                class: 'tt-map-edge'
            }, edgeLayer),
            label: el('text', {
                class: 'tt-map-op'
            }, edgeLayer)
        }));
        for (const e of edges) {
            e.label.textContent = e.kind.replace('>', '');
        }

        // Edges run between the labels' boxes, measured once the font is in.
        const layout = () => {
            for (const n of Object.values(nodes)) {
                const b = n.text.getBBox();
                n.box = {
                    x: b.x,
                    y: b.y,
                    w: b.width,
                    h: b.height
                };
            }
            // (A slanting edge runs between where the line through the labels' middles leaves each one's box, a little out from it.)
            const leave = (n, dx, dy, pad) => {
                const cy = n.box.y + n.box.h / 2,
                    hw = n.box.w / 2 + pad,
                    hh = n.box.h / 2 + pad;
                const t = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
                return [n.x + t * dx, cy + t * dy];
            };
            for (const e of edges) {
                const A = nodes[e.a],
                    B = nodes[e.b],
                    across = Math.abs(A.y - B.y) < 1,
                    slant = !across && Math.abs(A.x - B.x) >= 1;
                const [x1, y1, x2, y2] = across
                    ?
                    [A.box.x + A.box.w + 8, A.y, B.box.x - 8, B.y] :
                    slant ? [...leave(A, B.x - A.x, B.y - A.y, 5), ...leave(B, A.x - B.x, A.y - B.y, 5)] :
                    [A.x, A.box.y + A.box.h + 5, B.x, B.box.y - 5];
                const ang = Math.atan2(y2 - y1, x2 - x1),
                    hd = 4.5,
                    w = 0.55;
                const head = (x, y, a) => `M${(x - hd * Math.cos(a - w)).toFixed(1)},${(y - hd * Math.sin(a - w)).toFixed(1)}L${x.toFixed(1)},${y.toFixed(1)}L${(x - hd * Math.cos(a + w)).toFixed(1)},${(y - hd * Math.sin(a + w)).toFixed(1)}`;
                // (One way, ">": a head at the far end only.)
                const oneWay = e.kind.startsWith('>');
                e.line.setAttribute('d', `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}${head(x2, y2, ang)}${oneWay ? '' : head(x1, y1, ang + Math.PI)}`);
                // The operation's letter: over an edge across, beside the middle of a slanting one (on its upper side), right of one going down.
                const L = Math.hypot(x2 - x1, y2 - y1) || 1,
                    nx = (y2 - y1) / L,
                    ny = -(x2 - x1) / L,
                    s = ny > 0 ? -1 : 1;
                const [lx, ly, anchor] = across ? [(x1 + x2) / 2, y1 - 6, 'middle'] :
                    slant ? [(x1 + x2) / 2 + 7 * s * nx, (y1 + y2) / 2 + 7 * s * ny + 3.5, 'middle'] : [x1 + 6, (y1 + y2) / 2 + 3.5, 'start'];
                e.label.setAttribute('x', lx.toFixed(1));
                e.label.setAttribute('y', ly.toFixed(1));
                e.label.setAttribute('text-anchor', anchor);
            }
            draw(here, here, 1);
        };

        // The drop: a pill under a label; between two labels, the pill drains from one, three beads run along the way, and a pill fills the other.
        let here = null,
            anim = null;
        const pillAt = (r, key, k) => {
            const n = nodes[key];
            if (!n || !n.box || k <= 0.001) {
                r.setAttribute('width', 0);
                r.setAttribute('height', 0);
                return;
            }
            const w = (n.box.w + 16) * k + 14 * (1 - k),
                h = (n.box.h + 6) * Math.min(1, 0.55 + 0.45 * k);
            r.setAttribute('x', (n.x - w / 2).toFixed(1));
            r.setAttribute('y', (n.y - h / 2 - 1).toFixed(1));
            r.setAttribute('width', w.toFixed(1));
            r.setAttribute('height', h.toFixed(1));
            r.setAttribute('rx', (h / 2).toFixed(1));
        };
        const draw = (a, b, t) => {
            if (!a || !nodes[a] || !nodes[a].box) {
                return;
            }
            const e = EASY_EASE(clamp(t, 0, 1));
            pillAt(pill.from, a, a === b ? 1 : 1 - smoothstep(0, 0.4, t));
            pillAt(pill.to, b, a === b ? 0 : smoothstep(0.6, 1, t));
            const A = nodes[a],
                B = nodes[b];
            beads.forEach((c, i) => {
                const f = EASY_EASE(clamp((t - 0.06 * i - 0.08) / 0.8, 0, 1)),
                    live = a === b ? 0 : Math.sin(Math.PI * clamp((t - 0.04 * i) / 0.95, 0, 1));
                c.setAttribute('cx', (A.x + (B.x - A.x) * f).toFixed(1));
                c.setAttribute('cy', (A.y - 1 + (B.y - A.y) * f).toFixed(1));
                c.setAttribute('r', ((9 - 2 * i) * live).toFixed(1));
            });
            for (const [key, n] of Object.entries(nodes)) {
                const on = (key === a && (a === b || e < 0.3)) || (key === b && e > 0.75);
                n.g.classList.toggle('is-here', on);
            }
        };
        const tick = now => {
            if (!anim) {
                return;
            }
            const t = (now - anim.t0) / anim.dur;
            draw(anim.a, anim.b, t);
            if (t >= 1) {
                here = anim.b;
                anim = null;
                draw(here, here, 1);
                return;
            }
            requestAnimationFrame(tick);
        };
        if (document.fonts) {
            document.fonts.ready.then(layout);
        }
        return {
            nodes,
            layout,
            // Flow to key over ms, after delay ms (default: a quick hop now).
            go(key, ms = 650, delay = 0) {
                if (!nodes[key]) {
                    return;
                }
                clearTimeout(this.timer);
                if (delay > 0) {
                    this.timer = setTimeout(() => this.go(key, ms), delay);
                    return;
                }
                if (!here || reducedMotion.matches || !nodes[here].box) {
                    here = key;
                    anim = null;
                    draw(key, key, 1);
                    return;
                }
                const a = anim ? anim.b : here;
                if (a === key && !anim) {
                    return;
                }
                anim = {
                    a,
                    b: key,
                    t0: performance.now(),
                    dur: Math.max(300, ms)
                };
                requestAnimationFrame(tick);
            },
            // A refused operation: the drop shivers in place.
            wobble() {
                if (reducedMotion.matches || !here) {
                    return;
                }
                const g = nodes[here].g;
                drops.animate([{
                    transform: 'none'
                }, {
                    transform: 'scale(1.06, 0.94)'
                }, {
                    transform: 'scale(0.97, 1.03)'
                }, {
                    transform: 'none'
                }], {
                    duration: 420,
                    easing: 'ease-out'
                });
                g.animate([{
                    transform: 'none'
                }, {
                    transform: 'translateY(-1px)'
                }, {
                    transform: 'none'
                }], {
                    duration: 300
                });
            },
            get here() {
                return here;
            },
        };
    };

    // A blend's larger window (on wide screens): the middle column opens up and the figure grows into it, everything else staying where it is (the label over it, the caption under it). Its drawing keeps its size as the window opens (inkScale), so more of the blend comes into view.
    // (And as it closes again: until then the window is wider than it was.)
    // (Widths as laid out, as the canvas is fitted to them: not as the carousel turns the figure.)
    let wideOn = false,
        baseWidth = 0,
        wideUntil = 0,
        wideTo = 0,
        wideTimer = 0;
    const inkScale = () => ((wideOn || performance.now() < wideUntil) && baseWidth ? baseWidth / toy.offsetWidth : 1);
    // (And once the window has finished opening.)
    const inkOpen = () => (wideOn && baseWidth && wideTo ? baseWidth / wideTo : 1);
    // How wide the figure will be once the window has opened: measured with the window open at once, then shut again for it to open as usual.
    const wideWidth = () => {
        if (!wider.matches) {
            return toy.offsetWidth;
        }
        const stage = toy.parentElement,
            was = layout.classList.contains('is-wide');
        stage.style.transition = 'none';
        layout.classList.add('is-wide');
        const w = toy.offsetWidth;
        if (!was) {
            layout.classList.remove('is-wide');
        }
        void stage.offsetWidth;
        stage.style.transition = '';
        return w;
    };
    const setWide = on => {
        on = Boolean(on && wider.matches);
        if (on === wideOn) {
            return;
        }
        if (on) {
            baseWidth = toy.offsetWidth;
        }
        wideOn = on;
        // (The figure's width eases from what it is, in pixels, to what it will be: its rule is a share of a column that changes at once.)
        const stage = toy.parentElement,
            w0 = stage.getBoundingClientRect().width;
        layout.classList.toggle('is-wide', on);
        stage.style.transition = 'none';
        stage.style.width = '';
        const w1 = stage.getBoundingClientRect().width;
        wideTo = toy.offsetWidth;
        stage.style.width = `${w0}px`;
        void stage.offsetWidth;
        stage.style.transition = '';
        requestAnimationFrame(() => {
            stage.style.width = `${w1}px`;
        });
        clearTimeout(wideTimer);
        wideTimer = setTimeout(() => {
            stage.style.width = '';
        }, 700);
        wideUntil = performance.now() + 800;
        if (backend.R.hold) {
            backend.R.hold(wideTo, 720);
        }
        setTimeout(alignPanel, 820);
        wake();
    };
    window.addEventListener('resize', () => setWide(state.solid && state.solid.spatial));

    // What the family shows: the heading, the map, and the keys that do something there.
    const heading = document.querySelector('.tt-head h1');
    const countEl = heading && heading.querySelector('.tt-count');
    const kindEl = heading && heading.querySelector('.tt-kind');

    // Up and down turn a picker wheel. The lines that change with the family (its name, its polyhedra) ride on it: the old ones go over the top (for d = 1), fading out, as the new ones come up from under, fading in.
    const wheelFrames = (d, out) => {
        const at = (deg, o) => ({
            transform: wheelTurn(deg, 0.85, 9, 'em'),
            opacity: o
        });
        return out ? [at(0, 1), at(d * WHEEL_DEG, 0)] : [at(-d * WHEEL_DEG, 0), at(0, 1)];
    };
    const wheelOpts = {
        duration: WHEEL_MS,
        easing: WHEEL_CSS,
        fill: 'both'
    };

    // The title's number counts its way to the new one, one by one, slow, fast, slow; the width it takes eases along with it.
    const span = (t, cls) => {
        const x = document.createElement('span');
        x.className = cls;
        x.textContent = t;
        return x;
    };
    const widthOf = (el, t) => {
        const m = span(t, 'tt-measure');
        el.parentElement.append(m);
        const w = m.getBoundingClientRect().width;
        m.remove();
        return w;
    };
    const countTo = (el, to, animate) => {
        cancelAnimationFrame(el.counting);
        const from = Number(el.dataset.n || el.textContent);
        el.dataset.n = to;
        if (!animate || from === to || reducedMotion.matches) {
            el.textContent = to;
            el.style.width = '';
            el.classList.remove('is-counting');
            return;
        }
        const w0 = widthOf(el, String(from)),
            w1 = widthOf(el, String(to)),
            t0 = performance.now();
        const step = now => {
            const e = EASY_EASE(since(t0, COUNT_MS, now));
            el.textContent = Math.round(from + (to - from) * e);
            el.style.width = `${(w0 + (w1 - w0) * e).toFixed(2)}px`;
            if (e < 1) {
                el.counting = requestAnimationFrame(step);
            } else {
                el.style.width = '';
                el.classList.remove('is-counting');
            }
        };
        el.classList.add('is-counting');
        el.counting = requestAnimationFrame(step);
    };
    // The family's word turns on the picker wheel like the lines under it (see wheelBlock), while the title closes up around it.
    const wheelWord = (el, text, d) => {
        const from = el.dataset.word || el.textContent;
        el.dataset.word = text;
        if (!d || from === text || reducedMotion.matches || !el.animate) {
            el.textContent = text;
            return;
        }
        const w0 = widthOf(el, from),
            w1 = widthOf(el, text);
        const box = span('', 'tt-word-box'),
            out = span(from, 'tt-word-part'),
            inn = span(text, 'tt-word-part');
        box.append(span(text, 'tt-word-hold'), out, inn);
        el.replaceChildren(box);
        box.animate([{
            width: `${w0}px`
        }, {
            width: `${w1}px`
        }], wheelOpts);
        out.animate(wheelFrames(d, true), wheelOpts);
        inn.animate(wheelFrames(d, false), wheelOpts).onfinish = () => {
            if (el.contains(box)) {
                el.textContent = text;
            }
        };
    };

    // A whole line on the wheel: el, with its new contents, comes up as old (a copy of it as it was) goes over, laid exactly on top of it.
    const wheelBlock = (el, old, d) => {
        if (!d || reducedMotion.matches || !el.animate) {
            return;
        }
        old.removeAttribute('id');
        old.setAttribute('aria-hidden', 'true');
        old.classList.add('tt-wheel-old');
        Object.assign(old.style, {
            left: `${el.offsetLeft}px`,
            top: `${el.offsetTop}px`,
            width: `${el.offsetWidth}px`
        });
        el.parentElement.insertBefore(old, el);
        el.classList.add('tt-wheel');
        old.animate(wheelFrames(d, true), wheelOpts).onfinish = () => old.remove();
        el.animate(wheelFrames(d, false), wheelOpts).onfinish = () => el.classList.remove('tt-wheel');
    };

    // The title: the family's, or on a blend the 12 blended polyhedra (the number counting, the word on the wheel, as between families).
    let shownHeading = null;
    // (familyOnly: changing family, before its polyhedron is set.)
    const syncHeading = (d = 0, familyOnly = false) => {
        const fam = FAMILIES[state.family],
            blend = !familyOnly && state.solid && state.solid.blend;
        const h = blend ? {
            count: 12,
            kind: 'blended',
            heading: 'There are 12 blended regular polyhedra.'
        } : fam;
        if (shownHeading === h.heading) {
            return;
        }
        const first = shownHeading === null;
        shownHeading = h.heading;
        if (countEl && kindEl) {
            countTo(countEl, h.count, !first && d !== 0);
            wheelWord(kindEl, h.kind, first ? 0 : d);
        } else if (heading) {
            heading.textContent = h.heading;
        }
        // (The page itself keeps its one name: There are 48 regular polyhedra.)
    };
    const familyChrome = (d = 0) => {
        syncHeading(d, true);
        // (Only the keys that do something here: F among the finite and the pure polyhedra, H and S among the pure ones, B among the tilings.)
        syncHints();
        // (The map, and the wide window, follow the polyhedron: see setSolid.)
        mapKind = null;
        syncMap(true);
    };
    // Into another family other than by the arrows (the address, the console): everything that depends on it, at once.
    const changeFamily = f => {
        state.family = f;
        familyChrome();
        requestAnimationFrame(alignPanel);
    };

    // Clicking a node: one step away, take that step; otherwise go there.
    const navigate = key => {
        if (op || trans) {
            return;
        }
        const now = keyOfNode(state.solid.name, state.form);
        if (key === now) {
            map.wobble();
            return;
        }
        const step = MAPS[mapKind].edges.find(([a, b, k]) => (a === now && b === key) || (!k.startsWith('>') && b === now && a === key));
        if (step) {
            operate(OP_OF[step[2].replace('>', '')]);
            return;
        }
        const {
            name,
            petrial
        } = nodeOf(key);
        setSolid(name, {
            form: petrial ? 'petrial' : null
        });
    };

    /* Start: the solid named in the address, or the icon's dodecahedron. */
    const start = nodeOf(location.hash.slice(1));
    state.family = familyOf(start.name);
    familyLabel.textContent = FAMILIES[state.family].name;
    familyChrome();
    setSolid(known(start.name) ? start.name : 'dodecahedron', {
        form: start.petrial ? 'petrial' : null
    });
    alignPanel();
    // A new address: a neighbor in the family slides in; anything else is gone to at once.
    window.addEventListener('hashchange', () => {
        const key = location.hash.slice(1),
            {
                name,
                petrial
            } = nodeOf(key);
        if (!known(name) || key === keyOfNode(state.solid.name, state.form)) {
            return;
        }
        const members = FAMILIES[state.family].members,
            k = members.indexOf(name);
        if (k < 0 || k === state.member || petrial) {
            setSolid(name, {
                form: petrial ? 'petrial' : null
            });
        } else {
            slide(wrap(k - state.member, members.length));
        }
    });

    // The shading depends on the theme: redraw when it turns.
    // (Colors are worked out for the theme as it is; when it turns they fade over as the page's do.)
    const retheme = () => {
        const dark = darkTheme();
        if (dark === theme.dark) {
            return;
        }
        readPalette(dark);
        theme.dark = dark;
        // (Fading as the page does: over the toggle's cross-fade, or at once.)
        if (document.documentElement.classList.contains('theme-fade')) {
            theme.fade = {
                from: theme.mix,
                to: dark ? 1 : 0,
                t0: performance.now()
            };
        } else {
            theme.fade = null;
            theme.mix = dark ? 1 : 0;
        }
        wake();
    };
    new MutationObserver(retheme).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);

    // For poking at it from the console.
    window.symmetryToy = {
        state,
        enqueue,
        featureUnder,
        turnAbout,
        planarPoseNow,
        drawNow: () => frame(performance.now()),
        setSolid,
        operate,
        navigate,
        slide,
        switchFamily,
        wake,
        cameraView,
        buildMove,
        FAMILIES,
        DEFS,
        solidOf,
        groupOf,
        get map() {
            return map;
        },
        get trans() {
            return trans;
        },
        get op() {
            return op;
        }
    };
};

init();
