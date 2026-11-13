// Moves: how a symmetry is shown while it plays.

import {
    DEG,
    EPS,
    I3,
    len,
    mmul,
    rotation,
    scale,
    stretch
} from './math.js';
import {
    affine,
    compose,
    ID_AFFINE,
    turnAbout3
} from './planar.js';
import {
    spatialMotion
} from './pure.js';
import {
    planarOverlay
} from './draw-blend.js';

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// What to draw for the move h: its axis (with where it leaves the solid), its mirror, or the center.
export const overlayFor = (S, Gr, h) => {
    if (Gr.spatial) {
        return spatialMotion(Gr, h).overlay;
    }
    if (Gr.planar) {
        return planarOverlay(Gr, h);
    }
    const g = Gr.G[h];
    if (h === 0) {
        return {};
    }
    if (g.inversion) {
        return {
            center: true
        };
    }
    const ends = [g.axis, scale(g.axis, -1)].map(dir => ({
        dir,
        r: S.surface(dir)
    }));
    if (g.proper) {
        return {
            axis: g.axis,
            ends
        };
    }
    return {
        mirror: g.axis,
        axis: Math.abs(g.angle) < EPS ? null : g.axis,
        ends
    };
};

// A move animates the identity into the group element h. Rotations turn about their axis. Orientation-reversing elements also pass the solid through the plane perpendicular to the axis, scaling it by cos(πe) along the axis: the shadow of a half-turn through a fourth dimension. A planar move (see planarOverlay) gives affine maps: a turn about a point of the plane, a slide, or a flip about a mirror line, sliding along it for a glide reflection; a blend's or a pure polyhedron's, the motions of space (see spatialMotion).
export const buildMove = (S, Gr, h, now) => {
    const g = Gr.G[h];
    let at, dur, overlay = null;
    if (Gr.spatial) {
        const m = spatialMotion(Gr, h);
        at = m.at;
        overlay = m.overlay;
        dur = m.kind === 'id' ? 700 : m.kind === 'trans' ? 640 + 300 * len(g.t) : 760 + 2.4 * Math.abs(m.angle) * DEG + (g.proper ? 0 : 260);
    } else if (Gr.planar) {
        at = () => ID_AFFINE;
        dur = 700;
        if (g.kind === 'rot') {
            at = e => turnAbout3(g.center, [0, 0, 1], g.angle * e);
            dur = 620 + 2.6 * Math.abs(g.angle) * DEG;
        } else if (g.kind === 'trans') {
            at = e => affine(I3, scale(g.t, e));
            dur = 640 + 300 * len(g.t);
        } else if (g.kind !== 'id') {
            at = e => compose(affine(I3, scale(g.u, g.glide * e)), turnAbout3(g.p, g.u, Math.PI * e));
            dur = 1000 + 300 * Math.abs(g.glide);
        }
    } else if (g.proper) {
        at = e => rotation(g.axis, g.angle * e);
        dur = 620 + 2.6 * Math.abs(g.angle) * DEG;
    } else if (g.inversion) {
        at = e => {
            const c = Math.cos(Math.PI * e);
            return [c, 0, 0, 0, c, 0, 0, 0, c];
        };
        dur = 950;
    } else {
        at = e => mmul(rotation(g.axis, g.angle * e), stretch(g.axis, Math.cos(Math.PI * e)));
        dur = 980 + 2 * Math.abs(g.angle) * DEG;
    }
    if (reducedMotion.matches) {
        dur = 1;
    }
    return {
        h,
        at,
        dur,
        t0: now,
        overlay: overlay || overlayFor(S, Gr, h)
    };
};
