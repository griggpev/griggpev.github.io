// Vectors, 3x3 matrices (row-major) and quaternions [w, x, y, z]; easing curves; and the carousel's wheel.

export const PHI = (1 + Math.sqrt(5)) / 2;
export const DEG = 180 / Math.PI;
export const EPS = 1e-6;

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// The same in the plane: the cross product's z, and the dot product.
export const cross2 = (p, q) => p[0] * q[1] - p[1] * q[0];
export const dot2 = (p, q) => p[0] * q[0] + p[1] * q[1];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const unit = a => scale(a, 1 / len(a));
export const mean = ps => scale(ps.reduce(add, [0, 0, 0]), 1 / ps.length);

export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const mmul = (A, B) => {
    const C = new Array(9);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
        }
    }
    return C;
};
export const mvec = (M, v) => [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
    M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
];
export const det3 = M => M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
// x with Mx = y, by Cramer's rule.
export const solve3 = (M, y) => {
    const D = det3(M);
    return [0, 1, 2].map(j => {
        const N = M.slice();
        for (let i = 0; i < 3; i++) {
            N[3 * i + j] = y[i];
        }
        return det3(N) / D;
    });
};
export const transpose = M => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];

// Right-handed rotation by t radians about the unit vector a.
export const rotation = (a, t) => {
    const [x, y, z] = a, c = Math.cos(t), s = Math.sin(t), k = 1 - c;
    return [
        c + x * x * k, x * y * k - z * s, x * z * k + y * s,
        y * x * k + z * s, c + y * y * k, y * z * k - x * s,
        z * x * k - y * s, z * y * k + x * s, c + z * z * k,
    ];
};

// Scale by s along the unit vector a, fixing the plane perpendicular to a. s = -1 is the reflection in that plane.
export const stretch = (a, s) => {
    const [x, y, z] = a, k = s - 1;
    return [1 + k * x * x, k * x * y, k * x * z, k * y * x, 1 + k * y * y, k * y * z, k * z * x, k * z * y, 1 + k * z * z];
};

export const qmul = (p, q) => [
    p[0] * q[0] - p[1] * q[1] - p[2] * q[2] - p[3] * q[3],
    p[0] * q[1] + p[1] * q[0] + p[2] * q[3] - p[3] * q[2],
    p[0] * q[2] - p[1] * q[3] + p[2] * q[0] + p[3] * q[1],
    p[0] * q[3] + p[1] * q[2] - p[2] * q[1] + p[3] * q[0],
];
export const qaxis = (a, t) => {
    const s = Math.sin(t / 2);
    return [Math.cos(t / 2), a[0] * s, a[1] * s, a[2] * s];
};
export const qnorm = q => {
    const l = Math.hypot(...q);
    return q.map(c => c / l);
};
export const qmat = ([w, x, y, z]) => [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
];
export const matq = M => {
    const [a, b, c, d, e, f, g, h, i] = M, tr = a + e + i;
    let q;
    if (tr > 0) {
        const s = 2 * Math.sqrt(tr + 1);
        q = [s / 4, (h - f) / s, (c - g) / s, (d - b) / s];
    } else if (a > e && a > i) {
        const s = 2 * Math.sqrt(1 + a - e - i);
        q = [(h - f) / s, s / 4, (b + d) / s, (c + g) / s];
    } else if (e > i) {
        const s = 2 * Math.sqrt(1 + e - a - i);
        q = [(c - g) / s, (b + d) / s, s / 4, (f + h) / s];
    } else {
        const s = 2 * Math.sqrt(1 + i - a - e);
        q = [(d - b) / s, (c + g) / s, (f + h) / s, s / 4];
    }
    return qnorm(q);
};

// A rotation carrying the point set `from` onto the point set `to` (unit vectors), found by matching a pair of points and their angle.
export const matchRotation = (from, to) => {
    const key = v => v.map(c => Math.round(c * 1e4)).join();
    const targets = new Set(to.map(key));
    const a = from[0],
        b = from.find(v => Math.abs(dot(v, a)) < 0.99),
        ab = dot(a, b);
    const frame = (x, y) => {
        const e2 = unit(sub(y, scale(x, dot(x, y))));
        return [x, e2, cross(x, e2)];
    };
    const F = frame(a, b);
    for (const a2 of to) {
        for (const b2 of to) {
            if (Math.abs(dot(a2, b2) - ab) > 1e-6) {
                continue;
            }
            const F2 = frame(a2, b2),
                R = new Array(9).fill(0);
            for (let k = 0; k < 3; k++) {
                for (let r = 0; r < 3; r++) {
                    for (let col = 0; col < 3; col++) {
                        R[3 * r + col] += F2[k][r] * F[k][col];
                    }
                }
            }
            if (from.every(v => targets.has(key(mvec(R, v))))) {
                return R;
            }
        }
    }
    return I3;
};

export const slerp = (p, q, t) => {
    let d = p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3];
    if (d < 0) {
        q = q.map(c => -c);
        d = -d;
    }
    if (d > 0.9995) {
        return qnorm(p.map((c, i) => c + t * (q[i] - c)));
    }
    const th = Math.acos(d),
        s = Math.sin(th);
    const a = Math.sin((1 - t) * th) / s,
        b = Math.sin(t * th) / s;
    return p.map((c, i) => a * c + b * q[i]);
};

// A textbook view: turn `up` to point up, spin by az about the vertical, then tip the top toward the viewer by el (degrees).
export const cameraView = ({
    up,
    az,
    el
}) => {
    const u = unit(up),
        y = [0, 1, 0],
        c = cross(u, y),
        s = len(c);
    const align = s < EPS ? (dot(u, y) > 0 ? [1, 0, 0, 0] : [0, 1, 0, 0]) : qaxis(scale(c, 1 / s), Math.acos(dot(u, y)));
    return qnorm(qmul(qaxis([1, 0, 0], el / DEG), qmul(qaxis([0, 1, 0], az / DEG), align)));
};

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// a mod n, from 0 up to n.
export const mod = (a, n) => ((a % n) + n) % n;
export const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

// CSS-style cubic-bezier easing.
export const bezier = (x1, y1, x2, y2) => {
    const cx = 3 * x1,
        bx = 3 * (x2 - x1) - cx,
        ax = 1 - cx - bx;
    const cy = 3 * y1,
        by = 3 * (y2 - y1) - cy,
        ay = 1 - cy - by;
    const X = t => ((ax * t + bx) * t + cx) * t;
    const Y = t => ((ay * t + by) * t + cy) * t;
    const dX = t => (3 * ax * t + 2 * bx) * t + cx;
    return x => {
        if (x <= 0) {
            return 0;
        }
        if (x >= 1) {
            return 1;
        }
        let t = x;
        for (let i = 0; i < 8; i++) {
            const err = X(t) - x,
                d = dX(t);
            if (Math.abs(err) < 1e-6) {
                return Y(t);
            }
            if (Math.abs(d) < 1e-6) {
                break;
            }
            t -= err / d;
        }
        let lo = 0,
            hi = 1;
        t = x;
        for (let i = 0; i < 30; i++) {
            if (X(t) < x) {
                lo = t;
            } else {
                hi = t;
            }
            t = (lo + hi) / 2;
        }
        return Y(t);
    };
};

// Quick start, a small overshoot, then a settle.
export const EASE = bezier(0.4, 0, 0.2, 1.22);
export const EASE_VIEW = bezier(0.45, 0, 0.2, 1);
export const EASY_EASE = bezier(0.333, 0, 0.667, 1); // After Effects' Easy Ease

// The picker wheel that up and down turn, settling as a picker does: a line of text steps WHEEL_DEG; the figure, on a wider drum (WHEEL_R of its height behind it, so that turning never brings it nearer), WHEEL_FIG. The old fades out as it goes, the new fades in.
export const WHEEL_DEG = 70;
export const WHEEL_FIG = 46;
export const WHEEL_MS = 680;
export const WHEEL_R = 1.5;
export const WHEEL_CSS = 'cubic-bezier(0.25, 0.1, 0.2, 1)';
export const WHEEL_EASE = bezier(0.25, 0.1, 0.2, 1);
export const COUNT_MS = 900; // the title's number counting to the new family's
// Turned deg about an axis r behind, seen with perspective p from in front of the face itself, so that unturned it is exactly as it was. The axis lies across (X: up and down, the families) or upright (Y: left and right, the polyhedra of a family).
export const wheelTurn = (deg, r, p, unit, axis = 'X') => ` perspective(${p.toFixed(1)}${unit}) translateZ(${(-r).toFixed(2)}${unit}) rotate${axis}(${deg.toFixed(2)}deg) translateZ(${r.toFixed(2)}${unit})`;
