// The WebGL2 backend: paints a display list (see dl.js) into a canvas laid over the figure. Everything is drawn in figure units (the view box); the canvas reaches ROOM units past it on every side, for what sticks out (an axis's tips, a mirror).
// Strokes are segments, each a quad shaded by its distance to the segment (so its edges are as smooth as type), round or butt at either end; the segments of a path meet in round joins. A path seen through (alpha < 1) must be painted once, or every join and crossing would show darker: its segments go down first into the depth buffer only, each keeping where it covers most, then again in color where each is the one that won. Convex fills are triangles; others are cut out with the stencil by the nonzero rule. The window and the band a flip goes through cut what is in them exactly, in the shader; other clips use the stencil's top bit. A group drawn at alpha < 1 is drawn apart, in a layer, and laid on at once.

import {
    OP_C,
    OP_L,
    OP_M,
    OP_Q
} from './dl.js';

const ROOM = 64;
const BOX = 592,
    SIZE = BOX + 2 * ROOM; // the view box's side, and the canvas's

const HEAD = `#version 300 es
precision highp float;
`;
const CLIP = `
uniform float u_px;
uniform vec4 u_rrect;   // the window: center, half-width, corner radius (half-width 0: none)
uniform vec4 u_slab;    // a band: normal, offset, half-width (half-width < 0: none)
float clipCov(vec2 p) {
  float c = 1.0;
  if (u_rrect.z > 0.0) {
    vec2 q = abs(p - u_rrect.xy) - vec2(u_rrect.z - u_rrect.w);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_rrect.w;
    c *= clamp(0.5 - d / u_px, 0.0, 1.0);
  }
  if (u_slab.w >= 0.0) { c *= clamp(0.5 + (u_slab.w - abs(dot(p, u_slab.xy) - u_slab.z)) / u_px, 0.0, 1.0); }
  return c;
}
`;
const SEG_VS = `${HEAD}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_ends;
layout(location = 2) in vec4 a_style;   // width, round start, round end, index
layout(location = 3) in vec4 a_color;   // premultiplied
uniform vec3 u_view;
uniform float u_px;
out vec2 v_pos;
flat out vec4 v_ends;
flat out vec4 v_style;
flat out vec4 v_color;
void main() {
  vec2 p0 = a_ends.xy, p1 = a_ends.zw, d = p1 - p0;
  float L = length(d);
  vec2 u = L > 1e-6 ? d / L : vec2(1.0, 0.0), n = vec2(-u.y, u.x);
  // (Thinner than a pixel: drawn a pixel wide, as faint as it is thin.)
  float w = a_style.x, hw = max(0.5 * w, 0.5 * u_px), ext = hw + u_px;
  float s0 = a_style.y > 0.5 ? ext : u_px, s1 = a_style.z > 0.5 ? ext : u_px;
  vec2 pos = p0 + u * mix(-s0, L + s1, a_corner.x) + n * (a_corner.y * ext);
  v_pos = pos;
  v_ends = a_ends;
  v_style = vec4(hw, a_style.yzw);
  v_color = a_color * min(1.0, w / u_px);
  gl_Position = vec4((pos.x - u_view.x) * u_view.z - 1.0, 1.0 - (pos.y - u_view.y) * u_view.z, 0.0, 1.0);
}`;
const SEG_FS = `${HEAD}${CLIP}
in vec2 v_pos;
flat in vec4 v_ends;
flat in vec4 v_style;
flat in vec4 v_color;
uniform vec2 u_depth;    // painting once: on (1) or off; which path this is
uniform float u_dstep;
out vec4 o;
float edge(float x) { return clamp(x / u_px + 0.5, 0.0, 1.0); }
void main() {
  vec2 p0 = v_ends.xy, p1 = v_ends.zw, d = p1 - p0;
  float L = length(d);
  vec2 u = L > 1e-6 ? d / L : vec2(1.0, 0.0), q = v_pos - p0;
  float t = dot(q, u), hw = v_style.x;
  float cov = edge(hw - abs(q.x * u.y - q.y * u.x));
  if (v_style.y > 0.5) { if (t < 0.0) { cov = edge(hw - length(q)); } } else { cov *= edge(t); }
  if (v_style.z > 0.5) { if (t > L) { cov = edge(hw - length(v_pos - p1)); } } else { cov *= edge(L - t); }
  cov *= clipCov(v_pos);
  if (cov <= 0.0) { discard; }
  // Painting once: nearer (in depth) the more of the pixel is covered, ties going to one segment of the path or another by its index.
  float lvl = floor(min(cov, 0.999) * 64.0) * 64.0 + mod(v_style.w, 64.0);
  gl_FragDepth = u_depth.x > 0.5 ? 1.0 - u_dstep * (u_depth.y + (lvl + 1.0) / 4097.0) : gl_FragCoord.z;
  o = v_color * cov;
}`;
const FILL_VS = `${HEAD}
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
uniform vec3 u_view;
out vec2 v_pos;
out vec4 v_color;
void main() {
  v_pos = a_pos;
  v_color = a_color;
  gl_Position = vec4((a_pos.x - u_view.x) * u_view.z - 1.0, 1.0 - (a_pos.y - u_view.y) * u_view.z, 0.0, 1.0);
}`;
const FILL_FS = `${HEAD}${CLIP}
in vec2 v_pos;
in vec4 v_color;
out vec4 o;
void main() { o = v_color * clipCov(v_pos); }`;
const COMP_VS = `${HEAD}
out vec2 v_uv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  v_uv = 0.5 * (p + 1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;
const COMP_FS = `${HEAD}
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_alpha;
out vec4 o;
void main() { o = texture(u_tex, v_uv) * u_alpha; }`;

const SEG_FLOATS = 12,
    TRI_FLOATS = 6;
const NO_RRECT = [0, 0, 0, 0],
    NO_SLAB = [0, 0, 0, -1];

// Path data (see dl.js) as polylines: [{ p: [x0, y0, x1, y1, ...], closed }], curves cut into pieces no farther than tol from them.
const polylines = (path, tol) => {
    const a = path.a,
        out = [];
    let cur = null,
        x = 0,
        y = 0,
        sx = 0,
        sy = 0;
    const start = () => {
        if (!cur) {
            cur = {
                p: [x, y],
                closed: false
            };
            out.push(cur);
        }
    };
    for (let i = 0; i < a.length;) {
        const op = a[i];
        if (op === OP_M) {
            x = a[i + 1];
            y = a[i + 2];
            sx = x;
            sy = y;
            cur = {
                p: [x, y],
                closed: false
            };
            out.push(cur);
            i += 3;
        } else if (op === OP_L) {
            start();
            x = a[i + 1];
            y = a[i + 2];
            cur.p.push(x, y);
            i += 3;
        } else if (op === OP_Q) {
            start();
            const cx = a[i + 1],
                cy = a[i + 2],
                ex = a[i + 3],
                ey = a[i + 4];
            const n = Math.max(1, Math.min(64, Math.ceil(Math.sqrt(Math.hypot(x - 2 * cx + ex, y - 2 * cy + ey) / (8 * tol)))));
            for (let k = 1; k <= n; k++) {
                const t = k / n,
                    s = 1 - t;
                cur.p.push(s * s * x + 2 * s * t * cx + t * t * ex, s * s * y + 2 * s * t * cy + t * t * ey);
            }
            x = ex;
            y = ey;
            i += 5;
        } else if (op === OP_C) {
            start();
            const ax = a[i + 1],
                ay = a[i + 2],
                bx = a[i + 3],
                by = a[i + 4],
                ex = a[i + 5],
                ey = a[i + 6];
            const dd = Math.max(Math.hypot(x - 2 * ax + bx, y - 2 * ay + by), Math.hypot(ax - 2 * bx + ex, ay - 2 * by + ey));
            const n = Math.max(1, Math.min(64, Math.ceil(Math.sqrt((0.75 * dd) / tol))));
            for (let k = 1; k <= n; k++) {
                const t = k / n,
                    s = 1 - t;
                cur.p.push(s * s * s * x + 3 * s * s * t * ax + 3 * s * t * t * bx + t * t * t * ex, s * s * s * y + 3 * s * s * t * ay + 3 * s * t * t * by + t * t * t * ey);
            }
            x = ex;
            y = ey;
            i += 7;
        } else {
            if (cur) {
                cur.closed = true;
            }
            x = sx;
            y = sy;
            cur = null;
            i += 1;
        }
    }
    return out;
};

// host: the figure's element (the canvas goes in it, sized to it). lost(): called if the context is lost, so another backend can take over.
export const glBackend = (host, {
    lost = null
} = {}) => {
    const canvas = document.createElement('canvas');
    canvas.className = 'tt-gl';
    canvas.setAttribute('aria-hidden', 'true');
    const gl = canvas.getContext('webgl2', {
        antialias: true,
        alpha: true,
        premultipliedAlpha: true,
        depth: true,
        stencil: true,
        preserveDrawingBuffer: false
    });
    if (!gl) {
        return null;
    }
    canvas.addEventListener('webglcontextlost', e => {
        e.preventDefault();
        if (lost) {
            lost();
        }
    });

    const compile = (vs, fs) => {
        const prog = gl.createProgram();
        for (const [type, src] of [
                [gl.VERTEX_SHADER, vs],
                [gl.FRAGMENT_SHADER, fs]
            ]) {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                throw new Error(gl.getShaderInfoLog(sh));
            }
            gl.attachShader(prog, sh);
        }
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(prog));
        }
        const u = {};
        for (let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) {
            const name = gl.getActiveUniform(prog, i).name;
            u[name] = gl.getUniformLocation(prog, name);
        }
        return {
            prog,
            u
        };
    };
    const segP = compile(SEG_VS, SEG_FS),
        fillP = compile(FILL_VS, FILL_FS),
        compP = compile(COMP_VS, COMP_FS);

    // Segments: a unit quad, and one instance per segment.
    const segVao = gl.createVertexArray(),
        segBuf = gl.createBuffer();
    gl.bindVertexArray(segVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
    [
        [1, 0],
        [2, 4],
        [3, 8]
    ].forEach(([loc, off]) => {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, SEG_FLOATS * 4, off * 4);
        gl.vertexAttribDivisor(loc, 1);
    });
    // Triangles, each corner with its color.
    const triVao = gl.createVertexArray(),
        triBuf = gl.createBuffer();
    gl.bindVertexArray(triVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, TRI_FLOATS * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, TRI_FLOATS * 4, 8);
    const emptyVao = gl.createVertexArray();
    gl.bindVertexArray(null);

    // Growable arrays for what is batched.
    const grow = (arr, n) => {
        if (arr.length >= n) {
            return arr;
        }
        const b = new Float32Array(Math.max(n, 2 * arr.length));
        b.set(arr);
        return b;
    };
    let segs = new Float32Array(SEG_FLOATS * 4096),
        nSeg = 0,
        tris = new Float32Array(TRI_FLOATS * 8192),
        nTri = 0;

    /* ---------- Targets: the canvas, and layers ---------- */
    let W = 1,
        H = 1,
        px = 1;
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    const layers = []; // by depth: { fbo, color, ds, tex, rfbo, w, h }
    const layerAt = depth => {
        let L = layers[depth];
        if (L && L.w === W && L.h === H) {
            return L;
        }
        if (L) {
            [L.color, L.ds].forEach(r => gl.deleteRenderbuffer(r));
            gl.deleteTexture(L.tex);
            gl.deleteFramebuffer(L.fbo);
            gl.deleteFramebuffer(L.rfbo);
        }
        L = {
            w: W,
            h: H,
            fbo: gl.createFramebuffer(),
            rfbo: gl.createFramebuffer(),
            color: gl.createRenderbuffer(),
            ds: gl.createRenderbuffer(),
            tex: gl.createTexture()
        };
        gl.bindRenderbuffer(gl.RENDERBUFFER, L.color);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, W, H);
        gl.bindRenderbuffer(gl.RENDERBUFFER, L.ds);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, W, H);
        gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, L.color);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, L.ds);
        gl.bindTexture(gl.TEXTURE_2D, L.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, L.rfbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, L.tex, 0);
        layers[depth] = L;
        return L;
    };
    // The target being drawn into: its framebuffer, and how many paths have been painted once into its depth since it was cleared.
    const targets = [];
    const target = () => targets[targets.length - 1];
    const DSTEP = 1 / 128;

    /* ---------- State ---------- */
    // st: what is in force for what is drawn: the window and band (cut in the shader), the stencil clip, and an alpha carried down from a group of one.
    const sameClip = (a, b) => a.rrect === b.rrect && a.slab === b.slab && a.stencil === b.stencil;
    let batchSt = null,
        batchKind = null;
    const useProg = (P, st) => {
        gl.useProgram(P.prog);
        gl.uniform3f(P.u.u_view, view.x0, view.x0, 2 / view.span);
        if (P.u.u_px) {
            gl.uniform1f(P.u.u_px, px);
        }
        if (P.u.u_rrect) {
            gl.uniform4fv(P.u.u_rrect, st.rrect || NO_RRECT);
            gl.uniform4fv(P.u.u_slab, st.slab || NO_SLAB);
        }
    };
    const stencilIn = st => {
        if (st.stencil) {
            gl.enable(gl.STENCIL_TEST);
            gl.stencilFunc(gl.EQUAL, 0x80, 0x80);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
            gl.stencilMask(0);
        } else {
            gl.disable(gl.STENCIL_TEST);
        }
    };
    const drawSegs = (st, from, count, depthMode = 0, k = 0) => {
        useProg(segP, st);
        gl.uniform2f(segP.u.u_depth, depthMode, k);
        gl.uniform1f(segP.u.u_dstep, DSTEP);
        gl.bindVertexArray(segVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
        gl.bufferData(gl.ARRAY_BUFFER, segs.subarray(from * SEG_FLOATS, (from + count) * SEG_FLOATS), gl.STREAM_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    };
    const drawTris = (st, data, count) => {
        useProg(fillP, st);
        gl.bindVertexArray(triVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * TRI_FLOATS), gl.STREAM_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, count);
    };
    const flush = () => {
        if (batchKind === 'seg' && nSeg) {
            stencilIn(batchSt);
            drawSegs(batchSt, 0, nSeg);
        }
        if (batchKind === 'tri' && nTri) {
            stencilIn(batchSt);
            drawTris(batchSt, tris, nTri);
        }
        nSeg = 0;
        nTri = 0;
        batchKind = null;
        batchSt = null;
    };
    const batch = (kind, st) => {
        if (batchKind !== kind || !batchSt || !sameClip(batchSt, st)) {
            flush();
            batchKind = kind;
            batchSt = st;
        }
    };

    /* ---------- Primitives ---------- */
    const pushSeg = (x0, y0, x1, y1, w, c0, c1, idx, col, a) => {
        segs = grow(segs, (nSeg + 1) * SEG_FLOATS);
        const o = nSeg * SEG_FLOATS;
        segs[o] = x0;
        segs[o + 1] = y0;
        segs[o + 2] = x1;
        segs[o + 3] = y1;
        segs[o + 4] = w;
        segs[o + 5] = c0;
        segs[o + 6] = c1;
        segs[o + 7] = idx;
        segs[o + 8] = col[0] * a;
        segs[o + 9] = col[1] * a;
        segs[o + 10] = col[2] * a;
        segs[o + 11] = a;
        nSeg += 1;
    };
    // The segments of a path into segs; how many.
    const addStroke = (lines, w, round, col, a) => {
        let n = 0;
        for (const {
                p,
                closed
            }
            of lines) {
            const m = p.length / 2;
            if (m === 1) {
                if (round) {
                    pushSeg(p[0], p[1], p[0], p[1], w, 1, 1, n++, col, a);
                }
                continue;
            }
            const last = closed ? m : m - 1;
            for (let j = 0; j < last; j++) {
                const k = (j + 1) % m;
                const c0 = closed || j > 0 || round ? 1 : 0,
                    c1 = closed || j < last - 1 || round ? 1 : 0;
                pushSeg(p[2 * j], p[2 * j + 1], p[2 * k], p[2 * k + 1], w, c0, c1, n++, col, a);
            }
        }
        return n;
    };
    // A path in straight segments, each within a third of a pixel of its curve.
    const flat = p => polylines(p, 0.3 * px);
    const stroke = (path, col, w, a, cap, st) => {
        const lines = flat(path),
            round = cap !== 'butt';
        if (a >= 0.999) {
            batch('seg', st);
            addStroke(lines, w, round, col, a);
            return;
        }
        // Seen through: a single segment can't cross itself; a path is painted once (see the top).
        flush();
        const n = addStroke(lines, w, round, col, a);
        if (n <= 1) {
            batchKind = 'seg';
            batchSt = st;
            return;
        }
        const T = target();
        if (T.k >= 126) {
            gl.depthMask(true);
            gl.clear(gl.DEPTH_BUFFER_BIT);
            T.k = 0;
        }
        stencilIn(st);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.depthMask(true);
        gl.colorMask(false, false, false, false);
        drawSegs(st, 0, n, 1, T.k);
        gl.depthFunc(gl.EQUAL);
        gl.depthMask(false);
        gl.colorMask(true, true, true, true);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        gl.disable(gl.DEPTH_TEST);
        T.k += 1;
        nSeg = 0;
    };
    const bboxOf = lines => {
        let x0 = Infinity,
            y0 = Infinity,
            x1 = -Infinity,
            y1 = -Infinity;
        for (const {
                p
            }
            of lines) {
            for (let i = 0; i < p.length; i += 2) {
                x0 = Math.min(x0, p[i]);
                x1 = Math.max(x1, p[i]);
                y0 = Math.min(y0, p[i + 1]);
                y1 = Math.max(y1, p[i + 1]);
            }
        }
        return [x0, y0, x1, y1];
    };
    // Fans of a path's polylines (each closed) into an array of triangles.
    const fans = (lines, col, a, arr, n) => {
        const r = col[0] * a,
            g = col[1] * a,
            b = col[2] * a;
        for (const {
                p
            }
            of lines) {
            const m = p.length / 2;
            if (m < 3) {
                continue;
            }
            arr = grow(arr, (n + 3 * (m - 2)) * TRI_FLOATS);
            for (let j = 1; j < m - 1; j++) {
                for (const v of [0, j, j + 1]) {
                    const o = n * TRI_FLOATS;
                    arr[o] = p[2 * v];
                    arr[o + 1] = p[2 * v + 1];
                    arr[o + 2] = r;
                    arr[o + 3] = g;
                    arr[o + 4] = b;
                    arr[o + 5] = a;
                    n += 1;
                }
            }
        }
        return {
            arr,
            n
        };
    };
    let scratch = new Float32Array(TRI_FLOATS * 1024);
    const quad = (bb, col, a) => {
        const [x0, y0, x1, y1] = bb;
        return fans([{
            p: [x0 - 2, y0 - 2, x1 + 2, y0 - 2, x1 + 2, y1 + 2, x0 - 2, y1 + 2]
        }], col, a, scratch, 0);
    };
    const BLACK = [0, 0, 0];
    // Triangles drawn into the stencil alone, not the color.
    const stencilOnly = (st, data, n) => {
        gl.colorMask(false, false, false, false);
        drawTris(st, data, n);
        gl.colorMask(true, true, true, true);
    };
    // Mark a path's winding (nonzero) in the stencil's low bits.
    const markWinding = (lines, st) => {
        const f = fans(lines, BLACK, 1, scratch, 0);
        scratch = f.arr;
        gl.enable(gl.STENCIL_TEST);
        gl.stencilMask(0x7f);
        gl.stencilFunc(gl.ALWAYS, 0, 0xff);
        gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
        gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
        stencilOnly(st, scratch, f.n);
    };
    const fill = (path, col, a, convex, st) => {
        const lines = flat(path);
        if (convex) {
            batch('tri', st);
            const f = fans(lines, col, a, tris, nTri);
            tris = f.arr;
            nTri = f.n;
            return;
        }
        flush();
        markWinding(lines, st);
        // Cover: where the winding is not zero (and inside the clip), the color; the winding cleared everywhere.
        if (st.stencil) {
            gl.stencilFunc(gl.LESS, 0x80, 0xff);
        } else {
            gl.stencilFunc(gl.NOTEQUAL, 0, 0x7f);
        }
        gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
        const q = quad(bboxOf(lines), col, a);
        drawTris(st, q.arr, q.n);
    };

    /* ---------- Clips ---------- */
    const clipped = (clip, st, fn) => {
        if (!clip) {
            fn(st);
            return;
        }
        if (clip.kind === 'rect') {
            fn({
                ...st,
                rrect: [clip.x + clip.w / 2, clip.y + clip.h / 2, clip.w / 2, clip.r]
            });
            return;
        }
        if (clip.slab) {
            const {
                n,
                o,
                w
            } = clip.slab;
            fn({
                ...st,
                slab: [n[0], n[1], n[0] * o[0] + n[1] * o[1], w]
            });
            return;
        }
        // In the stencil's top bit: set where the clip is, cleared after.
        // (Clips of this kind do not nest: none is drawn inside another.)
        flush();
        const ALL = [-1e4, -1e4, 1e4, 1e4];
        const setBit = (region, on) => {
            gl.enable(gl.STENCIL_TEST);
            gl.stencilMask(0x80);
            gl.stencilFunc(gl.ALWAYS, on ? 0x80 : 0, 0x80);
            gl.stencilOp(gl.REPLACE, gl.REPLACE, gl.REPLACE);
            const q = quad(region, BLACK, 1);
            stencilOnly(st, q.arr, q.n);
        };
        const plain = {
            ...st,
            stencil: false
        };
        if (clip.holes) {
            // Everything but the holes: the bit set, then cleared in each hole.
            const holes = flat(clip.holes);
            setBit(ALL, true);
            markWinding(holes, plain);
            gl.stencilMask(0xff);
            gl.stencilFunc(gl.NOTEQUAL, 0, 0x7f);
            gl.stencilOp(gl.KEEP, gl.ZERO, gl.ZERO);
            const q = quad(bboxOf(holes), BLACK, 1);
            stencilOnly(plain, q.arr, q.n);
        } else {
            // (Where the winding is not zero the value becomes the bit alone.)
            const lines = flat(clip.path);
            markWinding(lines, plain);
            gl.stencilMask(0xff);
            gl.stencilFunc(gl.NOTEQUAL, 0x80, 0x7f);
            gl.stencilOp(gl.ZERO, gl.REPLACE, gl.REPLACE);
            const q = quad(lines.length ? bboxOf(lines) : [0, 0, 0, 0], BLACK, 1);
            stencilOnly(plain, q.arr, q.n);
        }
        fn({
            ...st,
            stencil: true
        });
        flush();
        setBit(ALL, false);
    };

    /* ---------- Layers ---------- */
    const inLayer = (alpha, st, fn) => {
        flush();
        const L = layerAt(targets.length - 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
        gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepth(1);
        gl.stencilMask(0xff);
        gl.depthMask(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        targets.push({
            fbo: L.fbo,
            k: 0
        });
        // (A stencil clip outside stays outside: what is in the layer is laid on through it.)
        fn({
            ...st,
            stencil: false,
            alpha: 1
        });
        flush();
        targets.pop();
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, L.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, L.rfbo);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target().fbo);
        stencilIn(st);
        gl.useProgram(compP.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, L.tex);
        gl.uniform1i(compP.u.u_tex, 0);
        gl.uniform1f(compP.u.u_alpha, alpha);
        gl.bindVertexArray(emptyVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    /* ---------- Walking the list ---------- */
    const paintKids = (kids, st) => {
        for (const k of kids) {
            if (k.kids) {
                paintGroup(k, st);
            } else if (k.dot) {
                paintDot(k, st);
            } else {
                paintShape(k, st);
            }
        }
    };
    const paintGroup = (g, st) => {
        const a = g.alpha * st.alpha;
        if (!(a > 0.001) || !g.kids.length) {
            return;
        }
        clipped(g.clip, st, st2 => {
            if (a >= 0.999) {
                paintKids(g.kids, {
                    ...st2,
                    alpha: 1
                });
                return;
            }
            // One thing alone takes the alpha itself.
            if (g.kids.length === 1) {
                paintKids(g.kids, {
                    ...st2,
                    alpha: a
                });
                return;
            }
            inLayer(a, st2, st3 => paintKids(g.kids, st3));
        });
    };
    const paintDot = (d, st) => {
        const a = d.alpha * st.alpha;
        if (a <= 0.001) {
            return;
        }
        batch('seg', st);
        pushSeg(d.x, d.y, d.x, d.y, 2 * d.r, 1, 1, 0, d.fill, a);
    };
    const paintShape = (s, st) => {
        const a = (s.alpha === undefined ? 1 : s.alpha) * st.alpha;
        if (a <= 0.001) {
            return;
        }
        clipped(s.clip, st, st2 => {
            if (s.fill && s.stroke && a < 0.999) {
                inLayer(a, st2, st3 => body(s, 1, st3));
            } else {
                body(s, a, st2);
            }
        });
    };
    const body = (s, a, st) => {
        const fa = s.fillAlpha === undefined ? 1 : s.fillAlpha,
            sa = s.strokeAlpha === undefined ? 1 : s.strokeAlpha;
        if (s.fill && a * fa > 0.001) {
            fill(s.path, s.fill, a * fa, s.convex, st);
        }
        if (s.stroke && a * sa > 0.001 && s.width > 0) {
            stroke(s.path, s.stroke, s.width, a * sa, s.cap, st);
        }
    };

    /* ---------- Frames ---------- */
    // The canvas in whole device pixels, one to one with the screen: as many as cover the view box and the room round it, at the figure's scale, centered on the view box. view: what it shows, in figure units. While the figure's box eases from one width to another (held), the canvas keeps the pixels of the wider, stretched over the box as it goes, and is made to measure once the box is still: made afresh every frame of the way, with its layers, it stalls the page. scale: the drawing as a whole, larger or smaller about the middle of the view box.
    const view = {
        x0: -40 - ROOM,
        span: SIZE,
        css: ''
    };
    let held = null;
    const dprNow = () => Math.min(window.devicePixelRatio || 1, 2);
    const pixels = box => Math.max(16, Math.round((SIZE * box * dprNow()) / BOX));
    const fit = (scale = 1) => {
        const box0 = host.offsetWidth || 300,
            dpr = dprNow();
        if (held && performance.now() > held.until) {
            held = null;
        }
        const exact = pixels(box0),
            w = held ? Math.max(exact, held.w) : exact;
        if (canvas.width !== w) {
            canvas.width = w;
            canvas.height = w;
        }
        const cw = w === exact ? w / dpr : (SIZE * box0) / BOX,
            off = (box0 - cw) / 2;
        const css = `left:${off}px;top:${off}px;width:${cw}px;height:${cw}px`;
        if (css !== view.css) {
            canvas.style.cssText = css;
            view.css = css;
        }
        W = w;
        H = w;
        view.span = (cw * BOX) / box0 / scale;
        px = view.span / w;
        view.x0 = 256 - view.span / 2; // (the view box runs from -40 to 552)
    };
    let last = null;
    const render = root => {
        last = root;
        if (gl.isContextLost()) {
            return;
        }
        fit(root.scale || 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepth(1);
        gl.clearStencil(0);
        gl.colorMask(true, true, true, true);
        gl.depthMask(true);
        gl.stencilMask(0xff);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        targets.length = 0;
        targets.push({
            fbo: null,
            k: 0
        });
        paintKids(root.kids, {
            rrect: null,
            slab: null,
            stencil: false,
            alpha: 1
        });
        flush();
    };
    // A box laid out as the figure is (the view box's size), its canvas reaching past it as this one does.
    const boxed = () => {
        const el = document.createElement('div'),
            c = document.createElement('canvas');
        el.className = 'tt-glbox';
        c.className = 'tt-gl';
        el.append(c);
        return {
            el,
            c
        };
    };
    const copyInto = c => {
        c.width = canvas.width;
        c.height = canvas.height;
        c.style.cssText = view.css;
        c.getContext('2d').drawImage(canvas, 0, 0);
    };
    host.append(canvas);
    return {
        kind: 'webgl',
        el: canvas,
        render,
        // A still copy of what is drawn now.
        snapshot() {
            const {
                el,
                c
            } = boxed();
            if (last) {
                render(last);
            }
            copyInto(c);
            return el;
        },
        // The figure's box about to ease to width box (in CSS pixels), for ms: until then the canvas keeps the pixels of the wider (see fit).
        hold(box, ms) {
            held = {
                w: Math.max(pixels(host.offsetWidth || 300), pixels(box)),
                until: performance.now() + ms
            };
        },
    };
};
