// Drawing the blended and the pure polyhedra.
// A blend is seen through the same window, from a camera tilted over its plane (BLEND_CAM), its heights scaled by zeta: at zeta 0, seen from straight above, it is drawn exactly as the tiling it comes from. Depth shows as tone: what is near is darker and lies on a band of paper over what is behind, in DEPTHS layers drawn far to near.

import {
    add,
    clamp,
    cross,
    dot,
    mmul,
    mvec,
    qaxis,
    qmat,
    qmul,
    qnorm,
    scale,
    smoothstep,
    sub,
    unit,
} from './math.js';
import {
    applyAffine,
    TILE_HUES,
    unapply
} from './planar.js';
import {
    CASING,
    CENTER,
    darkTheme,
    faceHue,
    innerBands,
    LIGHT,
    LOOP_W,
    ROPE,
    SCALE,
    screen,
    shadedColor,
    shadedEdge,
    STRAND_GAP,
    strandScreen,
    STROKE
} from './look.js';
import {
    arrowPath,
    clipLine,
    clipToWindow,
    insideWindow,
    T_STROKE,
    WIN_DIAG,
    WIN_H,
    WIN_R,
    WINDOW
} from './draw-planar.js';
import {
    mixRgb,
    OP_C,
    OP_L,
    OP_M,
    path,
    rgb
} from './dl.js';

const BLEND_CAM = {
    tilt: 0.66,
    azim: 0.32
};
const DEPTHS = 5;
// The view a blend starts from: turned a little about the upright, and tipped toward you; dragging turns it from there, as with a solid.
export const BLEND_VIEW = qnorm(qmul(qaxis([1, 0, 0], -BLEND_CAM.tilt), qaxis([0, 0, 1], BLEND_CAM.azim)));

// cam: { view (a quaternion), zeta }; also the ball the blend is cut to, reaching just past the window's corners, so turning it never shows where the patch ends.
export const blendPose = (M, zoom, pan, cam) => {
    const Vc = qmat(cam.view);
    const W = mmul(Vc, [1, 0, 0, 0, 1, 0, 0, 0, cam.zeta]).map(x => x * zoom);
    const pan3 = [pan[0], pan[1], 0],
        A = mmul(W, M.L),
        b = mvec(W, sub(M.t, pan3));
    return {
        M,
        zoom,
        pan,
        cam,
        A,
        b,
        Vc,
        map: p => add(mvec(A, p), b),
        world: x => mvec(W, sub(x, pan3)),
        pre: unapply(M, pan3),
        flipped: M.L[0] * M.L[4] - M.L[1] * M.L[3] < 0,
        // The ball: past the window's corners; for a line's blend, which goes on in depth, just inside its sides once its heights have grown.
        ball: (cam.line ? WIN_DIAG + 8 + (WIN_H + 4 - WIN_DIAG - 8) * cam.zeta : WIN_DIAG + 8) / (SCALE * zoom),
        reach: (WIN_DIAG + 8) / (SCALE * zoom),
    };
};

// The loops: a Petrial's faces, its Petrie polygons, crossing over and under at the edges; or the blend's own faces, skew, which never cross. Their colors, each drawn as one path in each layer. A pure polyhedron with planar faces (the Petrie–Coxeter polyhedra) has its faces filled.
export const buildBlendScene = (S, form, patch) => {
    const petrial = form === 'petrial',
        loops = petrial ? patch.LOOPS.petrie : patch.LOOPS.faces;
    return {
        form,
        patch,
        loops,
        colors: [...new Set(loops.map(l => l.color))],
        filled: !petrial && Boolean(S.flatFaces)
    };
};

// Every point of a blend's patch as seen, worked out once a frame and shared by the drawing and the pointer: W, where it is from the middle (heights as drawn), for the ball; Vv, where it is in the view.
// (spread: how far apart the two loops along an edge are, as a share of their spacing: an operation closes a face's loop onto its edges.)
export const blendProject = (scene, pose, spread = 1) => {
    const key = [...pose.A, ...pose.b, pose.ball, pose.cam.zeta, ...pose.M.L, ...pose.M.t, ...pose.pan, spread, pose.ink || 1].map(x => x.toFixed(5)).join();
    if (scene.proj && scene.proj.key === key) {
        return scene.proj;
    }
    const L = pose.M.L,
        t = pose.M.t,
        A = pose.A,
        b = pose.b,
        z = pose.cam.zeta,
        px = pose.pan[0],
        py = pose.pan[1];
    // Points i0 to i1 of src, as seen, into Wd and Vd.
    const into = (src, Wd, Vd, i0, i1) => {
        for (let i = 3 * i0; i <= 3 * i1; i += 3) {
            const x = src[i],
                y = src[i + 1],
                w = src[i + 2];
            Wd[i] = L[0] * x + L[1] * y + L[2] * w + t[0] - px;
            Wd[i + 1] = L[3] * x + L[4] * y + L[5] * w + t[1] - py;
            Wd[i + 2] = (L[6] * x + L[7] * y + L[8] * w + t[2]) * z;
            Vd[i] = A[0] * x + A[1] * y + A[2] * w + b[0];
            Vd[i + 1] = A[3] * x + A[4] * y + A[5] * w + b[1];
            Vd[i + 2] = A[6] * x + A[7] * y + A[8] * w + b[2];
        }
    };
    const verts = {
        W: new Float64Array(scene.patch.flat3.length),
        Vv: new Float64Array(scene.patch.flat3.length)
    };
    into(scene.patch.flat3, verts.W, verts.Vv, 0, scene.patch.flat3.length / 3 - 1);
    // The loops, into buffers kept with the scene: only the chunks whose balls reach the ball shown (vis), the rest left as they were. (Seen, heights only shrink, so a chunk's ball stays round it.)
    if (!scene.bufs) {
        scene.bufs = scene.loops.map(l => ({
            W: new Float64Array(l.pos3.length),
            Vv: new Float64Array(l.pos3.length),
            cW: new Float64Array(l.ctl3.length),
            cV: new Float64Array(l.ctl3.length),
            vis: new Uint8Array(l.chunks.length / 4)
        }));
    }
    const ball = pose.ball;
    // (A loop with a strand, as all are, is laid out on the screen from where its vertices are seen: see strandScreen. Its loops' spacing is as wide as the finite polyhedra's, for its strands' width.)
    const VW = verts.W,
        VV = verts.Vv,
        zm = pose.zoom || 1,
        h = (spread * (LOOP_W * 0.8 + STRAND_GAP) * (pose.ink || 1)) / 2;
    const strands = scene.loops.map((l, k) => {
        const B = scene.bufs[k],
            Ch = l.chunks,
            per = l.per,
            n = l.pos3.length / 3,
            hasCtl = l.ctl3.length > 0;
        let any = false;
        for (let c = 0; c < B.vis.length; c++) {
            const x = Ch[4 * c],
                y = Ch[4 * c + 1],
                w = Ch[4 * c + 2],
                r = Ch[4 * c + 3];
            const wx = L[0] * x + L[1] * y + L[2] * w + t[0] - px,
                wy = L[3] * x + L[4] * y + L[5] * w + t[1] - py,
                wz = (L[6] * x + L[7] * y + L[8] * w + t[2]) * z;
            if (wx * wx + wy * wy + wz * wz > (ball + r) * (ball + r)) {
                B.vis[c] = 0;
                continue;
            }
            B.vis[c] = 1;
            any = true;
            if (!l.strand) {
                into(l.pos3, B.W, B.Vv, per * c, Math.min(n - 1, per * c + per));
                if (hasCtl) {
                    into(l.ctl3, B.cW, B.cV, 2 * c, 2 * c + 1);
                }
            }
        }
        if (any && l.strand) {
            layStrand(l.strand, B, VW, VV, A, zm, h);
        }
        return B;
    });
    // The depths seen, for the layers.
    const r2 = pose.ball * pose.ball;
    let dmin = Infinity,
        dmax = -Infinity;
    for (let i = 0; i < verts.W.length; i += 3) {
        if (verts.W[i] ** 2 + verts.W[i + 1] ** 2 + verts.W[i + 2] ** 2 > r2) {
            continue;
        }
        dmin = Math.min(dmin, verts.Vv[i + 2]);
        dmax = Math.max(dmax, verts.Vv[i + 2]);
    }
    scene.proj = {
        key,
        verts,
        strands,
        dmin,
        dmax
    };
    return scene.proj;
};
// A blend's (or a pure polyhedron's) loop, laid out on the screen (see strandScreen) from where its vertices are seen (VW from the middle, VV in the view): into its buffers B, each node where the strand puts it, at the depth (and, for the ball, the place) of the point of the polygon it is beside; each crossing's control points likewise. A: the view's linear map, zm its scale.
const scratch = {
    a: new Float64Array(0),
    c: new Float64Array(0)
};
const layStrand = (st, B, VW, VV, A, zm, h) => {
    const nv = st.ids.length,
        ids = st.ids,
        sd = st.sides,
        n = st.A.length;
    if (scratch.a.length < 2 * n + 2) {
        scratch.a = new Float64Array(2 * n + 64);
    }
    if (scratch.c.length < B.cV.length) {
        scratch.c = new Float64Array(B.cV.length + 64);
    }
    const out = scratch.a,
        ctl = B.cV.length ? scratch.c : null;
    const Q = (i, o2, o) => {
        const v = 3 * ids[i];
        o2[o] = SCALE * VV[v];
        o2[o + 1] = SCALE * VV[v + 1];
    };
    const side = (i, nx, ny) => {
        const f = 6 * i,
            F = [sd[f], sd[f + 1], sd[f + 2]],
            G = [sd[f + 3], sd[f + 4], sd[f + 5]];
        const p = mvec(A, F),
            q = mvec(A, G);
        return [(nx * p[0] + ny * p[1]) / zm, (nx * q[0] + ny * q[1]) / zm, (p[2] - q[2]) / zm];
    };
    strandScreen(out, nv, st.closed, Q, side, i => st.lam[i], h, st.rope, st.again, ctl);
    const W = B.W,
        V = B.Vv,
        SA = st.A,
        SB = st.B,
        ST = st.T;
    for (let i = 0; i < n; i++) {
        const a = 3 * SA[i],
            b = 3 * SB[i],
            u = ST[i],
            j = 3 * i;
        W[j] = VW[a] + u * (VW[b] - VW[a]);
        W[j + 1] = VW[a + 1] + u * (VW[b + 1] - VW[a + 1]);
        W[j + 2] = VW[a + 2] + u * (VW[b + 2] - VW[a + 2]);
        V[j] = out[2 * i] / SCALE;
        V[j + 1] = out[2 * i + 1] / SCALE;
        V[j + 2] = VV[a + 2] + u * (VV[b + 2] - VV[a + 2]);
    }
    if (ctl) {
        // (Two to a crossing, a third of the way in from its ends.)
        const per = 2 * ROPE + 2,
            m = B.cV.length / 6,
            CW = B.cW,
            CV = B.cV;
        for (let r = 0; r < m; r++) {
            const j = 1 + r * per + ROPE,
                a = 3 * SA[j],
                b = 3 * SB[j],
                lj = (ST[j + ROPE] - ST[j]);
            for (let e = 0; e < 2; e++) {
                const u = 0.5 + (e ? 1 : -1) * lj / 3,
                    o = 6 * r + 3 * e;
                CW[o] = VW[a] + u * (VW[b] - VW[a]);
                CW[o + 1] = VW[a + 1] + u * (VW[b + 1] - VW[a + 1]);
                CW[o + 2] = VW[a + 2] + u * (VW[b + 2] - VW[a + 2]);
                CV[o] = ctl[4 * r + 2 * e] / SCALE;
                CV[o + 1] = ctl[4 * r + 2 * e + 1] / SCALE;
                CV[o + 2] = VV[a + 2] + u * (VV[b + 2] - VV[a + 2]);
            }
        }
    }
};

// The segment between points i and j of a projected set, cut to the ball and the window: its ends on screen and its depth, or null.
const blendSeg = (set, i, j, r2, inset) => {
    const W = set.W,
        V = set.Vv,
        a = 3 * i,
        c = 3 * j;
    const ax = W[a],
        ay = W[a + 1],
        az = W[a + 2],
        dx = W[c] - ax,
        dy = W[c + 1] - ay,
        dz = W[c + 2] - az;
    const A2 = dx * dx + dy * dy + dz * dz,
        B2 = 2 * (ax * dx + ay * dy + az * dz),
        C2 = ax * ax + ay * ay + az * az - r2;
    let t0 = 0,
        t1 = 1;
    if (A2 < 1e-12) {
        if (C2 > 0) {
            return null;
        }
    } else {
        const disc = B2 * B2 - 4 * A2 * C2;
        if (disc <= 0) {
            return null;
        }
        const sq = Math.sqrt(disc);
        t0 = Math.max(0, (-B2 - sq) / (2 * A2));
        t1 = Math.min(1, (-B2 + sq) / (2 * A2));
        if (t0 >= t1) {
            return null;
        }
    }
    const vx = V[a],
        vy = V[a + 1],
        ex = V[c] - vx,
        ey = V[c + 1] - vy;
    const cl = clipToWindow([CENTER + SCALE * (vx + t0 * ex), CENTER - SCALE * (vy + t0 * ey)], [CENTER + SCALE * (vx + t1 * ex), CENTER - SCALE * (vy + t1 * ey)], inset);
    return cl ? {
        c: cl,
        depth: V[a + 2] + ((t0 + t1) / 2) * (V[c + 2] - V[a + 2])
    } : null;
};

// The planar faces of a Petrie–Coxeter polyhedron, those wholly in the ball: opaque, far to near, each lit by its plane's tilt to the light and paler the farther back it is; each outlined (in ink, or in the dark in its own deeper color), so nearer faces cover the edges of farther ones.
const drawFills = (g, scene, pose, proj, fx, alpha, r2, ik) => {
    const faces = scene.patch.LOOPS.faces,
        W = proj.verts.W,
        V = proj.verts.Vv,
        A = pose.A,
        items = [];
    const dark = darkTheme(),
        spot = fx.spot === undefined || fx.spot === null ? null : fx.spot;
    if (alpha > 0.002) {
        for (const l of faces) {
            if (!l.closed || !l.normal) {
                continue;
            }
            // (Those whose middles are in the ball; the window cuts the rest.)
            let cx = 0,
                cy = 0,
                cz = 0,
                z = 0;
            for (const i of l.ids) {
                cx += W[3 * i];
                cy += W[3 * i + 1];
                cz += W[3 * i + 2];
                z += V[3 * i + 2];
            }
            const m = l.ids.length;
            // (Well enough inside, by its size, that the chunk keeps to its ball.)
            let rad = 0;
            for (const i of l.ids) {
                rad = Math.max(rad, Math.hypot(W[3 * i] - cx / m, W[3 * i + 1] - cy / m, W[3 * i + 2] - cz / m));
            }
            if (Math.hypot(cx / m, cy / m, cz / m) + 0.45 * rad > Math.sqrt(r2)) {
                continue;
            }
            const nv = unit(mvec(A, l.normal)),
                side = nv[2] < 0 ? -1 : 1;
            items.push({
                l,
                z: z / l.ids.length,
                lit: side * dot(nv, LIGHT)
            });
        }
        items.sort((a, b) => a.z - b.z);
    }
    const lo = items.length ? items[0].z : 0,
        hi = items.length ? items[items.length - 1].z : 1,
        ink = rgb('ink');
    // (Outlined as the finite polyhedra are: in ink as wide as theirs, a little finer the farther back; in the dark, as their faces are, by a band just inside each face in its own deeper color. Like theirs, it thins to a skeleton while an operation draws new faces over them.)
    const sk = fx.skeleton || 0,
        a = Number(alpha.toFixed(3));
    items.forEach(it => {
        const far = 1 - (it.z - lo) / (hi - lo || 1),
            pale = Math.max(0.55 * far * far, spot !== null && it.l.key !== spot ? 1 : 0, fx.shadeDim || 0);
        const hue = faceHue(it.l.hue, TILE_HUES),
            w = STROKE * ik * (1 - 0.7 * sk) * (1 - 0.25 * far);
        const q = it.l.ids.map(i => screen([V[3 * i], V[3 * i + 1]]));
        if (dark) {
            g.shape({
                path: path().poly(q, true),
                fill: rgb(shadedColor(hue, it.lit, pale)),
                alpha: a,
                convex: true
            });
            g.shape({
                path: innerBands(q, w / 2),
                fill: rgb(shadedEdge(hue, it.lit, pale)),
                alpha: Number((a * (1 - (fx.shadeDim || 0))).toFixed(3))
            });
            return;
        }
        g.shape({
            path: path().poly(q, true),
            fill: rgb(shadedColor(hue, it.lit, pale)),
            stroke: ink,
            width: w,
            strokeAlpha: Number(((0.35 + 0.65 * (1 - far)) * (1 - 0.55 * sk) * (1 - (fx.edgesOff || 0))).toFixed(3)),
            alpha: a,
            convex: true,
        });
    });
};

export const drawBlend = (dl, scene, S, pose, fx) => {
    const patch = scene.patch,
        petrial = scene.form === 'petrial',
        r2 = pose.ball * pose.ball,
        ik = pose.ink || 1;
    const inkC = rgb('ink'),
        accent = rgb('accent'),
        paper = rgb('paper');
    // In paint order: a move's plane; a halo on what is under the pointer (in the window); the ink, layer by layer; the filled faces; the loops; the flag; a move's axis and arrow.
    const gOver = dl.group(),
        gAimMarks = dl.group({
            clip: WINDOW
        }),
        gEdges = dl.group(),
        gFills = scene.filled ? dl.group({
            clip: WINDOW
        }) : null;
    const gLanes = dl.group(),
        gCorner = dl.group({
            clip: WINDOW
        }),
        gTop = dl.group();
    const sk = fx.skeleton === undefined ? (petrial ? 1 : 0) : fx.skeleton;
    const bare = fx.bare === undefined ? (petrial ? 1 : 0) : fx.bare;
    const ink = fx.ink === undefined ? 1 : fx.ink;
    const proj = blendProject(scene, pose, fx.spread === undefined ? 1 : fx.spread),
        {
            dmin,
            dmax
        } = proj;
    const bandOf = d => clamp(Math.floor((DEPTHS * (d - dmin)) / (dmax - dmin || 1)), 0, DEPTHS - 1);
    const mid = (c, f) => [c[0][0] + f * (c[1][0] - c[0][0]), c[0][1] + f * (c[1][1] - c[0][1])];
    // Far is lighter and finer; but only as there comes to be a far (when a blend first rises out of its tiling, all is at one depth).
    const deep = smoothstep(0.02, 0.25, dmax - dmin);
    const tone = b => 1 - deep * 0.58 * (1 - b / (DEPTHS - 1)),
        weight = b => 1 - deep * 0.22 * (1 - b / (DEPTHS - 1));

    // On the blend itself its faces are loops too (cycles: 1); going to or from its tiling (cycles toward 0) they give way to the edges in ink.
    const cyc = petrial ? 1 : fx.cycles === undefined ? 1 : fx.cycles;
    const inkAlpha = Number((ink * (1 - 0.55 * sk) * (1 - bare) * (petrial ? 1 : 1 - cyc)).toFixed(3));
    gEdges.alpha = inkAlpha;
    if (!petrial && inkAlpha > 0.002) {
        const d = [],
            cd = [],
            width = T_STROKE * (1 - 0.7 * sk) * ik;
        for (let b = 0; b < DEPTHS; b++) {
            d.push(path());
            cd.push(path());
        }
        for (const [i, j] of patch.EDGES) {
            const r = blendSeg(proj.verts, i, j, r2, width / 2);
            if (!r) {
                continue;
            }
            const b = bandOf(r.depth);
            d[b].seg(r.c[0], r.c[1]);
            cd[b].seg(mid(r.c, 0.16), mid(r.c, 0.84));
        }
        for (let b = 0; b < DEPTHS; b++) {
            gEdges.shape({
                path: cd[b],
                stroke: paper,
                width: width * weight(b) + (2 * CASING + 1) * ik,
                cap: 'butt'
            });
            gEdges.shape({
                path: d[b],
                stroke: inkC,
                width: width * weight(b),
                alpha: Number(tone(b).toFixed(3))
            });
        }
    }

    // The loops, layer by layer: a Petrial's strands, where two crossing on an edge, the one turning left at its far end (seen from above) goes over; or the blend's faces.
    const aimed = fx.aim || null,
        aimF = aimed && aimed.kind === 'f' ? aimed.k : null;
    // (A Petrie–Coxeter polyhedron's faces are filled, not loops, but for an operation drawing them in.)
    const filled = scene.filled && !fx.trace;
    if (filled) {
        drawFills(gFills, scene, pose, proj, fx, ink * (1 - (fx.bare || 0)), r2, ik);
    }
    const loops = scene.loops,
        base = filled ? 0 : petrial ? (fx.loops === undefined ? 1 : fx.loops) : ink * cyc;
    if (base > 0.002) {
        const spot = fx.spot === undefined || fx.spot === null ? null : fx.spot;
        if (!scene.overSegs || scene.overSegs.flipped !== pose.flipped) {
            const sets = loops.map(() => new Set());
            (petrial ? patch.LOOPS.cross : []).forEach(([A, B]) => {
                const up = A.left !== pose.flipped ? A : B;
                for (let m = -ROPE; m < ROPE; m++) {
                    sets[up.loop].add(up.j + m);
                }
            });
            scene.overSegs = {
                flipped: pose.flipped,
                sets
            };
        }
        const overSegs = scene.overSegs.sets;
        const slot = new Map(scene.colors.map((c, i) => [c, i]));
        const D = Array.from({
            length: DEPTHS
        }, () => ({
            s: scene.colors.map(() => path()),
            o: scene.colors.map(() => path()),
            c: path(),
            oc: path()
        }));
        const faint = scene.colors.map(() => path()),
            inset = LOOP_W * 0.8 * ik;
        // Each strand goes down as runs: stretches in one layer (and over or under), its points well inside the ball and the window taken as they are, and only the pieces at an edge of either cut to it. A crossing well inside goes down as its one cubic. A run's band of paper runs along its inside, so the joins between runs show none.
        const safe = WIN_H - WIN_R - inset,
            per = 2 * ROPE + 2;
        const sx = x => CENTER + SCALE * x,
            sy = y => CENTER - SCALE * y;
        // (Appending the numbers of one path to another's.)
        const into = (to, a, i0 = 0, i1 = a.length) => {
            const t = to.a;
            for (let i = i0; i < i1; i++) {
                t.push(a[i]);
            }
        };
        // fx.trace: how far along each loop its pen has come (an operation drawing them in), or nothing, all of each.
        const trace = fx.trace || null,
            tmp = {
                W: new Float64Array(6),
                Vv: new Float64Array(6)
            };
        loops.forEach((l, k) => {
            const lim = trace ? trace[k] : Infinity,
                arc = l.arc;
            if (lim <= 0) {
                return;
            }
            const ci = slot.get(l.color),
                dim = spot !== null && l.key !== spot,
                set = proj.strands[k];
            const W = set.W,
                V = set.Vv,
                CW = set.cW,
                CV = set.cV,
                n = W.length / 3,
                ov = overSegs[k],
                vis = set.vis,
                lper = l.per;
            // run: its path so far (d, as numbers), how many pieces, where the first ends, and where in d the second piece starts and the last one.
            let run = null;
            const flush = () => {
                if (!run) {
                    return;
                }
                if (dim) {
                    into(faint[ci], run.d);
                } else {
                    const L = D[run.band];
                    if (run.over) {
                        into(L.o[ci], run.d);
                        into(L.oc, run.d);
                    } else {
                        into(L.s[ci], run.d);
                        if (run.n >= 3) {
                            L.c.M(run.firstEnd[0], run.firstEnd[1]);
                            into(L.c, run.d, run.second, run.last);
                        }
                    }
                }
                run = null;
            };
            // A piece from screen point (x, y), unless the run goes on from there: a line to (ex, ey), or (with control points) a cubic.
            const put = (band, over, x, y, ex, ey, c1x, c1y, c2x, c2y) => {
                if (!run || run.band !== band || run.over !== over) {
                    flush();
                    run = {
                        band,
                        over,
                        d: [OP_M, x, y],
                        n: 0,
                        firstEnd: null,
                        second: 0,
                        last: 0
                    };
                }
                run.last = run.d.length;
                if (c1x === undefined) {
                    run.d.push(OP_L, ex, ey);
                } else {
                    run.d.push(OP_C, c1x, c1y, c2x, c2y, ex, ey);
                }
                if (++run.n === 1) {
                    run.firstEnd = [ex, ey];
                    run.second = run.d.length;
                }
            };
            const ok = (A, B, i) => A[i] ** 2 + A[i + 1] ** 2 + A[i + 2] ** 2 <= r2 && Math.abs(B[i] * SCALE) < safe && Math.abs(B[i + 1] * SCALE) < safe;
            for (let j = 0; j + 1 < n; j++) {
                if (arc[j] >= lim) {
                    break;
                }
                if (j % lper === 0 && !vis[j / lper]) {
                    flush();
                    j += lper - 1;
                    continue;
                }
                if (petrial && j % per === 1) {
                    // A crossing well inside goes down as its one cubic; with the pen partway along it (an operation drawing it in), the cubic so far.
                    const c = 6 * ((j - 1) / per),
                        e = j + 2 * ROPE;
                    if (ok(W, V, 3 * j) && ok(W, V, 3 * e) && ok(CW, CV, c) && ok(CW, CV, c + 3)) {
                        const band = dim ? 0 : bandOf(V[3 * (j + ROPE) + 2]),
                            over = !dim && ov.has(j);
                        const x0 = sx(V[3 * j]),
                            y0 = sy(V[3 * j + 1]);
                        if (arc[e] <= lim) {
                            put(band, over, x0, y0, sx(V[3 * e]), sy(V[3 * e + 1]), sx(CV[c]), sy(CV[c + 1]), sx(CV[c + 3]), sy(CV[c + 4]));
                            j = e - 1;
                            continue;
                        }
                        const u = clamp((lim - arc[j]) / (arc[e] - arc[j] || 1), 0, 1),
                            lerp = (a, b) => [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])];
                        const P0 = [V[3 * j], V[3 * j + 1]],
                            P1 = [CV[c], CV[c + 1]],
                            P2 = [CV[c + 3], CV[c + 4]],
                            P3 = [V[3 * e], V[3 * e + 1]];
                        const A1 = lerp(P0, P1),
                            B1 = lerp(P1, P2),
                            C1 = lerp(P2, P3),
                            A2 = lerp(A1, B1),
                            B2 = lerp(B1, C1),
                            A3 = lerp(A2, B2);
                        put(band, over, x0, y0, sx(A3[0]), sy(A3[1]), sx(A1[0]), sy(A1[1]), sx(A2[0]), sy(A2[1]));
                        break;
                    }
                }
                if (arc[j + 1] > lim) {
                    // Where the pen is: the segment so far.
                    const f = (lim - arc[j]) / (arc[j + 1] - arc[j] || 1);
                    for (let a = 0; a < 3; a++) {
                        tmp.W[a] = W[3 * j + a];
                        tmp.Vv[a] = V[3 * j + a];
                        tmp.W[3 + a] = W[3 * j + a] + f * (W[3 * j + 3 + a] - W[3 * j + a]);
                        tmp.Vv[3 + a] = V[3 * j + a] + f * (V[3 * j + 3 + a] - V[3 * j + a]);
                    }
                    const r = blendSeg(tmp, 0, 1, r2, inset);
                    if (r) {
                        put(dim ? 0 : bandOf(r.depth), !dim && ov.has(j), r.c[0][0], r.c[0][1], r.c[1][0], r.c[1][1]);
                    }
                    break;
                }
                if (ok(W, V, 3 * j) && ok(W, V, 3 * j + 3)) {
                    put(dim ? 0 : bandOf((V[3 * j + 2] + V[3 * j + 5]) / 2), !dim && ov.has(j), sx(V[3 * j]), sy(V[3 * j + 1]), sx(V[3 * j + 3]), sy(V[3 * j + 4]));
                    continue;
                }
                const r = blendSeg(set, j, j + 1, r2, inset);
                flush();
                if (!r) {
                    continue;
                }
                put(dim ? 0 : bandOf(r.depth), !dim && ov.has(j), r.c[0][0], r.c[0][1], r.c[1][0], r.c[1][1]);
                flush();
            }
            flush();
        });
        // The faint strands first (far under everything), then each layer: its bands of paper, its strands, and on a Petrial the stretches on top over their own bands. (Each path is one stroke, painted once.)
        // (plain: all in ink, as an operation shows the old faces.)
        const m = fx.muted || 0,
            colorsNow = scene.colors.map(c => (fx.plain ? inkC : m > 0 ? mixRgb(c, 'muted', m) : rgb(c))),
            bw = LOOP_W * 0.8 * ik;
        for (let i = faint.length - 1; i >= 0; i--) {
            gLanes.shape({
                path: faint[i],
                stroke: colorsNow[i],
                width: bw,
                alpha: Number((0.07 * base).toFixed(3))
            });
        }
        D.forEach((L, b) => {
            const w = LOOP_W * weight(b) * ik,
                sa = Number((base * tone(b)).toFixed(3)),
                ca = Number(base.toFixed(3));
            gLanes.shape({
                path: L.c,
                stroke: paper,
                width: w + 2 * CASING * ik,
                cap: 'butt',
                alpha: ca
            });
            L.s.forEach((d, i) => gLanes.shape({
                path: d,
                stroke: colorsNow[i],
                width: w,
                alpha: sa
            }));
            if (petrial) {
                gLanes.shape({
                    path: L.oc,
                    stroke: paper,
                    width: w + 2 * CASING * ik,
                    cap: 'butt',
                    alpha: ca
                });
                L.o.forEach((d, i) => gLanes.shape({
                    path: d,
                    stroke: colorsNow[i],
                    width: w,
                    alpha: sa
                }));
            }
        });
    }

    // The flag: its half-edge, and a tick along the face's next edge.
    if (fx.flag) {
        const fm = p => screen(pose.map(fx.flagM ? applyAffine(fx.flagM, p) : p));
        const q = fm(S.u0),
            m = fm(scale(add(S.u0, S.u1), 0.5)),
            t = fm(add(S.u0, scale(sub(S.uPrev, S.u0), 0.28)));
        gCorner.shape({
            path: path().poly([m, q, t]),
            stroke: accent,
            width: STROKE * 0.72,
            alpha: 0.95
        });
    }

    // What the pointer is on.
    const P = aimed ? patch.V.map(p => screen(pose.map(p))) : null,
        fade = fx.aimFade === undefined ? 1 : fx.aimFade;
    if (aimed && aimed.kind === 'e') {
        const [i, j] = patch.EDGES[aimed.k];
        gAimMarks.shape({
            path: path().seg(P[i], P[j]),
            stroke: accent,
            width: 2.5 * STROKE,
            alpha: 0.3 * fade
        });
    }
    if (aimed && aimed.kind === 'v') {
        gAimMarks.dot(P[aimed.k][0], P[aimed.k][1], 17, accent, 0.3 * fade);
    }
    if (aimF !== null) {
        let d;
        if (!petrial) {
            const f = patch.FACES[aimF];
            d = path().poly(f.ids.map(i => P[i]), f.closed);
        } else {
            d = path().poly(patch.LOOPS.petrie[aimF].nodes.map(nd => screen(pose.map(add(nd.base, scale(nd.off, S.inset))))));
        }
        gAimMarks.shape({
            path: d,
            stroke: accent,
            width: 6,
            alpha: 0.75 * fade
        });
    }

    // A move's overlays, fixed in the world: an axis, a plane, a slide.
    const a = fx.axisAlpha || 0,
        w = x => screen(pose.world(x)),
        reach = (3 * WIN_DIAG) / (SCALE * pose.zoom);
    if (fx.plane3 && a > 0.001) {
        const {
            p,
            n
        } = fx.plane3, e1 = unit(Math.abs(n[2]) > 0.9 ? [1, 0, 0] : cross(n, [0, 0, 1])), e2 = cross(n, e1), r = reach / 3;
        gOver.shape({
            path: path().poly([
                [-1, -1],
                [1, -1],
                [1, 1],
                [-1, 1]
            ].map(([x, y]) => w(add(p, add(scale(e1, x * r), scale(e2, y * r))))), true),
            fill: accent,
            fillAlpha: 0.12,
            stroke: accent,
            width: 3,
            alpha: a,
            convex: true
        });
    }
    if (fx.axis3 && a > 0.001) {
        const {
            p,
            u
        } = fx.axis3, d = clipLine(w(sub(p, scale(u, reach))), w(add(p, scale(u, reach))));
        if (d) {
            gTop.shape({
                path: d,
                stroke: accent,
                width: 6,
                alpha: 0.9 * a
            });
        }
    }
    if (fx.slide3 && a > 0.001) {
        const p0 = [pose.pan[0], pose.pan[1], 0];
        gTop.shape({
            path: arrowPath(w(sub(p0, scale(fx.slide3, 0.5))), w(add(p0, scale(fx.slide3, 0.5)))),
            stroke: accent,
            width: 6,
            alpha: a
        });
    }
    if (fx.axis3 && a > 0.001) {
        const q = w(fx.axis3.p);
        if (insideWindow(q)) {
            gTop.dot(q[0], q[1], 9, accent, a);
        }
    }
};

// A planar move: a turn about a point of the plane (about the axis through it, square to the plane), a slide, or a flip about a mirror line (a half-turn in space), sliding along it for a glide reflection.
export const planarOverlay = (Gr, h) => {
    const g = Gr.G[h];
    if (g.kind === 'rot') {
        return {
            pin: g.center
        };
    }
    if (g.kind === 'trans') {
        return {
            slide: g.t
        };
    }
    if (g.kind === 'refl') {
        return {
            line: {
                p: g.p,
                u: g.u
            }
        };
    }
    if (g.kind === 'glide') {
        return {
            line: {
                p: g.p,
                u: g.u
            },
            glide: g.glide
        };
    }
    return {};
};
