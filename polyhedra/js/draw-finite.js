// Drawing the finite polyhedra.

import {
    add,
    cross,
    det3,
    dot,
    dot2,
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
    newell
} from './solids.js';
import {
    AXIS_REACH,
    CENTER,
    CREASE_W,
    cutBack,
    darkTheme,
    drawLoops,
    drawWeave,
    faceHue,
    frontOf,
    HIDDEN,
    innerBands,
    INSET,
    LIGHT,
    loopColor,
    loopPaint,
    MIRROR_RADIUS,
    outline,
    ROUND,
    screen,
    shadedColor,
    shadedEdge,
    STROKE,
    trim,
} from './look.js';
import {
    clipPath,
    path,
    rgb
} from './dl.js';

// Forms: 'solid', a convex polyhedron in ink; 'faces', a star polyhedron, each face a colored loop; 'petrial', each face (a Petrie polygon) a colored loop. Off the ink, a flag is drawn as its half-edge with a tick along the face's next edge.
export const buildScene = (S, form = 'solid') => ({
    form,
    finite: true
});

// Drawn into the group dl. T: the full linear map (view · move · position). fx: overlays.
export const draw = (dl, scene, S, T, fx) => {
    const P = S.V.map(v => mvec(T, v));
    const ink = rgb('ink'),
        accent = rgb('accent');
    // In paint order. Each face's fill (each piece of a star's outer surface, with its creases), far to near; the face under the pointer, the flag and the mirror; the far end of an axis; a halo on what is under the pointer; the ink; the loops; the flag off the ink; the near end of the axis; the center.
    const gShade = dl.group(),
        gFaces = dl.group(),
        gFlag = dl.group(),
        gMirror = dl.group(),
        gAxisFar = dl.group();
    const gAimMarks = dl.group(),
        gEdges = dl.group(),
        gLanes = dl.group(),
        gCorner = dl.group(),
        gAxisNear = dl.group(),
        gMarks = dl.group();

    // How much each face faces the viewer, from its projected (Newell) normal. On a Petrial these are the faces of the polyhedron it came from.
    const front = frontOf(S, P, T);
    const petrial = scene.form === 'petrial',
        looped = scene.form !== 'solid';

    // The ink wireframe, for a convex solid. sk, from 0 to 1, thins it to a faint skeleton with sharp corners; bare takes even that away.
    const sk = fx.skeleton === undefined ? (looped ? 1 : 0) : fx.skeleton;
    const bare = fx.bare === undefined ? (looped ? 1 : 0) : fx.bare;
    const inkA = fx.ink === undefined ? 1 : fx.ink;
    // (Only a convex solid's: a star's ink is its creases, drawn with its faces, and a Petrial has none.)
    // (edgesOff: the edges gone while an operation draws new faces over the old, shrunk to loops, so no hairline runs between them.)
    const edgesOff = fx.edgesOff || 0;
    gEdges.alpha = !looped ? inkA * (1 - 0.55 * sk) * (1 - bare) * (1 - edgesOff) : 0;
    const width = STROKE * (1 - 0.7 * sk);

    // Rounded outline; edges at its corners end on the curve. Fills and the flag are cut to it.
    const Q = P.map(screen);
    const hull = outline(Q);
    const hullClip = clipPath(hull.path);
    gFaces.clip = hullClip;
    gFlag.clip = hullClip;
    const cut = (i, j) => (hull.at.has(i) ? (1 - sk) * cutBack(hull.at.get(i), Q[j]) : 0);
    const segment = (i, j) => trim(Q[i], Q[j], cut(i, j), cut(j, i));
    // An edge is in front if either face on it is: sharply, so an edge between two faces turned away (which the faces in front hide) never shows through them, not even faintly as a face nears edge-on (where it turns, the edge lies on the outline, so nothing jumps).
    const frontE = frontOf(S, P, T, 0.004);
    const edgeFront = k => {
        const [f1, f2] = S.EDGE_FACES[k];
        return Math.max(frontE[f1], frontE[f2]);
    };

    // Shading, where the faces are planar (not on a Petrial): each face in its own color, opaque, lighter the more it faces the light. It goes with the ink on a solid, and with the faces' loops on a star; the hidden edges go behind it.
    // (A star's planar faces go just as a convex solid's do: skeleton, bare and ink act on them, and on its creases, the star's own ink.)
    const shadeOn = petrial ? 0 :
        inkA * (1 - (fx.bare || 0)) * (scene.form === 'faces' && fx.loops !== undefined ? fx.loops : 1);
    const creaseSk = fx.skeleton === undefined ? 0 : fx.skeleton,
        creaseW = CREASE_W * (1 - 0.7 * creaseSk);
    // In the dark, the faces' own bands stand in for the ink in front, as far as the faces are shown in full (see shadedEdge).
    const dark = darkTheme(),
        banded = dark ? shadeOn * (1 - (fx.shadeDim || 0)) : 0;
    if (gEdges.alpha > 0.001) {
        S.EDGES.forEach(([i, j], k) => {
            const [a, b] = segment(i, j), v = edgeFront(k);
            // (Only the edges in front: hidden ones are not drawn.)
            gEdges.shape({
                path: path().seg(a, b),
                stroke: ink,
                width,
                alpha: v * (1 - banded)
            });
        });
        gEdges.shape({
            path: hull.path,
            stroke: ink,
            width: STROKE,
            alpha: (1 - sk) * (1 - banded) * (1 - edgesOff)
        });
    }
    const flip = det3(T) < 0 ? -1 : 1,
        n = S.FACES.length;
    const faceLight = S.FACES.map(f => {
        const nv = unit(newell(f.ids.map(i => P[i]))),
            sign = flip * f.orient;
        return {
            nz: sign * nv[2],
            lit: sign * dot(nv, LIGHT)
        };
    });
    const spotted = scene.form === 'faces' && fx.spot !== null && fx.spot !== undefined ? fx.spot : null;
    // A star's faces pass through each other: what shows is its outer surface (S.PIECES), drawn far to near.
    const items = [];
    if (shadeOn > 0.001) {
        (S.PIECES || S.FACES.map((f, k) => ({
            face: k,
            pts: f.ids.map(i => S.V[i])
        }))).forEach(pc => {
            const fl = faceLight[pc.face];
            if (fl.nz <= 0) {
                return;
            }
            const q = pc.pts.map(p => mvec(T, p));
            items.push({
                pc,
                q,
                fl,
                depth: q.reduce((sum, p) => sum + p[2], 0) / q.length
            });
        });
        items.sort((a, b) => a.depth - b.depth);
    }
    const bandW = S.PIECES ? 3.5 : (STROKE / 2) * (1 - 0.7 * sk);
    // A star's points are rounded as a convex solid's corners are, wherever they show: at each vertex where the faces in view meet in a wedge of less than a half-turn (on the outline or standing in front of other faces), a curve reaching ROUND along the wedge's two sides. The faces there are clipped to it (each with its own clip, so what is behind shows), the creases end on it, and it is drawn in their ink.
    const tips = new Map(),
        creaseA = (1 - 0.55 * creaseSk) * (1 - banded) * (1 - edgesOff),
        tipSlots = new Map();
    if (S.PIECES) {
        const TAU = 2 * Math.PI,
            at = new Map();
        const side = (a, x) => {
            const L = Math.hypot(x[0] - a[0], x[1] - a[1]);
            return {
                dir: [(x[0] - a[0]) / L, (x[1] - a[1]) / L],
                L,
                ang: Math.atan2(x[1] - a[1], x[0] - a[0])
            };
        };
        items.forEach((it, slot) => {
            const pts = it.pc.pts,
                n2 = pts.length;
            it.pc.ptIds.forEach((i, k) => {
                if (i < 0) {
                    return;
                }
                const a = Q[i],
                    A = side(a, screen(mvec(T, pts[(k + n2 - 1) % n2]))),
                    B = side(a, screen(mvec(T, pts[(k + 1) % n2])));
                const ccw = mod(B.ang - A.ang, TAU);
                const w = ccw < Math.PI ? {
                    s: A.ang,
                    w: ccw,
                    ds: A,
                    de: B
                } : {
                    s: B.ang,
                    w: TAU - ccw,
                    ds: B,
                    de: A
                };
                const e = at.get(i) || {
                    a,
                    wedges: [],
                    slots: []
                };
                e.wedges.push(w);
                e.slots.push(slot);
                at.set(i, e);
            });
        });
        const inside = (x, q) => mod(x - q.s, TAU) < q.w - 1e-7;
        at.forEach(({
            a,
            wedges,
            slots
        }, i) => {
            const covered = x => wedges.some(q => inside(x, q));
            const ends = wedges.filter(q => !covered(q.s + q.w + 1e-6)),
                starts = wedges.filter(q => !covered(q.s - 1e-6));
            if (ends.length !== 1 || starts.length !== 1) {
                return;
            }
            const lo = starts[0].ds,
                hi = ends[0].de,
                span = mod(hi.ang - lo.ang, TAU);
            if (span > Math.PI - 0.08) {
                return;
            }
            const r = Math.min(ROUND, 0.42 * lo.L, 0.42 * hi.L);
            const t = {
                a,
                r,
                u1: lo.dir,
                u2: hi.dir,
                p1: [a[0] + r * lo.dir[0], a[1] + r * lo.dir[1]],
                p2: [a[0] + r * hi.dir[0], a[1] + r * hi.dir[1]]
            };
            // What a face there loses: past the curve, and out to either side.
            const out = (u, v) => {
                const n3 = [-u[1], u[0]];
                return dot2(n3, v) > 0 ? [-n3[0], -n3[1]] : n3;
            };
            const n1 = out(t.u1, t.u2),
                n2 = out(t.u2, t.u1),
                bl = Math.hypot(t.u1[0] + t.u2[0], t.u1[1] + t.u2[1]) || 1;
            const b = [-(t.u1[0] + t.u2[0]) / bl, -(t.u1[1] + t.u2[1]) / bl],
                Lx = 70,
                far = (p, d) => [p[0] + Lx * d[0], p[1] + Lx * d[1]];
            const mid = [0.25 * t.p1[0] + 0.5 * a[0] + 0.25 * t.p2[0], 0.25 * t.p1[1] + 0.5 * a[1] + 0.25 * t.p2[1]];
            const ring = [t.p1, mid, t.p2, far(t.p2, n2), far(a, b), far(t.p1, n1)];
            // (Wound against the clip's big square, so it cuts a hole in it.)
            t.notch = d => (area2(ring) > 0 ?
                d.poly([far(t.p1, n1), far(a, b), far(t.p2, n2), t.p2]).Q(a[0], a[1], t.p1[0], t.p1[1]).Z() :
                d.M(t.p1[0], t.p1[1]).Q(a[0], a[1], t.p2[0], t.p2[1]).L(...far(t.p2, n2)).L(...far(a, b)).L(...far(t.p1, n1)).Z());
            t.top = Math.max(...slots);
            tips.set(i, t);
            slots.forEach(sl => {
                if (!tipSlots.has(sl)) {
                    tipSlots.set(sl, []);
                }
                tipSlots.get(sl).push(t);
            });
        });
    }
    const reach = (i, x) => {
        const t = tips.get(i);
        return t ? (1 - creaseSk) * cutBack(t, x) : 0;
    };
    items.forEach((it, slot) => {
        const pale = Math.max(spotted !== null && spotted !== it.pc.face ? 1 : 0, fx.shadeDim || 0);
        const color = rgb(shadedColor(faceHue(it.pc.face, n), it.fl.lit, pale)),
            a = Number((shadeOn * smoothstep(0, 0.12, it.fl.nz)).toFixed(3));
        // A face at a star's point: clipped to leave out what is past it. (The fills are clipped one by one, not as a group, so that a star's creases, between them, are not: they end on the rounding themselves.)
        let clip = hullClip;
        if (S.PIECES) {
            const ts = tipSlots.get(slot);
            clip = null;
            if (ts) {
                // (Everything but the notches: as one path, or as the holes alone.)
                const d = path().M(-4000, -4000).L(4600, -4000).L(4600, 4600).L(-4000, 4600).Z(),
                    holes = path();
                ts.forEach(t => {
                    t.notch(d);
                    t.notch(holes);
                });
                clip = clipPath(d);
                clip.holes = holes;
            }
        }
        // (seam: closing the hairlines between pieces.)
        gShade.shape({
            path: path().poly(it.q.map(screen), true),
            fill: color,
            seam: 1.2,
            alpha: a,
            clip,
            convex: !S.PIECES
        });
        if (S.PIECES) {
            const d = path();
            it.pc.creases.forEach(([u, v], m) => {
                const [iu, iv] = it.pc.creaseEnds[m], A = screen(mvec(T, u)), B = screen(mvec(T, v));
                d.seg(...trim(A, B, iu >= 0 ? reach(iu, B) : 0, iv >= 0 ? reach(iv, A) : 0));
            });
            // The points' curves, each with the nearest face there.
            (tipSlots.get(slot) || []).forEach(t => {
                if (t.top === slot) {
                    d.M(t.p1[0], t.p1[1]).Q(t.a[0], t.a[1], t.p2[0], t.p2[1]);
                }
            });
            gShade.shape({
                path: d,
                stroke: ink,
                width: creaseW,
                alpha: a * creaseA
            });
        }
        if (dark) {
            gShade.shape({
                path: innerBands(it.q.map(screen), bandW, S.PIECES ? it.pc.creaseSides : null),
                fill: rgb(shadedEdge(faceHue(it.pc.face, n), it.fl.lit, pale)),
                alpha: a,
                clip
            });
        }
    });

    // Off the ink, every face is a colored loop: a Petrial's Petrie polygons (set apart, crossing over and under), or a star polyhedron's faces. What a click would turn about (fx.aim: { kind: 'f', 'v' or 'e', k }). A face under the pointer comes forward: bolder, and seen through the solid.
    const aimed = fx.aim || null;
    const aim = aimed && aimed.kind === 'f' ? aimed.k : null;
    if (looped) {
        const base = fx.loops === undefined ? 1 : fx.loops,
            vis = id => front[id];
        const spot = fx.spot === null || fx.spot === undefined ? null : fx.spot;
        // (While an operation draws its own loops, a star's are not drawn.)
        const own = fx.ownLoops === undefined ? 1 : fx.ownLoops;
        const pick = k => own * base * (spot === null || spot === k ? 1 : 0.07) * (k === aim ? 1 : 1 - shadeOn); // (a star drawn solid shows its faces, not their loops)
        const through = k => (spot === null ? (k === aim ? 0.6 : HIDDEN) : spot === k ? 0.85 : 0);
        const bold = k => (k === aim ? 1.6 : 1);
        const set = petrial ? S.LOOPS.petrie : S.LOOPS.faces,
            paint = loopPaint(set, {
                muted: fx.muted || 0
            });
        const drawn = drawLoops(gLanes, set, T, 1, INSET, vis, null, pick, bold, through, paint);
        if (petrial) {
            drawWeave(gLanes, set, S.LOOPS.cross, drawn, det3(T) < 0, paint);
        }
    }

    // A planar face under the pointer is also lightly filled: in the accent on a convex solid, in its own color on a star. (Each of these comes in over a moment: fx.aimFade.)
    const fade = fx.aimFade === undefined ? 1 : fx.aimFade;
    if (aim !== null && !petrial) {
        gFaces.shape({
            path: path().poly(S.FACES[aim].ids.map(i => Q[i]), true),
            fill: looped ? rgb(loopColor(aim, S.FACES.length)) : accent,
            alpha: (looped ? 0.16 : 0.12) * fade
        });
    }

    // An edge or vertex under the pointer gets a halo in the accent.
    if (aimed && aimed.kind === 'e') {
        const [i, j] = S.EDGES[aimed.k];
        gAimMarks.shape({
            path: path().seg(...segment(i, j)),
            stroke: accent,
            width: 2.5 * STROKE,
            alpha: 0.3 * fade
        });
    }
    if (aimed && aimed.kind === 'v') {
        gAimMarks.dot(Q[aimed.k][0], Q[aimed.k][1], 19, accent, 0.3 * fade);
    }

    // The flag shown: the base flag's image under fx.flagM (see centerFlag), as vertices (and a face) of the solid.
    const H = fx.flagM,
        nearestV = p => S.V.reduce((b, v, i) => (len(sub(v, p)) < len(sub(S.V[b], p)) ? i : b), 0);
    const mapV = i => (H ? nearestV(mvec(H, S.V[i])) : i);
    const mapF = k => (H ? S.FACES.reduce((b, f, j) => (dot(f.normal, mvec(H, S.FACES[k].normal)) > dot(S.FACES[b].normal, mvec(H, S.FACES[k].normal)) ? j : b), 0) : k);
    // Off the ink: the flag's half-edge, and a tick along the face's next edge.
    if (fx.flag && looped) {
        const fl0 = petrial ? S.petrialFlag : S.faceFlag,
            vertex = mapV(fl0.vertex),
            other = mapV(fl0.other),
            prev = mapV(fl0.prev);
        const q = Q[vertex],
            m = [(q[0] + Q[other][0]) / 2, (q[1] + Q[other][1]) / 2];
        const t = [q[0] + 0.28 * (Q[prev][0] - q[0]), q[1] + 0.28 * (Q[prev][1] - q[1])];
        gCorner.shape({
            path: path().poly([m, q, t]),
            stroke: accent,
            width: STROKE * 0.72,
            alpha: 0.35 + 0.6 * edgeFront(S.edgeIndex.get(`${vertex},${other}`))
        });
    }

    // The marked flag, drawn as its chamber: the triangle on the vertex, the edge's midpoint and the face's center. Faint when it is on the back.
    if (fx.flag && !looped) {
        const vertex = mapV(S.flag.vertex),
            other = mapV(S.flag.other),
            face = mapF(S.flag.face);
        const ids = S.FACES[face].ids;
        const mid = [(Q[vertex][0] + Q[other][0]) / 2, (Q[vertex][1] + Q[other][1]) / 2];
        const ctr = [ids.reduce((s, i) => s + Q[i][0], 0) / ids.length, ids.reduce((s, i) => s + Q[i][1], 0) / ids.length];
        gFlag.shape({
            path: path().poly([Q[vertex], mid, ctr], true),
            fill: accent,
            stroke: accent,
            width: 4,
            alpha: 0.28 + 0.62 * front[face],
            convex: true
        });
    }

    // Rotation axis: fixed by the move, so drawn with the view alone. Each end gets a pin where it leaves the surface.
    const showAxis = fx.axis && fx.axisAlpha > 0.001;
    if (showAxis) {
        const ends = fx.ends.map(({
            dir,
            r
        }) => ({
            s: mvec(fx.view, dir),
            r
        }));
        if (ends[0].s[2] < ends[1].s[2]) {
            ends.reverse();
        }
        const pins = ends.map(e => scale(e.s, e.r));
        [
            [gAxisNear, ends[0], 1],
            [gAxisFar, ends[1], 0.45]
        ].forEach(([g, e, depth], k) => {
            const pin = screen(pins[k]),
                tip = screen(scale(e.s, AXIS_REACH));
            g.shape({
                path: path().seg(pin, tip),
                stroke: accent,
                width: 6,
                alpha: fx.axisAlpha * depth
            });
            g.dot(pin[0], pin[1], 9, accent, fx.axisAlpha * depth);
        });
    }

    // Mirror plane: a disc perpendicular to the axis.
    if (fx.mirror && fx.mirrorAlpha > 0.001) {
        const n = fx.mirror;
        const u = unit(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]));
        const w = cross(n, u);
        const ring = [];
        for (let k = 0; k < 72; k++) {
            const t = (k / 72) * 2 * Math.PI;
            ring.push(mvec(fx.view, scale(add(scale(u, Math.cos(t)), scale(w, Math.sin(t))), MIRROR_RADIUS)));
        }
        gMirror.shape({
            path: path().poly(ring.map(screen), true),
            fill: accent,
            fillAlpha: 0.14,
            stroke: accent,
            width: 3,
            alpha: fx.mirrorAlpha,
            convex: true
        });
    }

    gMarks.dot(CENTER, CENTER, 14 * (fx.centerAlpha || 0), accent, fx.centerAlpha || 0);
};
