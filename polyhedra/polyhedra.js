// There are 18 finite regular polyhedra (polyhedra/index.html): the Platonic
// and Kepler–Poinsot solids and their Petrials, drawn in the style of the
// site's dodecahedron icon. A click applies a random non-trivial symmetry,
// animated; P, D and F take the Petrial, the dual and the facetting.
//
// Coordinates: x right, y up, z toward the viewer, orthographic. Everything
// about a solid (faces, its symmetry group, the conjugacy classes and how to
// describe them) is computed from its vertex list. Every finished move snaps
// to an exact group element, so nothing drifts.
(() => {
  'use strict';

  /* ---------- Vectors, 3x3 matrices (row-major), quaternions [w, x, y, z] ---------- */

  const PHI = (1 + Math.sqrt(5)) / 2;
  const DEG = 180 / Math.PI;
  const EPS = 1e-6;

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const unit = a => scale(a, 1 / len(a));
  const mean = ps => scale(ps.reduce(add, [0, 0, 0]), 1 / ps.length);

  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mmul = (A, B) => {
    const C = new Array(9);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
      }
    }
    return C;
  };
  const mvec = (M, v) => [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
    M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
  ];
  const det3 = M => M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  const transpose = M => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];

  // Right-handed rotation by t radians about the unit vector a.
  const rotation = (a, t) => {
    const [x, y, z] = a, c = Math.cos(t), s = Math.sin(t), k = 1 - c;
    return [
      c + x * x * k, x * y * k - z * s, x * z * k + y * s,
      y * x * k + z * s, c + y * y * k, y * z * k - x * s,
      z * x * k - y * s, z * y * k + x * s, c + z * z * k,
    ];
  };

  // Scale by s along the unit vector a, fixing the plane perpendicular to a.
  // s = -1 is the reflection in that plane.
  const stretch = (a, s) => {
    const [x, y, z] = a, k = s - 1;
    return [1 + k * x * x, k * x * y, k * x * z, k * y * x, 1 + k * y * y, k * y * z, k * z * x, k * z * y, 1 + k * z * z];
  };

  const qmul = (p, q) => [
    p[0] * q[0] - p[1] * q[1] - p[2] * q[2] - p[3] * q[3],
    p[0] * q[1] + p[1] * q[0] + p[2] * q[3] - p[3] * q[2],
    p[0] * q[2] - p[1] * q[3] + p[2] * q[0] + p[3] * q[1],
    p[0] * q[3] + p[1] * q[2] - p[2] * q[1] + p[3] * q[0],
  ];
  const qaxis = (a, t) => { const s = Math.sin(t / 2); return [Math.cos(t / 2), a[0] * s, a[1] * s, a[2] * s]; };
  const qnorm = q => { const l = Math.hypot(...q); return q.map(c => c / l); };
  const qconj = ([w, x, y, z]) => [w, -x, -y, -z];
  const qmat = ([w, x, y, z]) => [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
  const matq = M => {
    const [a, b, c, d, e, f, g, h, i] = M, tr = a + e + i;
    let q;
    if (tr > 0) { const s = 2 * Math.sqrt(tr + 1); q = [s / 4, (h - f) / s, (c - g) / s, (d - b) / s]; }
    else if (a > e && a > i) { const s = 2 * Math.sqrt(1 + a - e - i); q = [(h - f) / s, s / 4, (b + d) / s, (c + g) / s]; }
    else if (e > i) { const s = 2 * Math.sqrt(1 + e - a - i); q = [(c - g) / s, (b + d) / s, s / 4, (f + h) / s]; }
    else { const s = 2 * Math.sqrt(1 + i - a - e); q = [(d - b) / s, (c + g) / s, (f + h) / s, s / 4]; }
    return qnorm(q);
  };

  // A rotation carrying the point set `from` onto the point set `to` (unit
  // vectors), found by matching a pair of points and their angle.
  const matchRotation = (from, to) => {
    const key = v => v.map(c => Math.round(c * 1e4)).join();
    const targets = new Set(to.map(key));
    const a = from[0], b = from.find(v => Math.abs(dot(v, a)) < 0.99), ab = dot(a, b);
    const frame = (x, y) => { const e2 = unit(sub(y, scale(x, dot(x, y)))); return [x, e2, cross(x, e2)]; };
    const F = frame(a, b);
    for (const a2 of to) {
      for (const b2 of to) {
        if (Math.abs(dot(a2, b2) - ab) > 1e-6) { continue; }
        const F2 = frame(a2, b2), R = new Array(9).fill(0);
        for (let k = 0; k < 3; k++) { for (let r = 0; r < 3; r++) { for (let col = 0; col < 3; col++) { R[3 * r + col] += F2[k][r] * F[k][col]; } } }
        if (from.every(v => targets.has(key(mvec(R, v))))) { return R; }
      }
    }
    return I3;
  };

  const slerp = (p, q, t) => {
    let d = p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3];
    if (d < 0) { q = q.map(c => -c); d = -d; }
    if (d > 0.9995) { return qnorm(p.map((c, i) => c + t * (q[i] - c))); }
    const th = Math.acos(d), s = Math.sin(th);
    const a = Math.sin((1 - t) * th) / s, b = Math.sin(t * th) / s;
    return p.map((c, i) => a * c + b * q[i]);
  };

  // A textbook view: turn `up` to point up, spin by az about the vertical,
  // then tip the top toward the viewer by el (degrees).
  const cameraView = ({ up, az, el }) => {
    const u = unit(up), y = [0, 1, 0], c = cross(u, y), s = len(c);
    const align = s < EPS ? (dot(u, y) > 0 ? [1, 0, 0, 0] : [0, 1, 0, 0]) : qaxis(scale(c, 1 / s), Math.acos(dot(u, y)));
    return qnorm(qmul(qaxis([1, 0, 0], el / DEG), qmul(qaxis([0, 1, 0], az / DEG), align)));
  };

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // CSS-style cubic-bezier easing.
  const bezier = (x1, y1, x2, y2) => {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = t => ((ax * t + bx) * t + cx) * t;
    const Y = t => ((ay * t + by) * t + cy) * t;
    const dX = t => (3 * ax * t + 2 * bx) * t + cx;
    return x => {
      if (x <= 0) { return 0; }
      if (x >= 1) { return 1; }
      let t = x;
      for (let i = 0; i < 8; i++) {
        const err = X(t) - x, d = dX(t);
        if (Math.abs(err) < 1e-6) { return Y(t); }
        if (Math.abs(d) < 1e-6) { break; }
        t -= err / d;
      }
      let lo = 0, hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        if (X(t) < x) { lo = t; } else { hi = t; }
        t = (lo + hi) / 2;
      }
      return Y(t);
    };
  };

  // Quick start, a small overshoot, then a settle.
  const EASE = bezier(0.4, 0, 0.2, 1.22);
  const EASE_VIEW = bezier(0.45, 0, 0.2, 1);
  const EASY_EASE = bezier(0.333, 0, 0.667, 1);   // After Effects' Easy Ease


  /* ---------- The solids ---------- */

  const cubeVerts = () => {
    const V = [];
    for (const x of [-1, 1]) { for (const y of [-1, 1]) { for (const z of [-1, 1]) { V.push([x, y, z]); } } }
    return V;
  };
  const signs = f => {
    const V = [];
    for (const s of [-1, 1]) { for (const t of [-1, 1]) { V.push(...f(s, t)); } }
    return V;
  };

  const unitAll = V => V.map(v => unit(v));
  const icosaVerts = () => unitAll(signs((s, t) => [[0, s, t * PHI], [s, t * PHI, 0], [t * PHI, 0, s]]));

  // Unit normal of a planar polygon (points pts), pointing away from the
  // center, by Newell's method so stars work too.
  const newell = pts => {
    let nx = 0, ny = 0, nz = 0;
    pts.forEach((a, k) => {
      const b = pts[(k + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    });
    return [nx, ny, nz];
  };
  const outward = pts => { const n = unit(newell(pts)); return dot(n, mean(pts)) < 0 ? scale(n, -1) : n; };

  // Pairs of vertices at the k-th smallest distance (k = 0: nearest).
  const distances = V => {
    const ds = [];
    V.forEach((a, i) => V.forEach((b, j) => { if (i < j) { const d = len(sub(a, b)); if (!ds.some(x => Math.abs(x - d) < 1e-6)) { ds.push(d); } } }));
    return ds.sort((x, y) => x - y);
  };
  const neighborsAt = (V, d) => V.map((a, i) => V.map((b, j) => j).filter(j => j !== i && Math.abs(len(sub(a, V[j])) - d) < 1e-6));

  // The neighbors js of vertex i, in order around it.
  const ringAround = (V, i, js) => {
    const n = V[i], c0 = sub(V[js[0]], scale(n, dot(V[js[0]], n)));
    const u = unit(c0), w = cross(n, u);
    const ang = j => Math.atan2(dot(V[j], w), dot(V[j], u));
    return [...js].sort((x, y) => ang(x) - ang(y));
  };

  // The great dodecahedron {5, 5/2}: the icosahedron's vertices and edges,
  // with a pentagon through the five neighbors of each vertex.
  const greatDodecahedron = () => {
    const V = icosaVerts(), nb = neighborsAt(V, distances(V)[0]);
    return { V, faces: V.map((v, i) => ringAround(V, i, nb[i])) };
  };

  // The great icosahedron {3, 5/2}: the icosahedron's vertices, joined to
  // their second neighbors, with the twenty triangles those edges make.
  const greatIcosahedron = () => {
    const V = icosaVerts(), far = neighborsAt(V, distances(V)[1]), faces = [];
    V.forEach((v, a) => far[a].forEach(b => far[b].forEach(c => {
      if (a < b && b < c && far[a].includes(c)) { faces.push([a, b, c]); }
    })));
    return { V, faces };
  };

  // The dual by reciprocation: a vertex along each face's normal, and a face
  // around each vertex, through the faces at that vertex in turn (each
  // sharing an edge with the next).
  const dualOf = ({ V, faces }) => {
    const verts = faces.map(f => outward(f.map(i => V[i])));
    const around = V.map((v, i) => {
      const at = faces.map((f, k) => k).filter(k => faces[k].includes(i));
      const sides = k => { const f = faces[k], m = f.indexOf(i); return [f[(m + 1) % f.length], f[(m + f.length - 1) % f.length]]; };
      const ring = [at[0]];
      for (let guard = 0; ring.length < at.length && guard < 50; guard++) {
        const cur = ring[ring.length - 1], prev = ring[ring.length - 2];
        const next = at.find(k => k !== cur && k !== prev && !ring.includes(k) && sides(k).some(u => sides(cur).includes(u)));
        if (next === undefined) { break; }
        ring.push(next);
      }
      return ring;
    });
    return { V: verts, faces: around };
  };

  // The regular polyhedra with planar faces: the five Platonic solids and
  // the four Kepler–Poinsot polyhedra. p, q and h (the length of a Petrie
  // polygon) are strings so that 5/2 and 10/3 can be written. dual and facet
  // name where d and f lead: 'same' when facetting changes nothing (three
  // faces at a vertex), 'degenerate' when it gives no polyhedron.
  const ICOSA_VIEW = { up: [0, 1, PHI], az: 252, el: 11 };
  const DEFS = {
    tetrahedron: {
      p: '3', q: '3', h: '4', dual: 'tetrahedron', facet: 'same',
      verts: () => [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
      view: { up: [1, 1, 1], az: 20, el: 18 },
    },
    cube: {
      p: '4', q: '3', h: '6', dual: 'octahedron', facet: 'same',
      verts: cubeVerts,
      view: { up: [0, 0, 1], az: 238, el: 28 },
    },
    octahedron: {
      p: '3', q: '4', h: '6', dual: 'cube', facet: 'degenerate',
      verts: () => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
      view: { up: [0, 0, 1], az: 98, el: 12 },
    },
    dodecahedron: {
      p: '5', q: '3', h: '10', dual: 'icosahedron', facet: 'same',
      verts: () => cubeVerts().concat(signs((s, t) => [[0, s / PHI, t * PHI], [s / PHI, t * PHI, 0], [s * PHI, 0, t / PHI]])),
      // Fitted to icons/owl-outline.svg, so at rest the drawing is the favicon.
      quat: [0.803711, 0.581609, 0.124755, 0.014716],
    },
    icosahedron: {
      p: '3', q: '5', h: '10', dual: 'dodecahedron', facet: 'great-dodecahedron',
      verts: () => signs((s, t) => [[0, s, t * PHI], [s, t * PHI, 0], [t * PHI, 0, s]]),
      view: ICOSA_VIEW,
    },
    'great-dodecahedron': {
      title: 'great dodecahedron', p: '5', q: '5/2', h: '6', dual: 'small-stellated-dodecahedron', facet: 'icosahedron',
      build: greatDodecahedron, view: ICOSA_VIEW,
    },
    'small-stellated-dodecahedron': {
      title: 'small stellated dodecahedron', p: '5/2', q: '5', h: '6', dual: 'great-dodecahedron', facet: 'great-icosahedron',
      build: () => dualOf(greatDodecahedron()), view: ICOSA_VIEW,
    },
    'great-icosahedron': {
      title: 'great icosahedron', p: '3', q: '5/2', h: '10/3', dual: 'great-stellated-dodecahedron', facet: 'small-stellated-dodecahedron',
      build: greatIcosahedron, view: ICOSA_VIEW,
    },
    'great-stellated-dodecahedron': {
      title: 'great stellated dodecahedron', p: '5/2', q: '3', h: '10/3', dual: 'great-icosahedron', facet: 'same',
      build: () => dualOf(greatIcosahedron()), view: ICOSA_VIEW,
    },
  };
  const ORDER = ['tetrahedron', 'cube', 'octahedron', 'dodecahedron', 'icosahedron'];

  const near = (a, b) => Math.abs(a - b) < EPS;
  const keyOf = M => M.map(c => Math.round(c * 1e4)).join(',');

  // Axis and angle of a rotation matrix, angle in [0, π].
  const axisAngle = R => {
    const angle = Math.acos(clamp((R[0] + R[4] + R[8] - 1) / 2, -1, 1));
    if (angle < EPS) { return { axis: [0, 0, 1], angle: 0 }; }
    if (Math.PI - angle > EPS) {
      return { axis: unit([R[7] - R[5], R[2] - R[6], R[3] - R[1]]), angle };
    }
    // Half-turn: R + I = 2aaᵀ.
    const d = [R[0], R[4], R[8]];
    const i = d.indexOf(Math.max(...d));
    const row = [R[3 * i], R[3 * i + 1], R[3 * i + 2]];
    row[i] += 1;
    return { axis: unit(row), angle: Math.PI };
  };

  // Faces as the supporting planes of a convex vertex set, each listed
  // counterclockwise as seen from outside.
  const hullFaces = V => {
    const n = V.length, faces = [], normals = [];
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        for (let c = b + 1; c < n; c++) {
          let nrm = cross(sub(V[b], V[a]), sub(V[c], V[a]));
          if (len(nrm) < EPS) { continue; }
          nrm = unit(nrm);
          if (dot(nrm, V[a]) < 0) { nrm = scale(nrm, -1); }
          const h = dot(nrm, V[a]);
          if (V.some(v => dot(v, nrm) > h + EPS) || normals.some(m => len(sub(m, nrm)) < EPS)) { continue; }
          const ids = V.map((v, i) => i).filter(i => near(dot(V[i], nrm), h));
          const center = mean(ids.map(i => V[i]));
          const u = unit(sub(V[ids[0]], center)), w = cross(nrm, u);
          const ang = i => { const d = sub(V[i], center); return Math.atan2(dot(d, w), dot(d, u)); };
          normals.push(nrm);
          faces.push(ids.sort((x, y) => ang(x) - ang(y)));
        }
      }
    }
    return faces;
  };

  // Turn faces (vertex cycles) so that every edge is run one way by one of
  // its faces and the other way by the other.
  const orientFaces = faces => {
    const out = faces.map(f => [...f]), done = out.map(() => false), queue = [0];
    done[0] = true;
    const has = (f, a, b) => { const m = f.indexOf(a); return m >= 0 && f[(m + 1) % f.length] === b; };
    while (queue.length) {
      const f = out[queue.shift()];
      f.forEach((a, m) => {
        const b = f[(m + 1) % f.length];
        out.forEach((g, k) => {
          if (done[k] || !g.includes(a) || !g.includes(b) || !(has(g, a, b) || has(g, b, a))) { return; }
          if (has(g, a, b)) { g.reverse(); }
          done[k] = true;
          queue.push(k);
        });
      });
    }
    return out;
  };

  const faceRecord = (V, ids) => {
    const pts = ids.map(i => V[i]), normal = outward(pts);
    return { ids, normal, h: dot(normal, pts[0]), center: mean(pts), orient: dot(newell(pts), normal) < 0 ? -1 : 1 };
  };

  const buildSolid = name => {
    const def = DEFS[name];
    const built = def.build ? def.build() : null;
    const V = built ? unitAll(built.V) : unitAll(def.verts());       // circumradius 1
    const n = V.length;
    const convex = !built;

    // The convex hull: its symmetries are the polyhedron's, and it decides
    // front and back for the ink drawing of a convex solid.
    const HULL_FACES = hullFaces(V).map(ids => faceRecord(V, ids));
    const hullLen = distances(V)[0];
    const HULL_EDGES = [];
    V.forEach((a, i) => V.forEach((b, j) => { if (i < j && near(len(sub(a, b)), hullLen)) { HULL_EDGES.push([i, j]); } }));

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
    const isSide = (ids, i, j) => { const m = ids.indexOf(i); return m >= 0 && (ids[(m + 1) % ids.length] === j || ids[(m + ids.length - 1) % ids.length] === j); };
    const EDGE_FACES = EDGES.map(([i, j]) => FACES.map((f, k) => k).filter(k => isSide(FACES[k].ids, i, j)));

    // Distance from the center to the hull along the unit vector d, and the
    // feature of the hull the ray leaves through: vertex, edge or face.
    const surface = d => Math.min(...HULL_FACES.filter(f => dot(f.normal, d) > EPS).map(f => f.h / dot(f.normal, d)));
    const exit = d => {
      const p = scale(d, surface(d));
      if (V.some(v => len(sub(v, p)) < 1e-5)) { return 'v'; }
      if (HULL_EDGES.some(([i, j]) => len(sub(scale(add(V[i], V[j]), 0.5), p)) < 1e-5)) { return 'e'; }
      return 'f';
    };

    const lengths = EDGES.map(([i, j]) => len(sub(V[i], V[j])));
    const flat = FACES.every(f => f.ids.every(i => Math.abs(dot(V[i], f.normal) - f.h) < 1e-6));
    if (EDGE_FACES.some(f => f.length !== 2) || !flat || Math.max(...lengths) - Math.min(...lengths) > 1e-6
      || (convex && FACES.length - EDGES.length + n !== 2)) {
      throw new Error(`${name}: construction failed`);
    }

    // Petrie polygons: zigzag along the edges, turning left and right in
    // turn, so that any two consecutive edges share a face but no three do.
    // A left turn at cur follows the face around prev→cur in its own
    // direction; a right turn follows the face on the other side, backwards.
    const leftOf = new Map();
    FACES.forEach((f, k) => f.ids.forEach((a, m) => leftOf.set(`${a},${f.ids[(m + 1) % f.ids.length]}`, k)));
    const along = (k, v, d) => { const ids = FACES[k].ids, m = ids.indexOf(v); return ids[(m + d + ids.length) % ids.length]; };
    const PETRIE = [];
    const seenPetrie = new Set();
    for (const [a, b] of EDGES) {
      for (const first of [true, false]) {
        const poly = [a];
        let prev = a, cur = b, left = first;
        do {
          poly.push(cur);
          const next = left ? along(leftOf.get(`${prev},${cur}`), cur, 1) : along(leftOf.get(`${cur},${prev}`), cur, -1);
          prev = cur;
          cur = next;
          left = !left;
        } while (!(prev === a && cur === b && left === first) && poly.length <= 2 * EDGES.length);
        poly.pop();
        const key = poly.map((v, m) => edgeIndex.get(`${v},${poly[(m + 1) % poly.length]}`)).sort((x, y) => x - y).join();
        if (!seenPetrie.has(key)) { seenPetrie.add(key); PETRIE.push(poly); }
      }
    }
    const hn = PETRIE[0].length;
    if (PETRIE.some(p => p.length !== hn) || PETRIE.length * hn !== 2 * EDGES.length) {
      throw new Error(`${name}: Petrie polygons failed`);
    }

    // The dual, reciprocated in the midsphere: a vertex out along each face
    // normal, at the distance that makes every dual edge cross its original
    // edge at the midpoint. Its faces go around each original vertex,
    // through the faces there in turn.
    const midR = len(scale(add(V[EDGES[0][0]], V[EDGES[0][1]]), 0.5));
    const c = (midR * midR) / FACES[0].h;
    const around = dualOf({ V, faces: FACES.map(f => f.ids) }).faces;
    const dualEdge = new Map();
    EDGE_FACES.forEach(([f, g], k) => { dualEdge.set(f < g ? `${f},${g}` : `${g},${f}`, k); });
    const DUAL = { c, verts: FACES.map(f => scale(f.normal, c)), faces: around, edgeOf: dualEdge };

    return {
      name, def, title: def.title || name, convex, V, EDGES, FACES, EDGE_FACES, HULL_FACES, HULL_EDGES,
      surface, exit, edgeIndex, PETRIE, DUAL,
      pn: FACES[0].ids.length,
      qn: EDGES.filter(e => e.includes(0)).length,
      dashes: Math.max(2, Math.round(SCALE * lengths[0] / DASH_PERIOD)),
      q0: def.quat ? qnorm(def.quat) : cameraView(def.view),
    };
  };


  /* ---------- Symmetry groups ---------- */

  const buildGroup = S => {
    // The symmetries of the polyhedron are those of its hull.
    const { V, HULL_FACES: FACES, HULL_EDGES: EDGES } = S;
    const f = FACES[0], v = f.ids[0];
    const degree = EDGES.filter(e => e.includes(v)).length;

    // Rotations: close up under a turn about a face and a turn about a vertex.
    const rotations = [I3];
    const seen = new Set([keyOf(I3)]);
    const gens = [rotation(f.normal, 2 * Math.PI / f.ids.length), rotation(unit(V[v]), 2 * Math.PI / degree)];
    for (let i = 0; i < rotations.length; i++) {
      for (const g of gens) {
        const M = mmul(g, rotations[i]);
        const k = keyOf(M);
        if (!seen.has(k)) { seen.add(k); rotations.push(M); }
      }
    }
    if (rotations.length !== 2 * EDGES.length) { throw new Error(`${S.name}: found ${rotations.length} rotations`); }

    // The other coset: rotations times the mirror through a face center and
    // one of its vertices.
    const sigma = stretch(unit(cross(f.normal, V[v])), -1);
    const vkeys = new Set(V.map(p => p.map(c => Math.round(c * 1e5)).join()));
    if (!V.every(p => vkeys.has(mvec(sigma, p).map(c => Math.round(c * 1e5)).join()))) {
      throw new Error(`${S.name}: mirror is not a symmetry`);
    }

    const info = M => {
      if (det3(M) > 0) { return { M, proper: true, ...axisAngle(M) }; }
      // An improper M is R(a, θ + π) composed with the reflection across a⊥,
      // where -M = R(a, θ).
      const { axis, angle } = axisAngle(M.map(c => -c));
      if (angle < EPS) { return { M, proper: false, inversion: true, axis: [0, 0, 1], angle: 0 }; }
      let turn = angle + Math.PI;
      if (turn > Math.PI + 1e-9) { turn -= 2 * Math.PI; }
      return { M, proper: false, axis, angle: turn };
    };

    const G = rotations.map(info).concat(rotations.map(R => info(mmul(R, sigma))));
    const index = new Map(G.map((g, i) => [keyOf(g.M), i]));
    const lookup = M => {
      const i = index.get(keyOf(M));
      if (i === undefined) { throw new Error('not a symmetry'); }
      return i;
    };
    const TIMES = G.map(a => G.map(b => lookup(mmul(a.M, b.M))));
    const INV = G.map(g => lookup(transpose(g.M)));
    const fold = a => rotations.filter(R => len(sub(mvec(R, a), a)) < 1e-5).length;

    const find = M => { const i = index.get(keyOf(M)); return i === undefined ? 0 : i; };
    return { G, R: rotations.length, TIMES, INV, fold, find };
  };

  // How each kind of axis and mirror is described in words. F names a face:
  // 'face' on a solid, or the polygon ('square') on a Petrial, whose own
  // faces are skew.
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
    if (eIn === 1) { return ['through an edge', 'through one edge and the midpoint of the opposite edge']; }
    if (eIn === 2) { return ['through edges', 'through two opposite edges']; }
    if (vIn >= 4) { return ['through 4 vertices', 'through four vertices']; }
    if (vIn === 2) { return ['through 2 vertices', 'through two opposite vertices']; }
    return [`between ${F}s`, `halfway between two opposite ${F}s`];
  };

  const describe = (S, Gr, i, F) => {
    const g = Gr.G[i];
    if (i === 0) { return { label: 'identity', text: 'the identity', sort: [0, 0, 0, 0] }; }
    if (g.inversion) {
      return { label: 'inversion', text: 'the central inversion, which sends each point to the point opposite it', sort: [1, 0, 0, 0] };
    }
    const ends = [S.exit(g.axis), S.exit(scale(g.axis, -1))];
    const [word, phrase] = axesFor(F)[[...ends].sort().join('')];
    const fold = Gr.fold(g.axis);
    const deg = Math.round(Math.abs(g.angle) * DEG);
    if (g.proper) {
      // Counterclockwise as seen from the vertex end, if the axis has one.
      const hand = ends[0] === 'v' ? 'counterclockwise' : 'clockwise';
      return deg === 180
        ? { label: `${word} half-turns`, text: `a half-turn about an axis ${phrase}`, sort: [0, 1, fold, deg] }
        : { label: `${word} turns, ${deg}°`, text: `a rotation by ${deg}° about an axis ${phrase}`, sort: [0, 1, fold, deg],
            hand, handText: `, ${hand} as seen from the vertex` };
    }
    if (deg === 0) {
      const [short, where] = mirrorKind(S, g.axis, F);
      return { label: 'mirrors', short, text: `a reflection in a mirror plane ${where}`, sort: [1, 1, 0, 0] };
    }
    return {
      label: `rotatory, ${deg}°`,
      text: `a rotatory reflection: a ${deg}° turn about an axis ${phrase}, then a reflection in the plane perpendicular to it`,
      sort: [1, 2, fold, deg],
    };
  };

  // Conjugacy classes of the first n elements (the rotations, or everything).
  const classesOf = (S, Gr, n, F = 'face') => {
    const owner = new Array(n).fill(-1);
    const list = [];
    for (let g = 0; g < n; g++) {
      if (owner[g] >= 0) { continue; }
      const members = new Set();
      for (let h = 0; h < n; h++) { members.add(Gr.TIMES[Gr.TIMES[h][g]][Gr.INV[h]]); }
      const k = list.length;
      members.forEach(m => { owner[m] = k; });
      list.push({ members: [...members].sort((a, b) => a - b), ...describe(S, Gr, g, F) });
    }

    // Two classes that would read the same get told apart.
    const byLabel = new Map();
    list.forEach(c => byLabel.set(c.label, (byLabel.get(c.label) || 0) + 1));
    for (const c of list) {
      if (byLabel.get(c.label) < 2) { continue; }
      if (c.hand) {
        c.label += c.hand === 'counterclockwise' ? ', ccw' : ', cw';
        c.text += c.handText;
        c.sort = [...c.sort, c.hand === 'counterclockwise' ? 0 : 1];
      } else if (c.short) {
        c.label += ` ${c.short}`;
      }
    }

    // With the central inversion present, each orientation-reversing class is
    // -1 times a rotation class; list it in its partner's place so the two
    // columns of Figure 2 pair up.
    const inv = Gr.G.findIndex((g, i) => i < n && g.inversion);
    if (inv >= 0) {
      for (const c of list) {
        if (c.members[0] >= Gr.R) { c.sort = [1, ...list[owner[Gr.TIMES[inv][c.members[0]]]].sort]; }
      }
    }

    const cmp = (a, b) => {
      for (let k = 0; k < Math.max(a.sort.length, b.sort.length); k++) {
        const d = (a.sort[k] || 0) - (b.sort[k] || 0);
        if (d) { return d; }
      }
      return a.members.length - b.members.length;
    };
    list.sort(cmp);
    list.forEach((c, k) => c.members.forEach(m => { owner[m] = k; }));
    return { list, owner };
  };


  /* ---------- Drawing ---------- */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // The icon's own proportions: a 512-unit box, circumradius 258, 12-unit
  // strokes, and a dash every 46 units of hidden edge.
  const CENTER = 256;
  const SCALE = 258;
  const STROKE = 12;
  const DASH_PERIOD = 46;
  const GAP_RATIO = 1.25;          // gap length / dash length, before caps
  const EDGE_ON = 0.12;            // |n·z| below this counts as edge-on
  const AXIS_REACH = 1.36;
  const MIRROR_RADIUS = 1.24;
  const VIEWBOX = '-40 -40 592 592';

  const make = (name, attrs, parent) => {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) { el.setAttribute(k, v); }
    if (parent) { parent.append(el); }
    return el;
  };

  const ROUND = 34;                // how far a rounded corner reaches along the outline

  const sx = p => (CENTER + SCALE * p[0]).toFixed(2);
  const sy = p => (CENTER - SCALE * p[1]).toFixed(2);
  const pts = ps => ps.map(p => `${sx(p)},${sy(p)}`).join(' ');

  // Screen points (already scaled) for the wireframe.
  const screen = p => [CENTER + SCALE * p[0], CENTER - SCALE * p[1]];
  const f2 = x => x.toFixed(2);
  const pt = q => `${f2(q[0])},${f2(q[1])}`;
  const cross2 = (p, q) => p[0] * q[1] - p[1] * q[0];

  // The segment from a to b with its ends pulled in by ta and tb, but never
  // past 42% of its length, so short (foreshortened) edges survive.
  const trim = (a, b, ta, tb) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1e-6) { return [a, b]; }
    const sa = Math.min(ta, 0.42 * L) / L, sb = Math.min(tb, 0.42 * L) / L;
    return [[a[0] + dx * sa, a[1] + dy * sa], [b[0] - dx * sb, b[1] - dy * sb]];
  };

  // Rounded vertices, the way the icon rounds them. The silhouette of a
  // convex solid is the convex hull of its projected vertices; that outline
  // gets its corners rounded, and every other edge at a corner stops where it
  // meets the curve. Interior and hidden junctions stay sharp. A vertex joins
  // or leaves the outline only when its corner is flat, where the rounding
  // vanishes, so nothing jumps.
  const outline = Q => {
    const ids = Q.map((q, i) => i).sort((a, b) => Q[a][0] - Q[b][0] || Q[a][1] - Q[b][1]);
    const turn = (o, a, b) => cross2([Q[a][0] - Q[o][0], Q[a][1] - Q[o][1]], [Q[b][0] - Q[o][0], Q[b][1] - Q[o][1]]);
    const half = list => {
      const h = [];
      for (const i of list) {
        while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], i) <= 1e-9) { h.pop(); }
        h.push(i);
      }
      return h;
    };
    const H = half(ids).slice(0, -1).concat(half([...ids].reverse()).slice(0, -1));
    if (H.length < 3) { return { corners: [], at: new Map(), d: '' }; }

    const corners = H.map((A, k) => {
      const a = Q[A], p = Q[H[(k + H.length - 1) % H.length]], n = Q[H[(k + 1) % H.length]];
      const lp = Math.hypot(p[0] - a[0], p[1] - a[1]), ln = Math.hypot(n[0] - a[0], n[1] - a[1]);
      const r = Math.min(ROUND, 0.42 * lp, 0.42 * ln);
      const u1 = [(p[0] - a[0]) / lp, (p[1] - a[1]) / lp], u2 = [(n[0] - a[0]) / ln, (n[1] - a[1]) / ln];
      return { a, r, u1, u2, p1: [a[0] + r * u1[0], a[1] + r * u1[1]], p2: [a[0] + r * u2[0], a[1] + r * u2[1]] };
    });
    let d = `M${pt(corners[0].p2)}`;
    for (const c of [...corners.slice(1), corners[0]]) { d += `L${pt(c.p1)}Q${pt(c.a)} ${pt(c.p2)}`; }
    return { corners, at: new Map(H.map((A, k) => [A, corners[k]])), d: `${d}Z` };
  };

  // How far an edge leaving the corner c toward the screen point x must be
  // cut back to end on the corner's curve. The curve is a quadratic Bézier
  // a + r[(1 - s)² u1 + s² u2]; solve for where it crosses the edge.
  const cutBack = (c, x) => {
    const dx = x[0] - c.a[0], dy = x[1] - c.a[1], L = Math.hypot(dx, dy);
    if (L < 1e-6) { return 0; }
    const u = [dx / L, dy / L];
    const s1 = cross2(c.u1, u), s2 = cross2(c.u2, u);
    if (Math.abs(s1) < 1e-6 || Math.abs(s2) < 1e-6) { return c.r; }   // along the outline
    if (s1 * s2 > 0) { return 0; }
    const s = 1 / (1 + Math.sqrt(-s2 / s1));
    return c.r * Math.hypot((1 - s) ** 2 * c.u1[0] + s * s * c.u2[0], (1 - s) ** 2 * c.u1[1] + s * s * c.u2[1]);
  };

  // Hidden edges are dashed as if the dashes were painted on the solid: a
  // fixed number per edge, foreshortening with it, a whole dash at each end.
  // As an edge turns toward the viewer (v → 1) its gaps close up.
  const dashFor = (L, n, v) => {
    if (v > 0.995 || L < 1) { return 'none'; }
    const gap = (1 - v) * GAP_RATIO * L / (n + (n - 1) * GAP_RATIO);
    const dash = (L - (n - 1) * gap) / n;
    return `${dash.toFixed(2)} ${gap.toFixed(2)}`;
  };

  // a, b: screen points.
  const setLine = (el, a, b, n, v) => {
    el.setAttribute('x1', f2(a[0]));
    el.setAttribute('y1', f2(a[1]));
    el.setAttribute('x2', f2(b[0]));
    el.setAttribute('y2', f2(b[1]));
    el.setAttribute('stroke-dasharray', dashFor(Math.hypot(a[0] - b[0], a[1] - b[1]), n, v));
  };

  // Faces drawn as loops just inside their edges, so every face reads as
  // its own closed path. Each corner of a face gets an inset point, INSET in
  // from both of its edges. A planar face is the loop through its own
  // corners; a Petrie polygon turns through one face corner at each vertex,
  // so its loop runs corner to corner across each edge, crossing its partner
  // at the middle. Every corner belongs to exactly one Petrie polygon: the
  // faces and the Petrie polygons are two ways of wiring up the same points.
  const LOOP_W = STROKE * 0.5;
  const INSET = 0.045;

  // The unit offset that moves a corner of a planar polygon (points pts,
  // corner k) inward to distance 1 from both of its sides.
  const cornerOffset = (pts, k) => {
    const m = pts.length, v = pts[k];
    const u1 = unit(sub(pts[(k + m - 1) % m], v)), u2 = unit(sub(pts[(k + 1) % m], v));
    const half = Math.acos(clamp(dot(u1, u2), -1, 1)) / 2;
    return scale(unit(add(u1, u2)), 1 / Math.sin(half));
  };

  // One hue per face, evenly around the wheel; lightness and chroma come
  // from the page so the loops suit both modes.
  // Face colors: hues evenly spaced from 35°, each at Open Color's own
  // lightness and chroma for that hue, interpolated between its twelve hues:
  // shade 7 on paper, shade 4 in the dark. [hue, L, C] in OKLCH, from the
  // palette's hex values (yeun.github.io/open-color).
  const OC7 = [[5.2, 0.588, 0.201], [25.8, 0.632, 0.214], [44.6, 0.685, 0.195], [71.0, 0.770, 0.166],
    [131.5, 0.710, 0.190], [146.2, 0.674, 0.177], [164.7, 0.643, 0.134], [212.2, 0.625, 0.106],
    [251.3, 0.586, 0.159], [268.4, 0.557, 0.208], [287.8, 0.542, 0.227], [319.1, 0.578, 0.219]];
  const OC4 = [[21.1, 0.756, 0.146], [64.6, 0.803, 0.146], [92.2, 0.883, 0.165], [128.0, 0.847, 0.188],
    [147.3, 0.802, 0.168], [167.9, 0.793, 0.147], [207.6, 0.770, 0.119], [246.1, 0.718, 0.142],
    [271.0, 0.680, 0.163], [292.1, 0.658, 0.191], [319.5, 0.725, 0.196], [358.8, 0.750, 0.147]];
  const ocAt = (table, h) => {
    const n = table.length;
    let j = table.findIndex(r => r[0] > h);
    if (j < 0) { j = 0; }
    const a = table[(j + n - 1) % n], b = table[j];
    const t = ((h - a[0] + 360) % 360) / ((b[0] - a[0] + 360) % 360 || 360);
    return [a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
  };
  const LIGHT_DARK = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', 'light-dark(red, blue)');
  const loopColor = (k, n) => {
    const h = (35 + (360 * k) / n) % 360;
    if (!LIGHT_DARK) { return `oklch(var(--lane-l) var(--lane-c) ${h.toFixed(1)})`; }
    const ok = ([l, c]) => `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
    return `light-dark(${ok(ocAt(OC7, h))}, ${ok(ocAt(OC4, h))})`;
  };

  // A loop: nodes { base, off } at base + s·off; with mids, a point halfway
  // between each pair of nodes (where a Petrie polygon crosses an edge);
  // vis[j] names what decides whether segment j is in front.
  const segmentsOf = loop => (loop.mids ? 2 : 1) * loop.nodes.length;

  const makeLoops = (loops, parent, plain) => loops.map((loop, k) => Array.from({ length: segmentsOf(loop) }, () => {
    const el = make('line', { class: plain ? 'tt-loop is-plain' : 'tt-loop', 'stroke-width': LOOP_W }, parent);
    if (!plain) { el.style.stroke = loopColor(k, loops.length); }
    return el;
  }));

  // T: the linear map; z: a scale applied first; s: the inset; vis(id) in
  // [0, 1] says how far a stretch is in front; progress[k], if given, is how
  // many segments of loop k are drawn, so a face can be traced out; alpha is
  // a number, or a function of k to pick out one loop.
  // alpha and weight are numbers, or functions of k: to pick out one loop,
  // or to embolden the one being traced.
  // hidden: how much of a stretch behind the solid shows (a number, or a
  // function of k, so one face alone can be seen through).
  // lift sets loop k at its own very slightly different distance from the
  // center (scaled by 1 + lift·(k - middle)), so no two loops ever meet.
  // Returns what was drawn, for drawGaps.
  const drawLoops = (els, loops, T, z, s, vis, progress, alpha, weight = 1, hidden = HIDDEN, lift = 0) => {
    return loops.map((loop, k) => {
      const a = typeof alpha === 'function' ? alpha(k) : alpha;
      const wt = typeof weight === 'function' ? weight(k) : weight;
      const hd = typeof hidden === 'function' ? hidden(k) : hidden;
      const g = z * (1 + lift * (k - (loops.length - 1) / 2));
      const N3 = loop.nodes.map(nd => mvec(T, scale(add(nd.base, scale(nd.off, s)), g)));
      const P3 = loop.mids ? N3.flatMap((q, i) => [q, scale(add(q, N3[(i + 1) % N3.length]), 0.5)]) : N3;
      const pts = P3.map(screen);
      const m = pts.length, op = [], wd = [];
      els[k].forEach((el, j) => {
        const f = progress ? clamp(progress[k] - j, 0, 1) : 1;
        if (f <= 0.001 || a <= 0.001) { el.style.opacity = 0; op[j] = 0; wd[j] = 0; return; }
        const A = pts[j], B = pts[(j + 1) % m];
        el.setAttribute('x1', f2(A[0]));
        el.setAttribute('y1', f2(A[1]));
        el.setAttribute('x2', f2(A[0] + f * (B[0] - A[0])));
        el.setAttribute('y2', f2(A[1] + f * (B[1] - A[1])));
        // Stretches behind are lighter and thinner but unbroken, so a loop can
        // be followed all the way round.
        const v = vis(loop.vis[j]);
        wd[j] = LOOP_W * wt * (0.6 + 0.4 * v);
        op[j] = a * (v + (1 - v) * hd);
        el.setAttribute('stroke-width', f2(wd[j]));
        el.style.opacity = op[j];
      });
      return { P3, pts, op, wd, done: progress ? progress[k] : Infinity };
    });
  };

  // Petrie polygons, as continuous loops, cross in pairs near the middle of
  // each edge. Each loop sits at its own very slightly different distance
  // from the center, so at every crossing one strand is nearer. The one
  // underneath stops short on either side, with ordinary round ends, just
  // where it would come within GAP of the nearer strand; at a shallow
  // crossing that is further off, so the two never seem to touch.
  const LIFT = 0.006;
  const GAP = 2;
  const JOG = 0.034;     // half the length, along the edge, of the crossing jog

  const makeWoven = (loops, parent) => ({
    els: loops.map((loop, k) => Array.from({ length: segmentsOf(loop) }, () => {
      const el = make('line', { class: 'tt-loop', 'stroke-width': LOOP_W }, parent);
      el.style.stroke = loopColor(k, loops.length);
      return el;
    })),
  });

  // After drawLoops: at each crossing, find where the two strands meet on
  // screen and which is nearer, and pull the farther strand's two halves
  // back from its midpoint (where they join) far enough to clear.
  const drawGaps = (woven, cross, drawn) => {
    cross.forEach(([A, B]) => {
      const da = drawn[A.loop], db = drawn[B.loop];
      if (!da || !db || da.done < A.j + 1 || db.done < B.j + 1) { return; }
      const ma = da.pts.length, mb = db.pts.length;
      const a0 = da.pts[(A.j + ma - 1) % ma], a1 = da.pts[(A.j + 1) % ma], b0 = db.pts[(B.j + mb - 1) % mb], b1 = db.pts[(B.j + 1) % mb];
      const ax = a1[0] - a0[0], ay = a1[1] - a0[1], bx = b1[0] - b0[0], by = b1[1] - b0[1];
      const den = ax * by - ay * bx;
      if (Math.abs(den) < 1e-6) { return; }
      const t = ((b0[0] - a0[0]) * by - (b0[1] - a0[1]) * bx) / den, u = ((b0[0] - a0[0]) * ay - (b0[1] - a0[1]) * ax) / den;
      if (t < 0.1 || t > 0.9 || u < 0.1 || u > 0.9) { return; }
      const za = da.P3[(A.j + ma - 1) % ma][2] * (1 - t) + da.P3[(A.j + 1) % ma][2] * t;
      const zb = db.P3[(B.j + mb - 1) % mb][2] * (1 - u) + db.P3[(B.j + 1) % mb][2] * u;
      const aOver = za >= zb;
      const [up, dUp, fUp] = aOver ? [A, da, t] : [B, db, u];
      const [lo, dLo, fLo, p0, p1] = aOver ? [B, db, u, b0, b1] : [A, da, t, a0, a1];
      const mU = dUp.pts.length, mL = dLo.pts.length;
      const segU = fUp < 0.5 ? (up.j + mU - 1) % mU : up.j;
      // No gap where the nearer strand is too faint to be seen passing over.
      if (dUp.op[segU] < 0.15) { return; }
      const lenA = Math.hypot(ax, ay), lenB = Math.hypot(bx, by);
      const sin = Math.abs(den) / (lenA * lenB);
      const before = (lo.j + mL - 1) % mL, after = lo.j;
      const wLo = Math.max(dLo.wd[before], dLo.wd[after]);
      const clear = (dUp.wd[segU] + wLo) / 2 + GAP;
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
      // How far either side of its midpoint the lower strand has to give way.
      const back = Math.min(0.42, Math.abs(fLo - 0.5) + clear / Math.max(sin, 0.08) / L);
      const at = f => [p0[0] + f * (p1[0] - p0[0]), p0[1] + f * (p1[1] - p0[1])];
      const [e1, e2] = [at(0.5 - back), at(0.5 + back)];
      const l1 = woven.els[lo.loop][before], l2 = woven.els[lo.loop][after];
      l1.setAttribute('x2', f2(e1[0]));
      l1.setAttribute('y2', f2(e1[1]));
      l2.setAttribute('x1', f2(e2[0]));
      l2.setAttribute('y1', f2(e2[1]));
    });
  };

  // How much of a stretch behind the solid shows, normally.
  const HIDDEN = 0.28;

  // How much each face of the convex hull faces the viewer under T.
  const frontOf = (S, P, T) => {
    const flip = det3(T) < 0 ? -1 : 1;
    return S.FACES.map(f => {
      const sign = flip * f.orient;
      let nx = 0, ny = 0, nz = 0;
      const m = f.ids.length;
      for (let k = 0; k < m; k++) {
        const a = P[f.ids[k]], b = P[f.ids[(k + 1) % m]];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const l = Math.hypot(nx, ny, nz);
      return l < 1e-9 ? 0.5 : smoothstep(-EDGE_ON, EDGE_ON, sign * nz / l);
    });
  };

  let clipCount = 0;
  const buildScene = (svg, S, form = 'solid') => {
    svg.replaceChildren();
    // Fills and the flag are clipped to the rounded outline. Each drawing
    // (the live figure, its neighbors, snapshots) needs its own clip id.
    const id = `tt-clip-${++clipCount}`;
    const clip = make('path', {}, make('clipPath', { id }, make('defs', {}, svg)));
    const g = (cls, clipped) => make('g', clipped ? { class: cls, 'clip-path': `url(#${id})` } : { class: cls }, svg);
    const faces = g('tt-faces', true);
    const flag = g('tt-flag', true);
    const mirror = g('tt-mirror');
    const axisFar = g('tt-axis');
    const edges = g('tt-edges');
    const lanes = g('tt-lanes');
    const corner = g('tt-flag-off-ink');
    const axisNear = g('tt-axis');
    const marks = g('tt-marks');

    const axisEnd = parent => ({
      line: make('line', { class: 'tt-axis-line' }, parent),
      pin: make('circle', { class: 'tt-pin', r: 9 }, parent),
    });

    return {
      form,
      clip,
      edgesGroup: edges,
      // Forms: 'solid', a convex polyhedron in ink; 'faces', a star
      // polyhedron, each face a colored loop; 'petrial', each face (a Petrie
      // polygon) a colored loop. Off the ink, a flag is drawn as its
      // half-edge with a tick along the face's next edge.
      lanesGroup: lanes,
      loops: form === 'faces' ? makeLoops(S.LOOPS.faces, lanes) : null,
      woven: form === 'petrial' ? makeWoven(S.LOOPS.petrie, lanes) : null,
      corner: make('path', { class: 'tt-flag-corner', 'stroke-width': STROKE * 0.72 }, corner),
      cornerGroup: corner,
      faces: S.HULL_FACES.map(() => make('polygon', { class: 'tt-face' }, faces)),
      flag: make('polygon', { class: 'tt-flag-chamber' }, flag),
      flagGroup: flag,
      mirror: make('polygon', { class: 'tt-mirror-disc' }, mirror),
      inside: make('line', { class: 'tt-axis-inside' }, axisFar),
      far: axisEnd(axisFar),
      near: axisEnd(axisNear),
      axisGroups: [axisFar, axisNear],
      edges: S.EDGES.map(() => make('line', { class: 'tt-edge', 'stroke-width': STROKE }, edges)),
      outline: make('path', { class: 'tt-outline', 'stroke-width': STROKE }, edges),
      center: make('circle', { class: 'tt-center', cx: CENTER, cy: CENTER, r: 0 }, marks),
    };
  };

  // T: the full linear map (view · move · position). fx: overlays.
  const draw = (scene, S, T, fx) => {
    const P = S.V.map(v => mvec(T, v));

    // How much each face faces the viewer, from its projected (Newell) normal.
    // On a Petrial these are the faces of the polyhedron it came from.
    const front = frontOf(S, P, T);
    const petrial = scene.form === 'petrial', looped = scene.form !== 'solid';

    // The ink wireframe, for a convex solid. sk, from 0 to 1, thins it to a
    // faint skeleton with sharp corners; bare takes even that away.
    const sk = fx.skeleton === undefined ? (looped ? 1 : 0) : fx.skeleton;
    const bare = fx.bare === undefined ? (looped ? 1 : 0) : fx.bare;
    const ink = fx.ink === undefined ? 1 : fx.ink;
    scene.edgesGroup.style.opacity = ink * (1 - 0.55 * sk) * (1 - bare);
    const width = f2(STROKE * (1 - 0.7 * sk));

    // Rounded outline; edges at its corners end on the curve.
    const Q = P.map(screen);
    const hull = outline(Q);
    scene.outline.setAttribute('d', hull.d);
    scene.outline.style.opacity = 1 - sk;
    scene.clip.setAttribute('d', hull.d || 'M0,0');
    const cut = (i, j) => (hull.at.has(i) ? (1 - sk) * cutBack(hull.at.get(i), Q[j]) : 0);
    const segment = (i, j) => trim(Q[i], Q[j], cut(i, j), cut(j, i));
    const edgeFront = k => { const [f1, f2] = S.EDGE_FACES[k]; return Math.max(front[f1], front[f2]); };

    S.EDGES.forEach(([i, j], k) => {
      const [a, b] = segment(i, j);
      setLine(scene.edges[k], a, b, S.dashes, edgeFront(k));
      scene.edges[k].setAttribute('stroke-width', width);
    });

    // Off the ink, every face is a colored loop: a Petrial's Petrie polygons
    // (set apart, crossing over and under), or a star polyhedron's faces.
    if (looped) {
      const base = fx.loops === undefined ? 1 : fx.loops, vis = id => front[id];
      const spot = fx.spot === null || fx.spot === undefined ? null : fx.spot;
      const pick = k => base * (spot === null || spot === k ? 1 : 0.07);
      const through = k => (spot === null ? HIDDEN : spot === k ? 0.85 : 0);
      if (petrial) {
        drawGaps(scene.woven, S.LOOPS.cross, drawLoops(scene.woven.els, S.LOOPS.petrie, T, 1, INSET, vis, null, pick, 1, through, LIFT));
      } else {
        drawLoops(scene.loops, S.LOOPS.faces, T, 1, INSET, vis, null, pick, 1, through);
      }
    }

    // Off the ink: the flag's half-edge, and a tick along the face's next edge.
    if (fx.flag && looped) {
      const { vertex, other, prev } = petrial ? S.petrialFlag : S.faceFlag;
      const q = Q[vertex], m = [(q[0] + Q[other][0]) / 2, (q[1] + Q[other][1]) / 2];
      const t = [q[0] + 0.28 * (Q[prev][0] - q[0]), q[1] + 0.28 * (Q[prev][1] - q[1])];
      scene.corner.setAttribute('d', `M${pt(m)}L${pt(q)}L${pt(t)}`);
      scene.corner.style.opacity = 0.35 + 0.6 * edgeFront(S.edgeIndex.get(`${vertex},${other}`));
    }
    scene.cornerGroup.style.display = fx.flag && looped ? '' : 'none';

    // The marked flag, drawn as its chamber: the triangle on the vertex, the
    // edge's midpoint and the face's center. Faint when it is on the back.
    if (fx.flag && !looped) {
      const { vertex, other, face } = S.flag;
      const ids = S.FACES[face].ids;
      const mid = [(Q[vertex][0] + Q[other][0]) / 2, (Q[vertex][1] + Q[other][1]) / 2];
      const ctr = [ids.reduce((s, i) => s + Q[i][0], 0) / ids.length, ids.reduce((s, i) => s + Q[i][1], 0) / ids.length];
      scene.flag.setAttribute('points', [Q[vertex], mid, ctr].map(pt).join(' '));
      scene.flag.style.opacity = 0.28 + 0.62 * front[face];
    }
    scene.flagGroup.style.display = fx.flag && !looped ? '' : 'none';

    // Translucent faces while moving, as in the loader.
    // (The hull's faces, so a star glows as softly as a convex solid.)
    S.HULL_FACES.forEach((f, k) => {
      const el = scene.faces[k];
      if (fx.fill > 0.001) {
        el.setAttribute('points', f.ids.map(i => pt(Q[i])).join(' '));
        el.style.opacity = fx.fill;
      } else {
        el.style.opacity = 0;
      }
    });

    // Rotation axis: fixed by the move, so drawn with the view alone. Each end
    // gets a pin where it leaves the surface.
    const showAxis = fx.axis && fx.axisAlpha > 0.001;
    scene.axisGroups.forEach(el => { el.style.display = showAxis ? '' : 'none'; });
    if (showAxis) {
      const ends = fx.ends.map(({ dir, r }) => ({ s: mvec(fx.view, dir), r }));
      if (ends[0].s[2] < ends[1].s[2]) { ends.reverse(); }
      const pins = ends.map(e => scale(e.s, e.r));
      [[scene.near, ends[0], 1], [scene.far, ends[1], 0.45]].forEach(([el, e, depth], k) => {
        const tip = scale(e.s, AXIS_REACH);
        el.line.setAttribute('x1', sx(pins[k]));
        el.line.setAttribute('y1', sy(pins[k]));
        el.line.setAttribute('x2', sx(tip));
        el.line.setAttribute('y2', sy(tip));
        el.line.style.opacity = fx.axisAlpha * depth;
        el.pin.setAttribute('cx', sx(pins[k]));
        el.pin.setAttribute('cy', sy(pins[k]));
        el.pin.style.opacity = fx.axisAlpha * depth;
      });
      scene.inside.setAttribute('x1', sx(pins[0]));
      scene.inside.setAttribute('y1', sy(pins[0]));
      scene.inside.setAttribute('x2', sx(pins[1]));
      scene.inside.setAttribute('y2', sy(pins[1]));
      scene.inside.style.opacity = fx.axisAlpha * 0.7;
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
      scene.mirror.setAttribute('points', pts(ring));
      scene.mirror.style.opacity = fx.mirrorAlpha;
    } else {
      scene.mirror.style.opacity = 0;
    }

    scene.center.setAttribute('r', (14 * (fx.centerAlpha || 0)).toFixed(2));
    scene.center.style.opacity = fx.centerAlpha || 0;
  };


  /* ---------- Moves ---------- */

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // What to draw for the move h: its axis (with where it leaves the solid),
  // its mirror, or the center.
  const overlayFor = (S, Gr, h) => {
    const g = Gr.G[h];
    if (h === 0) { return {}; }
    if (g.inversion) { return { center: true }; }
    const ends = [g.axis, scale(g.axis, -1)].map(dir => ({ dir, r: S.surface(dir) }));
    if (g.proper) { return { axis: g.axis, ends }; }
    return { mirror: g.axis, axis: Math.abs(g.angle) < EPS ? null : g.axis, ends };
  };

  // A move animates the identity into the group element h. Rotations turn
  // about their axis. Orientation-reversing elements also pass the solid
  // through the plane perpendicular to the axis, scaling it by cos(πe)
  // along the axis: the shadow of a half-turn through a fourth dimension.
  const buildMove = (S, Gr, h, now) => {
    const g = Gr.G[h];
    let at, dur;
    if (g.proper) {
      at = e => rotation(g.axis, g.angle * e);
      dur = 620 + 2.6 * Math.abs(g.angle) * DEG;
    } else if (g.inversion) {
      at = e => { const c = Math.cos(Math.PI * e); return [c, 0, 0, 0, c, 0, 0, 0, c]; };
      dur = 950;
    } else {
      at = e => mmul(rotation(g.axis, g.angle * e), stretch(g.axis, Math.cos(Math.PI * e)));
      dur = 980 + 2 * Math.abs(g.angle) * DEG;
    }
    if (reducedMotion.matches) { dur = 1; }
    return { h, at, dur, t0: now, overlay: overlayFor(S, Gr, h) };
  };

  // Overlays fade in fast and out slow.
  const envelope = t => smoothstep(0, 0.14, t) * (1 - smoothstep(0.72, 1, t));


  /* ---------- Page ---------- */

  const capitalize = s => s[0].toUpperCase() + s.slice(1);

  // Families of polyhedra, stepped through with the up and down arrows; their
  // members with the left and right arrows. One family so far.
  const FAMILIES = [
    { name: 'Platonic solids', members: ['tetrahedron', 'cube', 'octahedron', 'dodecahedron', 'icosahedron'] },
  ];

  const solids = {};
  const solidOf = name => {
    if (!solids[name]) {
      const S = buildSolid(name);
      // The marked flag: on the face turned most toward the viewer at rest.
      const V0 = qmat(S.q0);
      const face = S.FACES.reduce((b, f, k) => (mvec(V0, f.normal)[2] > mvec(V0, S.FACES[b].normal)[2] ? k : b), 0);
      const ids = S.FACES[face].ids;
      S.flag = { face, vertex: ids[0], other: ids[1] };
      // Faces as lane sets: the Petrie polygons, the faces themselves, and the
      // dual's faces (around each vertex, on the dual's own vertices).
      const corners = S.FACES.map(f => f.ids.map((v, j) => cornerOffset(f.ids.map(i => S.V[i]), j)));
      // The face in which a, v, b are consecutive (either way round).
      const faceAt = (a, v, b) => S.FACES.findIndex(f => {
        const ids = f.ids, m = ids.indexOf(v), x = ids[(m + 1) % ids.length], y = ids[(m + ids.length - 1) % ids.length];
        return m >= 0 && ((x === a && y === b) || (x === b && y === a));
      });
      S.LOOPS = {
        faces: S.FACES.map((f, k) => ({ nodes: f.ids.map((v, j) => ({ base: S.V[v], off: corners[k][j] })), vis: f.ids.map(() => k), mids: false })),
        // At each vertex a Petrie polygon turns through the one face holding
        // both of its edges there; it takes that face's corner.
        // Along each edge it runs parallel to the edge on that face's side,
        // then at the middle jogs steeply across to the next face's side,
        // through a point on the edge itself. The two Petrie polygons on an
        // edge trade sides there, in one short, steep crossing.
        petrie: S.PETRIE.map(poly => {
          const n = poly.length;
          const fs = poly.map((v, i) => faceAt(poly[(i + n - 1) % n], v, poly[(i + 1) % n]));
          const inward = (fi, a, b) => {
            const pa = S.V[a], pb = S.V[b], u = unit(sub(pb, pa)), d = sub(S.FACES[fi].center, scale(add(pa, pb), 0.5));
            return unit(sub(d, scale(u, dot(d, u))));
          };
          const nodes = [], vis = [];
          poly.forEach((v, i) => {
            const w = poly[(i + 1) % n], F = fs[i], G = fs[(i + 1) % n];
            const mid = scale(add(S.V[v], S.V[w]), 0.5), u = unit(sub(S.V[w], S.V[v]));
            nodes.push(
              { base: S.V[v], off: corners[F][S.FACES[F].ids.indexOf(v)] },
              { base: sub(mid, scale(u, JOG)), off: inward(F, v, w) },
              { base: mid, off: [0, 0, 0] },
              { base: add(mid, scale(u, JOG)), off: inward(G, v, w) },
            );
            vis.push(F, F, G, G);
          });
          return { nodes, vis, mids: false };
        }),
        // The dual's faces, around each vertex, on the dual's own vertices.
        dual: S.DUAL.faces.map((fs, v) => {
          const pts = fs.map(f => S.DUAL.verts[f]);
          return { nodes: pts.map((q, j) => ({ base: q, off: cornerOffset(pts, j) })), vis: fs.map(() => v), mids: false };
        }),
      };
      const P0 = S.PETRIE[0], F0 = S.FACES[0].ids;
      S.petrialFlag = { vertex: P0[0], other: P0[1], prev: P0[P0.length - 1] };
      S.faceFlag = { vertex: F0[0], other: F0[1], prev: F0[F0.length - 1] };
      // The two Petrie loops that cross at each edge, and where in each.
      const along = S.EDGES.map(() => []);
      S.PETRIE.forEach((poly, k) => poly.forEach((v, i) => {
        along[S.edgeIndex.get(`${v},${poly[(i + 1) % poly.length]}`)].push({ loop: k, j: 4 * i + 2 });
      }));
      S.LOOPS.cross = along;
      solids[name] = S;
    }
    return solids[name];
  };

  const groups = {};
  const groupOf = name => {
    if (!groups[name]) {
      const S = solidOf(name), Gr = buildGroup(S);
      // The symmetries are the hull's. Only a convex solid's hull faces are
      // its faces; otherwise they are named by their shape.
      const F = { 3: 'triangle', 4: 'square', 5: 'pentagon' }[S.HULL_FACES[0].ids.length];
      const named = { rotations: classesOf(S, Gr, Gr.R, F), all: classesOf(S, Gr, 2 * Gr.R, F) };
      groups[name] = {
        Gr,
        classes: {
          solid: S.convex ? { rotations: classesOf(S, Gr, Gr.R), all: classesOf(S, Gr, 2 * Gr.R) } : named,
          faces: named,
          petrial: named,
        },
      };
    }
    return groups[name];
  };

  // A still drawing of a solid at rest: its neighbors in the carousel.
  const still = name => {
    const S = solidOf(name);
    const svg = make('svg', { viewBox: VIEWBOX, 'aria-hidden': 'true', focusable: 'false' });
    const V0 = qmat(S.q0);
    draw(buildScene(svg, S), S, V0, { view: V0, fill: 0 });
    return svg;
  };

  // Position in the carousel, wrapped into [-N/2, N/2).
  const wrap = (o, N) => ((((o + N / 2) % N) + N) % N) - N / 2;

  const init = () => {
    const toy = document.querySelector('.tt-toy');
    if (!toy) { return; }
    const svg = toy.querySelector('svg');
    const strip = document.querySelector('.tt-strip');
    const ghostLayer = document.querySelector('.tt-ghosts');
    const picker = document.querySelector('.tt-picker');
    const familyLabel = document.getElementById('tt-family');
    const main = document.querySelector('.tt-main');
    const margin = document.querySelector('.tt-margin');
    const keys = document.querySelector('.tt-keys');
    const caption = document.getElementById('tt-cap');
    const status = document.getElementById('tt-status');
    const panel = document.getElementById('tt-elements');
    const say = document.getElementById('tt-say');     // for screen readers only

    const state = {
      family: 0,
      member: 0,
      solid: null, group: null, classes: null, scene: null,
      form: 'solid',          // 'solid' (convex, ink), 'faces' (star), or 'petrial'
      view: [1, 0, 0, 0],
      zoom: 1,                // the dual settles from its midsphere size
      spot: null,             // a Petrie polygon picked out by its swatch
      spotPinned: null,
      pos: 0,                 // the product of every move so far
      current: 0,             // the symmetry performed last (orange dot)
      mode: 'rotations',      // or 'all'
      flag: false,
      autoplay: false,
      moves: 0,
      visited: new Set(),     // symmetries performed so far
      queue: [],
      anim: null,
      spin: null,
      viewEase: null,         // a view settling into the rest view
      drag: null,
      preview: null,
    };

    let map = null;                   // Figure 2, made below
    const size = () => (state.mode === 'all' ? 2 * state.group.R : state.group.R);
    const randomMove = () => 1 + Math.floor(Math.random() * (size() - 1));   // never the identity
    const classText = i => {
      const c = state.mode === 'rotations' && i < state.group.R ? state.classes.rotations : state.classes.all;
      return c.list[c.owner[i]].text;
    };

    /* Frame loop: runs only while something is moving. */
    let raf = 0;
    const wake = () => { if (!raf) { raf = requestAnimationFrame(frame); } };

    const frame = now => {
      raf = 0;
      let busy = false;
      let fx = { flag: state.flag, fill: 0, spot: state.spot };

      if (state.viewEase) {
        const { from, t0, dur } = state.viewEase, t = clamp((now - t0) / dur, 0, 1);
        state.view = slerp(from, state.solid.q0, EASE_VIEW(t));
        if (t >= 1) { state.view = state.solid.q0; state.viewEase = null; } else { busy = true; }
      }

      if (state.spin) {
        const dt = Math.min(48, now - state.spin.last);
        state.spin.last = now;
        const w = state.spin.w, speed = len(w);
        state.view = qnorm(qmul(qaxis(scale(w, 1 / speed), speed * dt), state.view));
        state.spin.w = scale(w, Math.exp(-dt / 320));
        if (speed < 4e-5) { state.spin = null; } else { busy = true; }
      }

      // A Petrial or dual in progress: it sets fills and fades, may swap the
      // solid underneath, and draws its face loops on top.
      let opDraw = null;
      if (op) {
        const r = op.update(now - op.t0, fx);
        if (r === 'done') { finishOp(); } else { opDraw = r; busy = true; }
      }
      if (!state.anim && !op && state.queue.length) { startNext(now); }

      const S = state.solid, Gr = state.group;
      const V = qmat(state.view);
      let A = I3;
      fx.view = V;

      if (state.anim) {
        const m = state.anim;
        const t = clamp((now - m.t0) / m.dur, 0, 1);
        if (t >= 1) {
          finish();
        } else {
          const env = envelope(t);
          A = m.at(EASE(t));
          fx = { ...fx, ...m.overlay, fill: 0.1 * env, axisAlpha: env, mirrorAlpha: env, centerAlpha: m.overlay.center ? env : 0 };
          busy = true;
        }
      } else if (state.preview !== null && !op) {
        const o = overlayFor(S, Gr, state.preview);
        fx = { ...fx, ...o, axisAlpha: 0.55, mirrorAlpha: 0.55, centerAlpha: o.center ? 0.6 : 0 };
      }

      const T = mmul(mmul(V, A), Gr.G[state.pos].M);
      draw(state.scene, S, state.zoom === 1 ? T : T.map(x => x * state.zoom), fx);
      if (opDraw) { opDraw(); }
      if (busy || state.queue.length) { wake(); }
    };

    // Every move performs one symmetry g, always the same motion on screen
    // whatever came before: a turn about g's axis, a pass through g's mirror,
    // or (for the identity) nothing but a flash of the faces.
    const startNext = now => {
      const Gr = state.group;
      if (!state.queue.length) { return; }
      const item = state.queue.shift();
      const g = item.g === undefined ? randomMove() : item.g;
      const next = Gr.TIMES[g][state.pos];
      state.anim = { ...buildMove(state.solid, Gr, g, now), g, next };
      state.current = g;
      state.moves += 1;
      say.textContent = g === 0 ? 'The identity.' : `${capitalize(classText(g))}.`;
    };

    const finish = () => {
      state.pos = state.anim.next;
      state.visited.add(state.anim.g);
      state.anim = null;
      renderPanel();
      if (pendingOp) { const k = pendingOp; pendingOp = null; operate(k); return; }
      if (state.autoplay && !state.queue.length) { scheduleAutoplay(); }
    };

    let autoTimer = 0;
    const enqueue = item => {
      if (trans || op) { return; }                  // not while changing solids
      if (state.queue.length < 3) { state.queue.push(item); }
      clearTimeout(autoTimer);
      wake();
    };
    const scheduleAutoplay = () => {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => { if (state.autoplay && !state.anim) { enqueue({}); } }, 420);
    };

    /* Words for Schläfli symbols. p, q and h are strings: '5/2', '10/3'. */
    const SKEW = { 4: 'skew quadrilaterals', 6: 'skew hexagons', 10: 'skew decagons', '10/3': 'skew decagrams' };
    const sym = (a, b, r) => `{${a},&nbsp;${b}}${r ? `<sub>${r}</sub>` : ''}`;
    const baseForm = S => (S.convex ? 'solid' : 'faces');
    const titleOf = (S, form) => (form === 'petrial' ? `Petrial of the ${S.title}` : S.title);
    const title = () => titleOf(state.solid, state.form);
    const keyOfNode = (name, form) => `${name}${form === 'petrial' ? '-petrial' : ''}`;

    // Figure 1's caption names the polyhedron and its Schläfli symbol.
    const describeSolid = () => {
      const S = state.solid, d = S.def, petrial = state.form === 'petrial';
      const t = title();
      toy.setAttribute('aria-label', `${capitalize(t)}. Press to apply a random symmetry.`);
      caption.innerHTML = `The ${t}, ${petrial ? sym(d.h, d.q, d.p) : sym(d.p, d.q)}.`;
      const kind = S.convex ? FAMILIES[state.family].name : 'Kepler–Poinsot polyhedra';
      familyLabel.textContent = petrial ? `Petrials of the ${kind}` : kind;
      buildSwatches();
      try { history.replaceState(null, '', `#${keyOfNode(S.name, state.form)}`); } catch { /* file:// in some browsers */ }
    };

    // Off the ink, one swatch per face: hover to pick out that face, click
    // to keep it picked out.
    const swatchRow = document.querySelector('.tt-swatches');
    const swatchBox = swatchRow.querySelector('.tt-swatch-list');
    const buildSwatches = () => {
      const looped = state.form !== 'solid';
      swatchRow.hidden = !looped;
      swatchBox.replaceChildren();
      if (!looped) { return; }
      const n = (state.form === 'petrial' ? state.solid.LOOPS.petrie : state.solid.LOOPS.faces).length;
      for (let k = 0; k < n; k++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tt-swatch';
        b.style.setProperty('--swatch', loopColor(k, n));
        b.setAttribute('aria-label', `Face ${k + 1} of ${n}`);
        b.setAttribute('aria-pressed', 'false');
        const set = spot => { state.spot = spot; wake(); };
        b.addEventListener('pointerenter', () => set(k));
        b.addEventListener('pointerleave', () => set(state.spotPinned));
        b.addEventListener('focus', () => set(k));
        b.addEventListener('blur', () => set(state.spotPinned));
        b.addEventListener('click', () => {
          state.spotPinned = state.spotPinned === k ? null : k;
          swatchBox.querySelectorAll('.tt-swatch').forEach((x, i) => x.setAttribute('aria-pressed', String(i === state.spotPinned)));
          set(state.spotPinned === null ? k : state.spotPinned);
        });
        swatchBox.append(b);
      }
    };

    // Switch to a polyhedron. keep: the same symmetries carry over (a
    // Petrial, a facetting), so the position and the dots stay, re-indexed
    // into the new solid's group. moveMap: false when an operation is already
    // moving the map's marker.
    const setSolid = (name, { form = null, view = null, keep = false, quiet = false, keepMotion = false, moveMap = true } = {}) => {
      if (!DEFS[name]) { name = 'dodecahedron'; }
      const S = solidOf(name), { Gr, classes } = groupOf(name);
      form = form || baseForm(S);
      // A star's place in the carousel is the Platonic solid whose vertices it
      // shares: the icosahedron, or (for the great stellated dodecahedron) the
      // dodecahedron.
      const home = S.convex ? name : S.V.length === 20 ? 'dodecahedron' : 'icosahedron';
      const k = FAMILIES[state.family].members.indexOf(home);
      let kept = { pos: 0, current: 0, moves: 0, visited: new Set() };
      if (keep && state.group) {
        const old = state.group, re = i => Gr.find(old.G[i].M);
        kept = { pos: re(state.pos), current: re(state.current), moves: state.moves, visited: new Set([...state.visited].map(re)) };
      }
      Object.assign(state, {
        member: k >= 0 ? k : state.member,
        solid: S, form, group: Gr, classes: classes[form], scene: buildScene(svg, S, form),
        view: view || S.q0, zoom: 1, ...kept,
        ...(keepMotion ? {} : { spin: null, viewEase: null }),
        queue: [], anim: null, preview: null, spot: null, spotPinned: null,
      });
      describeSolid();
      clearTimeout(autoTimer);
      buildPanel();
      syncButtons();
      if (moveMap && map) { map.go(keyOfNode(name, form)); }
      wake();
      if (state.autoplay && !quiet) { scheduleAutoplay(); }
    };
    const select = (name, quiet) => setSolid(name, { quiet });

    /* Operations: p the Petrial, d the dual, f the facetting
       (R0, R1, R2) ↦ (R0, R1R2R1, R2). Each traces the new faces in color
       over the old figure, then takes the old faces away, and leaves the
       figure on the new polyhedron. */
    const opSvg = toy.querySelector('.tt-op');
    let op = null, pendingOp = null;

    // Faces trace out together, staggered; each pen moves at a steady pace.
    // Petrie polygons go more nearly one at a time.
    const traceTimes = (n, segs, oneByOne) => {
      const each = reducedMotion.matches ? 1 : oneByOne ? Math.min(1200, 300 + 70 * segs) : Math.min(1600, 300 + 130 * segs);
      const gap = reducedMotion.matches || n < 2 ? 0 : oneByOne ? Math.min(each * 0.6, 3400 / (n - 1)) : Math.min(220, 900 / (n - 1));
      return { each, starts: Array.from({ length: n }, (x, k) => k * gap), end: (n - 1) * gap + each };
    };
    const progressAt = (times, loops, t) => loops.map((loop, k) => segmentsOf(loop) * EASY_EASE(clamp((t - times.starts[k]) / times.each, 0, 1)));
    const pause = ms => (reducedMotion.matches ? 1 : ms);

    const shake = () => {
      if (reducedMotion.matches || !strip.animate) { return; }
      strip.animate([0, -8, 7, -4, 2, 0].map(x => ({ transform: `translateX(${x}px)` })), { duration: 380, easing: 'ease-out' });
    };

    const finishOp = () => {
      const o = op;
      op = null;
      opSvg.replaceChildren();
      state.zoom = 1;
      if (o.done) { o.done(); }
      wake();
      if (state.autoplay) { scheduleAutoplay(); }
    };

    // Where an operation leads from here, or why it leads nowhere.
    const destination = kind => {
      const S = state.solid, d = S.def, petrial = state.form === 'petrial', t = title();
      if (kind === 'petrial') { return { name: S.name, form: petrial ? baseForm(S) : 'petrial' }; }
      if (kind === 'dual') {
        if (!petrial) { return { name: d.dual, form: baseForm(solidOf(d.dual)) }; }
        // The dual of {h, q}_p is {q, h}_p, but it would need a vertex at the
        // center of each skew face, and those centers all sit at the middle.
        return { refuse: `The dual of the ${t} would be ${sym(d.q, d.h, d.p)}, which cannot be built in space: `
          + `its vertices would sit at the centers of the ${SKEW[d.h]}, and those centers all coincide at the middle.` };
      }
      if (d.facet === 'same') {
        return { refuse: `Facetting leaves the ${t} as it is: with three faces at each vertex, <i>R</i><sub>1</sub><i>R</i><sub>2</sub><i>R</i><sub>1</sub> = <i>R</i><sub>2</sub><i>R</i><sub>1</sub><i>R</i><sub>2</sub>, `
          + 'so (<i>R</i><sub>0</sub>, <i>R</i><sub>1</sub><i>R</i><sub>2</sub><i>R</i><sub>1</sub>, <i>R</i><sub>2</sub>) is only a change of base flag.' };
      }
      if (d.facet === 'degenerate') {
        return { refuse: `Facetting the ${t} would pair each edge at a vertex with the edge opposite it, `
          + 'so only two of the new faces would meet at each vertex: that is no polyhedron.' };
      }
      return { name: d.facet, form: petrial ? 'petrial' : baseForm(solidOf(d.facet)) };
    };

    const operate = kind => {
      if (op || trans) { return; }
      if (state.anim || state.queue.length) { state.queue.length = 0; pendingOp = kind; return; }
      const to = destination(kind);
      if (to.refuse) { shake(); say.innerHTML = to.refuse; if (map) { map.wobble(); } return; }

      const S = state.solid, from = state.form;
      clearTimeout(autoTimer);
      state.preview = null;
      // The operation follows the live view, so a drag or a coasting spin
      // carries straight through it: each frame, the figure being operated on
      // is the current view times `off` (its position when the operation
      // began, re-expressed if the solid underneath is swapped).
      const live = () => mmul(qmat(state.view), op.off);
      const frontNow = (X, T) => frontOf(X, X.V.map(v => mvec(T, v)), T);
      opSvg.replaceChildren();
      const layer = make('g', {}, opSvg);
      const TS = solidOf(to.name);

      if (kind !== 'dual') {
        // Re-facing (p and f): the same vertices and edges, new faces. The old
        // faces go quiet first: a convex solid's ink thins and its faces come
        // forward as plain loops; colored faces fade to gray. Then the new
        // faces trace out nearly one at a time, each bolder while it traces,
        // over a light fill of its own plane if it is planar, so you can see
        // which face it is. Last the old faces go, and onto a convex solid the
        // new faces close in onto the edges as the ink comes back.
        const toPetrial = to.form === 'petrial';
        const newSet = toPetrial ? TS.LOOPS.petrie : TS.LOOPS.faces;
        const count = newSet.length;
        const segs = newSet.map(segmentsOf);
        const plain = from === 'solid' ? makeLoops(S.LOOPS.faces, layer, true) : null;
        const fills = toPetrial ? null : TS.FACES.map((f, k) => {
          const el = make('polygon', { class: 'tt-trace-fill' }, layer);
          el.style.fill = loopColor(k, count);
          return el;
        });
        const woven = toPetrial ? makeWoven(newSet, layer) : null;
        const els = toPetrial ? woven.els : makeLoops(newSet, layer);
        const times = traceTimes(count, Math.max(...segs), true);
        const t1 = pause(from === 'solid' ? 450 : 400);
        const tA = t1 + times.end, tB = tA + pause(700), tC = to.form === 'solid' ? tB + pause(800) : tB;
        if (from !== 'solid') { state.scene.lanesGroup.classList.add('is-muted'); }
        op = {
          t0: performance.now(),
          total: tC,
          off: state.group.G[state.pos].M,
          update(t, fx) {
            if (t >= tB && !this.swapped && to.form === 'solid') {
              this.swapped = true;
              setSolid(to.name, { form: to.form, view: state.view, keep: true, keepMotion: true, moveMap: false });
            }
            const settle = this.swapped ? EASY_EASE(clamp((t - tB) / (tC - tB), 0, 1)) : 0;
            if (this.swapped) {
              fx.skeleton = 1 - settle;
              fx.bare = 1 - settle;
            } else if (from === 'solid') {
              fx.skeleton = EASY_EASE(clamp(t / t1, 0, 1));
              fx.bare = smoothstep(tA, tB, t);              // the skeleton goes with the faces
            } else {
              // The old colored faces, grayed, sit back while the new ones trace.
              fx.loops = (1 - 0.55 * smoothstep(0, t1, t)) * (1 - smoothstep(tA, tB, t));
            }
            if (t >= tC) { return 'done'; }
            const T = live(), oldFront = frontNow(S, T), newFront = frontNow(TS, T), newVis = id => newFront[id];
            const faces = 0.7 * smoothstep(0, Math.max(1, t1), t) * (1 - smoothstep(tA, tB, t));
            const prog = segs.map((n, k) => n * EASY_EASE(clamp((t - t1 - times.starts[k]) / times.each, 0, 1)));
            const bold = k => 1 + 0.7 * Math.sin(Math.PI * clamp(prog[k] / segs[k], 0, 1));
            return () => {
              if (plain) { drawLoops(plain, S.LOOPS.faces, T, 1, INSET, id => oldFront[id], null, faces); }
              if (fills) {
                fills.forEach((el, k) => {
                  const start = t1 + times.starts[k], stop = start + times.each;
                  const a = 0.17 * smoothstep(start, start + 250, t) * (1 - smoothstep(stop + 150, stop + 900, t)) * (1 - settle);
                  el.style.opacity = a.toFixed(3);
                  if (a > 0.001) { el.setAttribute('points', TS.FACES[k].ids.map(i => pt(screen(mvec(T, TS.V[i])))).join(' ')); }
                });
              }
              if (toPetrial) {
                drawGaps(woven, TS.LOOPS.cross, drawLoops(els, newSet, T, 1, INSET, newVis, prog, 1, bold, HIDDEN, LIFT));
              } else {
                drawLoops(els, newSet, T, 1, INSET * (1 - settle), newVis, prog, 1 - settle, bold);
              }
            };
          },
          done() {
            if (!this.swapped) {
              setSolid(to.name, { form: to.form, view: state.view, keep: true, keepMotion: true, moveMap: false });
            }
          },
        };
      } else {
        // The dual: a regular q-gon (or q-gram) around each vertex, its edges
        // crossing the edges at their midpoints. Then the original goes, and
        // the dual settles to its usual size: closing onto its edges in ink
        // if it is convex, becoming its own face loops if not.
        const D = S.DUAL, L = S.LOOPS;
        const Rd = matchRotation(TS.V, D.verts.map(unit)), qRd = matq(Rd);
        // Color each traced face as the target colors the face it becomes.
        const colors = S.V.map(v => {
          let best = 0, bestDot = -2;
          TS.FACES.forEach((f, j) => { const c = dot(unit(mvec(Rd, f.center)), unit(v)); if (c > bestDot) { bestDot = c; best = j; } });
          return loopColor(best, TS.FACES.length);
        });
        const els = makeLoops(L.dual, layer);
        els.forEach((segs, v) => segs.forEach(el => { el.style.stroke = colors[v]; }));
        const times = traceTimes(L.dual.length, segmentsOf(L.dual[0])), t1 = from === 'solid' ? pause(450) : 0;
        const tA = t1 + times.end, tB = tA + pause(650), tC = tB + pause(800);
        const toInk = to.form === 'solid';
        if (from !== 'solid') { state.scene.lanesGroup.classList.add('is-muted'); }
        // Reciprocation can make the dual much larger than the original (the
        // great dodecahedron's is 1.6 times its size): pull back so it fits
        // while it traces, and come back in as it settles.
        const fit = Math.min(1, 1.08 / Math.max(1, D.c)), tz = pause(500);
        op = {
          t0: performance.now(),
          total: tC,
          off: state.group.G[state.pos].M,
          update(t, fx) {
            let z = 1, settle = 0;
            const back = 1 + (fit - 1) * EASY_EASE(clamp(t / tz, 0, 1));
            if (t < tB) {
              // The original thins to a skeleton (or its loops dim) while the
              // dual traces, then goes.
              if (from === 'solid') { fx.skeleton = EASY_EASE(clamp(t / t1, 0, 1)); fx.ink = 1 - smoothstep(tA, tB, t); } else { fx.loops = 1 - smoothstep(tA, tB, t); }
              z = back;
              state.zoom = back;
            } else {
              if (!this.swapped) {
                // Swap in the dual, viewed so that nothing moves.
                this.swapped = true;
                setSolid(to.name, { form: to.form, view: qnorm(qmul(state.view, qRd)), keepMotion: true, moveMap: false });
                this.off = mmul(transpose(Rd), this.off);
              }
              settle = EASY_EASE(clamp((t - tB) / (tC - tB), 0, 1));
              const out = fit + (1 - fit) * settle;
              z = out * (1 + (1 / D.c - 1) * settle);
              this.z = z;
              state.zoom = D.c * z;
              if (toInk) { fx.ink = settle; } else { fx.loops = settle; }
            }
            if (t >= tC) { return 'done'; }
            const T = live(), ahead = S.V.map(v => smoothstep(-EDGE_ON, EDGE_ON, mvec(T, unit(v))[2]));
            const s = toInk ? INSET * (1 - settle) : INSET;
            return () => drawLoops(els, L.dual, T, z, s, id => ahead[id], progressAt(times, L.dual, t - t1), 1 - settle);
          },
        };
        op.dualPts = D.verts;
      }
      op.solid0 = S;                     // the figure operated on, for the console and tests
      // The marker flows to the new node only as the operation finishes.
      if (map) { map.go(keyOfNode(to.name, to.form), pause(850), Math.max(0, op.total - pause(950))); }
      wake();
    };

    /* The carousel: neighbors faded to either side, an easy-ease slide
       between them. Up and down change family the same way, without
       neighbors. */
    const reduced = () => reducedMotion.matches;
    const ghosts = new Map();
    let trans = null, pending = null;

    const syncGhosts = () => {
      const members = FAMILIES[state.family].members;
      for (const name of members) {
        if (ghosts.has(name)) { continue; }
        const el = document.createElement('div');
        el.className = 'tt-ghost';
        el.append(still(name));
        el.addEventListener('click', () => slideTo(FAMILIES[state.family].members.indexOf(name)));
        ghosts.set(name, el);
        ghostLayer.append(el);
      }
    };

    const metrics = () => {
      const W = strip.clientWidth, w = toy.offsetWidth;
      const compact = W < w * 1.55;                 // phones: no room for neighbors
      const side = compact ? 0.8 : 0.34;
      return { W, w, h: toy.offsetHeight, top: toy.offsetTop, compact, side, step: compact ? W * 0.9 : W / 2 - (w * side) / 2 - 4 };
    };

    // Place a drawing at carousel position o (0 is the middle), shifted down
    // by y, with its opacity scaled by fade.
    const placeAt = (el, o, y, m, fade = 1) => {
      const a = Math.abs(o);
      const x = Math.sign(o) * (a <= 1 ? a * m.step : m.step * (1 + 0.5 * (a - 1)));
      const k = a <= 1 ? 1 - (1 - m.side) * a : m.side * (1 - 0.25 * (a - 1));
      const rest = m.compact ? 0 : 0.22;
      const op = (a <= 1 ? 1 - (1 - rest) * a : rest * Math.max(0, 2 - a)) * fade;
      Object.assign(el.style, {
        width: `${m.w}px`,
        left: `${(m.W - m.w) / 2}px`,
        top: `${m.top}px`,
        transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${k.toFixed(4)})`,
        opacity: op.toFixed(3),
        filter: a > 0.02 ? `blur(${(1.1 * Math.min(a, 1.5)).toFixed(2)}px)` : 'none',
        visibility: op < 0.004 ? 'hidden' : 'visible',
        pointerEvents: Math.abs(a - 1) < 0.05 && op > 0.05 ? 'auto' : 'none',
      });
    };
    const hide = el => Object.assign(el.style, { visibility: 'hidden', opacity: 0, pointerEvents: 'none' });

    const layoutRest = (fade = 1) => {
      const m = metrics(), members = FAMILIES[state.family].members, N = members.length;
      members.forEach((name, k) => {
        const el = ghosts.get(name);
        if (k === state.member) { hide(el); } else { placeAt(el, wrap(k - state.member, N), 0, m, fade); }
      });
    };

    // A copy of the figure as it looks right now, to slide away.
    const snapshot = () => {
      const el = document.createElement('div');
      el.className = 'tt-ghost';
      el.append(svg.cloneNode(true));
      ghostLayer.append(el);
      return el;
    };

    const nudge = (dx, dy) => {
      if (reduced() || !strip.animate) { return; }
      strip.animate(
        [{ transform: 'none' }, { transform: `translate(${dx * 14}px, ${dy * 14}px)` }, { transform: 'none' }],
        { duration: 340, easing: 'ease-in-out' },
      );
    };

    const begin = t => {
      trans = { ...t, t0: performance.now() };
      // Sideways, the live figure itself slides in (so its view can ease);
      // a family change slides a still drawing in its place.
      if (t.kind === 'v') { toy.classList.add('is-away'); }
      // A family change slides through a window: clip above and below only.
      if (t.kind === 'v') { strip.style.clipPath = 'inset(0 -100vw)'; }
      requestAnimationFrame(tick);
    };

    const slide = d => {
      if (op) { return; }
      if (trans) { pending = ['h', d]; return; }
      const fam = FAMILIES[state.family], N = fam.members.length;
      if (N < 2 || !d) { nudge(Math.sign(d) || 1, 0); return; }
      const c0 = state.member, clone = snapshot(), from = state.view;
      select(fam.members[(((c0 + d) % N) + N) % N], true);
      // The new solid arrives turned the way the old one was, and settles
      // into its own rest view as it slides in.
      state.view = from;
      state.viewEase = reduced() ? null : { from, t0: performance.now(), dur: 1100 };
      if (!state.viewEase) { state.view = state.solid.q0; }
      begin({ kind: 'h', d, c0, clone, dur: reduced() ? 1 : 560 + 160 * (Math.abs(d) - 1) });
      wake();
    };
    const slideTo = k => { if (k >= 0 && k !== state.member) { slide(wrap(k - state.member, FAMILIES[state.family].members.length)); } };

    const switchFamily = d => {
      if (op) { return; }
      if (trans) { pending = ['v', d]; return; }
      const F = FAMILIES.length;
      if (F < 2) { nudge(0, d); return; }
      const clone = snapshot();
      const leaving = [...ghosts.values()].map(el => ({ el, op: Number(el.style.opacity) || 0 }));
      ghosts.clear();
      state.family = (((state.family + d) % F) + F) % F;
      const fam = FAMILIES[state.family];
      buildPicker();
      syncGhosts();
      select(fam.members.includes('dodecahedron') ? 'dodecahedron' : fam.members[0], true);
      begin({ kind: 'v', d, clone, leaving, dur: reduced() ? 1 : 620 });
    };

    const tick = now => {
      const t = clamp((now - trans.t0) / trans.dur, 0, 1), e = EASY_EASE(t);
      const m = metrics();
      if (trans.kind === 'h') {
        const { d, c0, clone } = trans, s = d * e;
        const members = FAMILIES[state.family].members, N = members.length;
        const target = (((c0 + d) % N) + N) % N;
        members.forEach((name, k) => {
          const el = ghosts.get(name);
          if (k === c0 || k === target) { hide(el); } else { placeAt(el, wrap(k - c0 - s, N), 0, m); }
        });
        placeAt(trans.clone, -s, 0, m);
        // The live figure stands in for the incoming neighbor.
        const o = d - s, a = Math.abs(o), k = a <= 1 ? 1 - (1 - m.side) * a : m.side;
        const x = Math.sign(o) * (a <= 1 ? a * m.step : m.step * (1 + 0.5 * (a - 1)));
        const rest = m.compact ? 0 : 0.22, op = a <= 1 ? 1 - (1 - rest) * a : rest * Math.max(0, 2 - a);
        Object.assign(toy.style, { transform: `translate(${x.toFixed(1)}px, 0) scale(${k.toFixed(4)})`, opacity: op.toFixed(3), filter: a > 0.02 ? `blur(${(1.1 * Math.min(a, 1.5)).toFixed(2)}px)` : 'none' });
      } else {
        const { d, clone, leaving } = trans, H = m.h;
        placeAt(clone, 0, -d * e * H, m, 1 - e);
        leaving.forEach(({ el, op }) => { el.style.opacity = (op * Math.max(0, 1 - 2 * e)).toFixed(3); });
        layoutRest(Math.max(0, 2 * e - 1));
        placeAt(ghosts.get(state.solid.name), 0, d * (1 - e) * H, m, e);
      }
      if (t < 1) { requestAnimationFrame(tick); return; }

      trans.clone.remove();
      (trans.leaving || []).forEach(({ el }) => el.remove());
      strip.style.clipPath = '';
      trans = null;
      toy.classList.remove('is-away');
      Object.assign(toy.style, { transform: '', opacity: '', filter: '' });
      layoutRest();
      alignPanel();
      if (state.autoplay) { scheduleAutoplay(); }
      if (pending) {
        const [kind, d] = pending;
        pending = null;
        if (kind === 'h') { slide(d); } else { switchFamily(d); }
      }
    };

    const buildPicker = () => {
      const fam = FAMILIES[state.family];
      familyLabel.textContent = fam.name;
      picker.replaceChildren();
      fam.members.forEach((name, k) => {
        if (k) {
          const sep = document.createElement('span');
          sep.className = 'sep';
          sep.setAttribute('aria-hidden', 'true');
          sep.textContent = '·';
          picker.append(sep);
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tt-btn';
        b.dataset.solid = name;
        b.textContent = capitalize(name);
        b.addEventListener('click', () => slideTo(k));
        picker.append(b);
      });
    };

    /* The symmetries start level with the top of the graphic. On one screen
       (wide), a long list rises only as far as it must to end above the
       bottom row: the key legend, and the credit under the list. */
    const wide = window.matchMedia('(min-width: 64rem)');
    const wider = window.matchMedia('(min-width: 78rem)');
    const leftAside = document.querySelector('.tt-left');
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
      if (leftAside) { leftAside.style.marginTop = wider.matches ? `${off}px` : ''; }
    };
    window.addEventListener('resize', () => { alignPanel(); if (!trans) { layoutRest(); } });
    if (document.fonts) { document.fonts.ready.then(() => { alignPanel(); layoutRest(); }); }

    /* Click for a symmetry; drag to turn the view. */
    let suppressClick = false;

    toy.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      enqueue({});
    });

    toy.addEventListener('pointerdown', e => {
      if (e.button !== 0) { return; }
      state.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: e.timeStamp, moved: false, w: [0, 0, 0] };
      state.spin = null;
      state.viewEase = null;
    });

    toy.addEventListener('pointermove', e => {
      const d = state.drag;
      if (!d || e.pointerId !== d.id) { return; }
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) { return; }
        d.moved = true;
        toy.setPointerCapture(e.pointerId);
        toy.classList.add('is-dragging');
      }
      const dx = e.clientX - d.x, dy = e.clientY - d.y, dist = Math.hypot(dx, dy);
      if (dist > 0) {
        const axis = [dy / dist, dx / dist, 0];
        const angle = dist * 3.4 / toy.getBoundingClientRect().width;
        state.view = qnorm(qmul(qaxis(axis, angle), state.view));
        const dt = Math.max(8, e.timeStamp - d.t);
        d.w = d.w.map((c, i) => 0.35 * c + 0.65 * axis[i] * angle / dt);
      }
      d.x = e.clientX;
      d.y = e.clientY;
      d.t = e.timeStamp;
      wake();
    });

    const endDrag = e => {
      const d = state.drag;
      if (!d || e.pointerId !== d.id) { return; }
      if (d.moved) {
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 300);
        if (e.timeStamp - d.t < 90 && len(d.w) > 2e-4) { state.spin = { w: d.w, last: performance.now() }; }
      }
      state.drag = null;
      toy.classList.remove('is-dragging');
      if (d.moved) { toy.blur(); }          // a drag shouldn't leave a focus ring
      wake();
    };
    toy.addEventListener('pointerup', endDrag);
    toy.addEventListener('pointercancel', endDrag);

    /* Keys: left and right change solid, up and down change family, and
       Space does what a click on the solid does. The key legend lights up. */
    const press = name => {
      const el = keys && keys.querySelector(`[data-key="${name}"]`);
      if (!el) { return; }
      el.classList.add('is-down');
      clearTimeout(el.upTimer);
      el.upTimer = setTimeout(() => el.classList.remove('is-down'), 160);
    };
    const typing = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    document.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) { return; }
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        press(k);
        if (!e.repeat) { slide(k === 'ArrowLeft' ? -1 : 1); }
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        press(k);
        if (!e.repeat) { switchFamily(k === 'ArrowUp' ? -1 : 1); }
      } else if (/^[pdf]$/i.test(k) && !e.shiftKey) {
        const key = k.toLowerCase();
        press(key);
        if (!e.repeat) { operate({ p: 'petrial', d: 'dual', f: 'facet' }[key]); }
      } else if (k === ' ' || k === 'Spacebar') {
        press('space');
        if (e.target === toy) { return; }            // the button's own click handles it
        if (e.target.closest && e.target.closest('button, a, summary, [role="button"]')) { return; }
        e.preventDefault();
        if (!e.repeat) { enqueue({}); }
      }
    });
    // A mouse click shouldn't leave a button holding focus, or the next Space
    // would press it again instead of turning the solid.
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button, [role="button"]');
      if (b && e.detail > 0) { b.blur(); }
    });

    /* Controls */
    const buttons = [...document.querySelectorAll('[data-tt]')];
    const syncButtons = () => {
      for (const b of buttons) {
        const [kind, value] = b.dataset.tt.split(':');
        const on = kind === 'mode' ? state.mode === value
          : kind === 'flag' ? state.flag
            : kind === 'autoplay' ? state.autoplay : null;
        if (on !== null) { b.setAttribute('aria-pressed', String(on)); }
      }
      for (const b of picker.querySelectorAll('[data-solid]')) {
        b.setAttribute('aria-pressed', String(b.dataset.solid === state.solid.name));
      }
    };
    for (const b of buttons) {
      b.addEventListener('click', () => {
        const [kind, value] = b.dataset.tt.split(':');
        if (kind === 'mode') { state.mode = value; buildPanel(); }
        if (kind === 'flag') { state.flag = !state.flag; }
        if (kind === 'autoplay') {
          state.autoplay = !state.autoplay;
          if (state.autoplay && !state.anim) { enqueue({}); } else if (!state.autoplay) { clearTimeout(autoTimer); }
        }
        if (kind === 'op') { operate(value); return; }
        syncButtons();
        wake();
      });
    }

    /* Figure 2, the map: the 18 finite regular polyhedra, joined by the
       three operations, laid out after McMullen and Schulte. A red drop marks
       where you are; an operation sends it flowing along its edge. */
    const SVGNS = 'http://www.w3.org/2000/svg';
    const mapSvg = document.querySelector('.tt-map-svg');
    // Stacked for a narrow margin: each component of the slide's graph
    // turned on its side, so P and D run down the columns and F across.
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
      ['octahedron-petrial', 'octahedron', 'P'], ['octahedron', 'cube', 'D'], ['cube-petrial', 'cube', 'P'],
      ['icosahedron-petrial', 'icosahedron', 'P'], ['icosahedron', 'dodecahedron', 'D'], ['dodecahedron', 'dodecahedron-petrial', 'P'],
      ['great-dodecahedron-petrial', 'great-dodecahedron', 'P'], ['great-dodecahedron', 'small-stellated-dodecahedron', 'D'],
      ['small-stellated-dodecahedron', 'small-stellated-dodecahedron-petrial', 'P'],
      ['great-stellated-dodecahedron-petrial', 'great-stellated-dodecahedron', 'P'], ['great-stellated-dodecahedron', 'great-icosahedron', 'D'],
      ['great-icosahedron', 'great-icosahedron-petrial', 'P'],
      ['icosahedron-petrial', 'great-dodecahedron-petrial', 'F'], ['icosahedron', 'great-dodecahedron', 'F'],
      ['small-stellated-dodecahedron', 'great-icosahedron', 'F'], ['small-stellated-dodecahedron-petrial', 'great-icosahedron-petrial', 'F'],
    ];
    const OP_OF = { P: 'petrial', D: 'dual', F: 'facet' };

    const makeMap = () => {
      if (!mapSvg) { return null; }
      const el = (name, attrs, parent) => {
        const e = document.createElementNS(SVGNS, name);
        for (const [k, v] of Object.entries(attrs)) { e.setAttribute(k, v); }
        if (parent) { parent.append(e); }
        return e;
      };
      mapSvg.replaceChildren();
      const defs = el('defs', {}, mapSvg);
      // The gooey filter: blur, then a hard alpha threshold, so nearby blobs
      // run together like liquid.
      const goo = el('filter', { id: 'tt-goo', x: '-20%', y: '-40%', width: '140%', height: '180%' }, defs);
      el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 5, result: 'b' }, goo);
      el('feColorMatrix', { in: 'b', mode: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9' }, goo);
      for (const [x, y, t] of [[130, 14, 'Tetrahedral'], [130, 82, 'Octahedral'], [130, 206, 'Icosahedral']]) {
        el('text', { x, y, class: 'tt-map-group' }, mapSvg).textContent = t;
      }
      const edgeLayer = el('g', { class: 'tt-map-edges' }, mapSvg);
      const drops = el('g', { class: 'tt-map-drop', filter: 'url(#tt-goo)' }, mapSvg);
      const nodeLayer = el('g', {}, mapSvg);
      const pill = { from: el('rect', {}, drops), to: el('rect', {}, drops) };
      const beads = [0, 1, 2].map(() => el('circle', { r: 0 }, drops));

      const nodes = {};
      for (const [key, [x, y, label, sub]] of Object.entries(MAP_NODES)) {
        const g = el('g', { class: 'tt-map-node', tabindex: 0, role: 'button' }, nodeLayer);
        const text = el('text', { x, y }, g);
        text.textContent = label;
        if (sub) { el('tspan', { 'baseline-shift': 'sub', class: 'tt-map-sub' }, text).textContent = sub; }
        const [name, petrial] = key.endsWith('-petrial') ? [key.slice(0, -8), true] : [key, false];
        const t = DEFS[name].title || name;
        g.setAttribute('aria-label', `${capitalize(petrial ? `Petrial of the ${t}` : t)}, ${label}${sub ? ` sub ${sub}` : ''}`);
        g.addEventListener('click', () => navigate(key));
        g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); navigate(key); } });
        nodes[key] = { x, y, g, text, box: null };
      }
      const edges = MAP_EDGES.map(([a, b, kind]) => ({ a, b, kind, line: el('path', { class: 'tt-map-edge' }, edgeLayer), label: el('text', { class: 'tt-map-op' }, edgeLayer) }));

      // Edges run between the labels' boxes, measured once the font is in.
      const layout = () => {
        for (const n of Object.values(nodes)) { const b = n.text.getBBox(); n.box = { x: b.x, y: b.y, w: b.width, h: b.height }; }
        for (const e of edges) {
          const A = nodes[e.a], B = nodes[e.b], across = Math.abs(A.y - B.y) < 1;
          const [x1, y1, x2, y2] = across
            ? [A.box.x + A.box.w + 8, A.y, B.box.x - 8, B.y]
            : [A.x, A.box.y + A.box.h + 5, B.x, B.box.y - 5];
          const ang = Math.atan2(y2 - y1, x2 - x1), hd = 4.5, w = 0.55;
          const head = (x, y, a) => `M${(x - hd * Math.cos(a - w)).toFixed(1)},${(y - hd * Math.sin(a - w)).toFixed(1)}L${x.toFixed(1)},${y.toFixed(1)}L${(x - hd * Math.cos(a + w)).toFixed(1)},${(y - hd * Math.sin(a + w)).toFixed(1)}`;
          e.line.setAttribute('d', `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}${head(x2, y2, ang)}${head(x1, y1, ang + Math.PI)}`);
          e.label.replaceChildren();
          e.label.textContent = e.kind;
          if (across) { e.label.setAttribute('x', ((x1 + x2) / 2).toFixed(1)); e.label.setAttribute('y', (y1 - 6).toFixed(1)); e.label.setAttribute('text-anchor', 'middle'); } else {
            e.label.setAttribute('x', (x1 + 6).toFixed(1)); e.label.setAttribute('y', ((y1 + y2) / 2 + 3.5).toFixed(1)); e.label.setAttribute('text-anchor', 'start');
          }
        }
        draw(here, here, 1);
      };

      // The drop: a pill under a label; between two labels, the pill drains
      // from one, three beads run along the way, and a pill fills the other.
      let here = null, anim = null;
      const pillAt = (r, key, k) => {
        const n = nodes[key];
        if (!n || !n.box || k <= 0.001) { r.setAttribute('width', 0); r.setAttribute('height', 0); return; }
        const w = (n.box.w + 16) * k + 14 * (1 - k), h = (n.box.h + 6) * Math.min(1, 0.55 + 0.45 * k);
        r.setAttribute('x', (n.x - w / 2).toFixed(1));
        r.setAttribute('y', (n.y - h / 2 - 1).toFixed(1));
        r.setAttribute('width', w.toFixed(1));
        r.setAttribute('height', h.toFixed(1));
        r.setAttribute('rx', (h / 2).toFixed(1));
      };
      const draw = (a, b, t) => {
        if (!a || !nodes[a] || !nodes[a].box) { return; }
        const e = EASY_EASE(clamp(t, 0, 1));
        pillAt(pill.from, a, a === b ? 1 : 1 - smoothstep(0, 0.4, t));
        pillAt(pill.to, b, a === b ? 0 : smoothstep(0.6, 1, t));
        const A = nodes[a], B = nodes[b];
        beads.forEach((c, i) => {
          const f = EASY_EASE(clamp((t - 0.06 * i - 0.08) / 0.8, 0, 1)), live = a === b ? 0 : Math.sin(Math.PI * clamp((t - 0.04 * i) / 0.95, 0, 1));
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
        if (!anim) { return; }
        const t = (now - anim.t0) / anim.dur;
        draw(anim.a, anim.b, t);
        if (t >= 1) { here = anim.b; anim = null; draw(here, here, 1); return; }
        requestAnimationFrame(tick);
      };
      if (document.fonts) { document.fonts.ready.then(layout); }
      return {
        nodes,
        layout,
        // Flow to key over ms, after delay ms (default: a quick hop now).
        go(key, ms = 650, delay = 0) {
          if (!nodes[key]) { return; }
          clearTimeout(this.timer);
          if (delay > 0) { this.timer = setTimeout(() => this.go(key, ms), delay); return; }
          if (!here || reducedMotion.matches || !nodes[here].box) { here = key; anim = null; draw(key, key, 1); return; }
          const a = anim ? anim.b : here;
          if (a === key && !anim) { return; }
          anim = { a, b: key, t0: performance.now(), dur: Math.max(300, ms) };
          requestAnimationFrame(tick);
        },
        // A refused operation: the drop shivers in place.
        wobble() {
          if (reducedMotion.matches || !here) { return; }
          const g = nodes[here].g;
          drops.animate([{ transform: 'none' }, { transform: 'scale(1.06, 0.94)' }, { transform: 'scale(0.97, 1.03)' }, { transform: 'none' }],
            { duration: 420, easing: 'ease-out' });
          g.animate([{ transform: 'none' }, { transform: 'translateY(-1px)' }, { transform: 'none' }], { duration: 300 });
        },
        get here() { return here; },
      };
    };

    // Clicking a node: one step away, take that step; otherwise go there.
    const navigate = key => {
      if (op || trans) { return; }
      const now = keyOfNode(state.solid.name, state.form);
      if (key === now) { map.wobble(); return; }
      const step = MAP_EDGES.find(([a, b]) => (a === now && b === key) || (b === now && a === key));
      if (step) { operate(OP_OF[step[2]]); return; }
      const petrial = key.endsWith('-petrial'), name = petrial ? key.slice(0, -8) : key;
      setSolid(name, { form: petrial ? 'petrial' : null });
    };

    /* Figure 3: every element of the group, by conjugacy class. A dot
       performs its symmetry. */
    let dots = [];
    const buildPanel = () => {
      const Gr = state.group;
      const n = size();
      const { list } = state.mode === 'all' ? state.classes.all : state.classes.rotations;
      panel.replaceChildren();
      dots = new Array(n);
      const rows = [list.filter(c => c.members[0] < Gr.R), list.filter(c => c.members[0] >= Gr.R)];
      for (const classes of rows) {
        if (!classes.length) { continue; }
        const row = document.createElement('div');
        row.className = 'tt-row';
        for (const c of classes) {
          const k = c.members.length;
          const block = document.createElement('div');
          block.className = 'tt-class';
          const grid = document.createElement('div');
          grid.className = 'tt-dots';
          grid.style.setProperty('--cols', k <= 4 ? k : k % 5 === 0 ? 5 : k % 4 === 0 ? 4 : k % 3 === 0 ? 3 : 5);
          for (const i of c.members) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tt-dot';
            b.title = capitalize(c.text);
            b.dataset.g = i;
            b.addEventListener('click', () => enqueue({ g: i }));
            const show = () => { state.preview = i; wake(); };
            const hideIt = () => { state.preview = null; wake(); };
            b.addEventListener('pointerenter', show);
            b.addEventListener('pointerleave', hideIt);
            b.addEventListener('focus', show);
            b.addEventListener('blur', hideIt);
            dots[i] = b;
            grid.append(b);
          }
          const label = document.createElement('span');
          label.className = 'tt-class-label';
          label.textContent = `${c.label} (${k})`;
          block.append(grid, label);
          row.append(block);
        }
        panel.append(row);
      }
      renderPanel();
    };

    const renderPanel = () => {
      const n = size();
      dots.forEach((b, i) => {
        const done = state.visited.has(i), current = i === state.current;
        b.classList.toggle('is-visited', done);
        b.classList.toggle('is-current', current);
        if (current) { b.setAttribute('aria-current', 'true'); } else { b.removeAttribute('aria-current'); }
        b.setAttribute('aria-label', `${b.title}${current ? ' (performed last)' : done ? ' (performed)' : ''}`);
      });
      const name = title();
      const performed = [...state.visited].filter(i => i < n).length;
      const what = state.mode === 'all'
        ? `The ${n} symmetries of the ${name}, by conjugacy class, rotations first.`
        : `The ${n} rotations of the ${name}, by conjugacy class.`;
      const moves = `${state.moves} ${state.moves === 1 ? 'move' : 'moves'}`;
      status.textContent = `${what} Click a dot to perform that symmetry; the orange one was performed last. `
        + `Filled dots have been performed (${performed} of ${n}). Net effect of ${moves}: ${classText(state.pos)}.`;
      alignPanel();                      // the list may have grown
    };

    /* Start: the solid named in the address, or the icon's dodecahedron. */
    const start = location.hash.slice(1).replace(/-petrial$/, '');
    state.family = Math.max(0, FAMILIES.findIndex(f => f.members.includes(start)));
    buildPicker();
    syncGhosts();
    map = makeMap();
    setSolid(DEFS[start] ? start : 'dodecahedron', { form: location.hash.endsWith('-petrial') ? 'petrial' : null });
    if (map) { map.layout(); }
    layoutRest();
    alignPanel();
    window.addEventListener('hashchange', () => {
      const name = location.hash.slice(1).replace(/-petrial$/, '');
      if (name === state.solid.name || !DEFS[name]) { return; }
      if (!FAMILIES[state.family].members.includes(name)) { setSolid(name, { form: location.hash.endsWith('-petrial') ? 'petrial' : null }); return; }
      const k = FAMILIES[state.family].members.indexOf(name);
      if (k >= 0) { slideTo(k); }
    });

    // For poking at it from the console.
    window.symmetryToy = { state, enqueue, select, setSolid, operate, navigate, slide, switchFamily, wake, cameraView, buildMove, FAMILIES, DEFS, solidOf, groupOf, get map() { return map; }, get trans() { return trans; }, get op() { return op; } };
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
