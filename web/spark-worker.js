// Electric arcs crackling around the sender's frame in the receiver's
// viewfinder, and a time-jump flash with fire trails when the transfer
// completes. Drawn here, on an OffscreenCanvas, so the effect never takes
// main-thread time from the capture loop (style.css, receiving states);
// the page only posts the frame's corners after each analysed capture.
// #TODO(agent): UNVERIFIED — not yet seen running in a browser; look at it on receive.html and check that the processed fps shown there is unchanged with it on.

// Colours from style.css: --cyan for the glow, --warn and --err for fire,
// --ok for the reduced-motion outline once complete.
const GLOW = '62, 242, 255';
const FIRE = ['255, 77, 109', '255, 177, 62', '255, 240, 200'];
const DONE = '93, 255, 154';

// The crackle loops on its own rhythm while the frame is held: a new burst
// of arcs every CRACKLE_MIN..CRACKLE_MAX ms, each arc lit for
// ARC_MIN..ARC_MAX ms. Uneven gaps read as electricity, even ones as a blink.
const CRACKLE_MIN = 35, CRACKLE_MAX = 95;
const ARC_MIN = 80, ARC_MAX = 160;
// A capture that fails to read leaves the arcs crackling at the last
// corners this long, so a few missed captures do not make them blink out.
const HOLD_MS = 300;
// Time jump: arcs surge, one flash (never more, see WCAG 2.3.1), then two
// fire trails burn out.
const SURGE_MS = 200, FLASH_MS = 250, BURN_MS = 1500;

let canvas = null, ctx = null, dpr = 1, reduced = false;
// Corners in canvas pixels, when they were last seen, and how far the
// transfer has got (0..1), which sets how hard the arcs crackle.
let quad = null, seenAt = -Infinity, level = 0;
let arcs = [], nextBurst = 0, jump = null, embers = [], looping = false;

const frameLoop = self.requestAnimationFrame
  ? (f) => self.requestAnimationFrame(f)
  : (f) => setTimeout(() => f(performance.now()), 16);

self.onmessage = ({ data: m }) => {
  const now = performance.now();
  switch (m.type) {
    case 'init':
      canvas = m.canvas;
      ctx = canvas.getContext('2d');
      reduced = m.reduced;
      break;
    case 'size':
      canvas.width = m.width;
      canvas.height = m.height;
      dpr = m.dpr;
      break;
    case 'reduced':
      reduced = m.reduced;
      break;
    case 'frame':
      // Captures still in flight after the jump must not rekindle the arcs.
      if (jump) break;
      level = m.level;
      if (m.corners) {
        quad = m.corners;
        seenAt = now;
        // Fresh symbols in this capture: an extra burst on top of the loop.
        if (m.fresh && !reduced) burst(now, 2);
      }
      break;
    case 'jump':
      if (quad) jump = { start: now, quad };
      break;
    case 'clear':
      quad = null;
      seenAt = -Infinity;
      arcs = [];
      embers = [];
      jump = null;
      break;
  }
  if (reduced) drawStill(now);
  else if (!looping) {
    looping = true;
    frameLoop(tick);
  }
};

/// Reduced motion: the frame's outline where it was last read, no crackle,
/// no flash; green once complete. Redrawn only when a message arrives.
function drawStill(now) {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const q = jump ? jump.quad : now - seenAt < HOLD_MS ? quad : null;
  if (!q) return;
  outline(q, `rgba(${jump ? DONE : GLOW}, 0.9)`, 2 * dpr);
}

function tick(now) {
  if (!ctx || reduced) {
    looping = false;
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'lighter';
  const held = !jump && quad && now - seenAt < HOLD_MS;
  if (held) {
    if (now >= nextBurst) {
      burst(now, 1);
      nextBurst = now + CRACKLE_MIN + Math.random() * (CRACKLE_MAX - CRACKLE_MIN);
    }
    outline(quad, `rgba(${GLOW}, ${0.12 + 0.18 * level})`, 6 * dpr);
    corners(quad, now);
  }
  if (jump && !jump.spent) drawJump(now - jump.start);
  arcs = arcs.filter((a) => now - a.born < a.life);
  for (const a of arcs) drawArc(a.points, 1 - (now - a.born) / a.life, a.width);
  ctx.globalCompositeOperation = 'source-over';
  if (held || arcs.length || (jump && !jump.spent)) frameLoop(tick);
  else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    looping = false;
  }
}

/// Arcs along some of the frame's edges: more edges, and longer and
/// wilder arcs, as the transfer gets further.
function burst(now, strength) {
  const q = jump ? jump.quad : quad;
  if (!q) return;
  for (let e = 0; e < 4; e++) {
    if (Math.random() > (0.3 + 0.45 * level) * strength) continue;
    const a = q[e], b = q[(e + 1) % 4];
    const from = Math.random() * 0.5, span = 0.3 + Math.random() * (0.4 + 0.3 * level);
    const p = lerp(a, b, from), r = lerp(a, b, Math.min(1, from + span));
    const points = bolt(p, r, outward(q, a, b), 0.18 + 0.12 * level);
    arcs.push({ points, born: now, life: ARC_MIN + Math.random() * (ARC_MAX - ARC_MIN), width: 1 + level });
    // Now and then a short fork leaps off the arc, away from the frame.
    if (Math.random() < 0.35 + 0.3 * level) {
      const s = points[(points.length * Math.random()) | 0], n = outward(q, a, b);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * (0.05 + 0.1 * Math.random());
      const tip = [s[0] + n[0] * len + (Math.random() - 0.5) * len, s[1] + n[1] * len + (Math.random() - 0.5) * len];
      arcs.push({ points: bolt(s, tip, n, 0.35), born: now, life: ARC_MIN, width: 0.7 });
    }
  }
}

/// A jagged line from p to r by midpoint displacement, bent mostly away
/// from the frame (unit normal n) so the arcs frame the picture.
function bolt(p, r, n, rough) {
  let pts = [p, r];
  for (let depth = 0; depth < 5; depth++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const s = pts[i - 1], t = pts[i];
      const off = (Math.random() - 0.35) * Math.hypot(t[0] - s[0], t[1] - s[1]) * rough * 2;
      next.push([(s[0] + t[0]) / 2 + n[0] * off, (s[1] + t[1]) / 2 + n[1] * off], t);
    }
    pts = next;
  }
  return pts;
}

/// A wide faint glow under a thin white core, both fading with `alpha`.
function drawArc(points, alpha, width) {
  path(points);
  ctx.strokeStyle = `rgba(${GLOW}, ${0.35 * alpha})`;
  ctx.lineWidth = 6 * width * dpr;
  ctx.stroke();
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * alpha})`;
  ctx.lineWidth = 1.2 * width * dpr;
  ctx.stroke();
}

/// Flickering nodes at the four corners, like contacts the arcs jump from.
function corners(q, now) {
  for (const [x, y] of q) {
    const r = (3 + 3 * level + Math.random() * 3) * dpr;
    ctx.fillStyle = `rgba(${GLOW}, ${0.25 + 0.35 * Math.random()})`;
    ctx.beginPath();
    ctx.arc(x, y, r * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + 0.5 * Math.sin(now / 37 + x)})`;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/// The time jump, `t` ms in: arcs surge round the whole frame, a single
/// flash bursts out of it, and two fire trails run out from its bottom
/// edge and burn out. Afterwards the overlay stays clear: `jump` is kept,
/// spent, so nothing rekindles until the page clears it.
function drawJump(t) {
  const q = jump.quad, c = centre(q);
  if (t < SURGE_MS) {
    burst(performance.now(), 3);
    outline(q, `rgba(255, 255, 255, ${0.3 + 0.6 * (t / SURGE_MS)})`, 3 * dpr);
    return;
  }
  const f = (t - SURGE_MS) / FLASH_MS;
  if (f < 1) {
    path(q.map(([x, y]) => [c[0] + (x - c[0]) * (1 + 0.6 * f), c[1] + (y - c[1]) * (1 + 0.6 * f)]), true);
    ctx.fillStyle = `rgba(225, 250, 255, ${0.85 * (1 - f) ** 2})`;
    ctx.fill();
  }
  const b = (t - SURGE_MS) / BURN_MS;
  if (b >= 1) {
    jump.spent = true;
    embers = [];
    return;
  }
  // Two trails from a third and two thirds along the bottom edge (bottom
  // left to bottom right), running away from the frame.
  const bl = q[3], br = q[2], n = outward(q, br, bl);
  const reach = Math.max(canvas.width, canvas.height) * Math.min(1, b * 4);
  const fade = b < 0.4 ? 1 : 1 - (b - 0.4) / 0.6;
  for (const at of [1 / 3, 2 / 3]) {
    const s = lerp(bl, br, at);
    const trail = [];
    for (let i = 0; i <= 24; i++) {
      const d = (reach * i) / 24, wobble = (Math.random() - 0.5) * 6 * dpr;
      trail.push([s[0] + n[0] * d - n[1] * wobble, s[1] + n[1] * d + n[0] * wobble]);
    }
    FIRE.forEach((rgb, k) => {
      path(trail);
      ctx.strokeStyle = `rgba(${rgb}, ${fade * (0.5 + 0.2 * k)})`;
      ctx.lineWidth = (10 - 4 * k + Math.random() * 3) * dpr;
      ctx.stroke();
    });
    if (Math.random() < 0.8) {
      const p = trail[(Math.random() * trail.length) | 0];
      embers.push({ x: p[0], y: p[1], vx: (Math.random() - 0.5) * dpr, vy: -(0.5 + Math.random()) * dpr, life: 1 });
    }
  }
  for (const e of embers) {
    e.x += e.vx;
    e.y += e.vy;
    e.life -= 0.02;
    ctx.fillStyle = `rgba(${FIRE[1]}, ${Math.max(0, e.life) * fade})`;
    ctx.fillRect(e.x, e.y, 2 * dpr, 2 * dpr);
  }
  embers = embers.filter((e) => e.life > 0);
}

function outline(q, style, width) {
  path(q, true);
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
}

function path(points, closed = false) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  if (closed) ctx.closePath();
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function centre(q) {
  return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
}

/// Unit normal of edge a→b pointing away from the frame's centre.
function outward(q, a, b) {
  const c = centre(q), m = lerp(a, b, 0.5);
  let n = [-(b[1] - a[1]), b[0] - a[0]];
  const len = Math.hypot(n[0], n[1]) || 1;
  n = [n[0] / len, n[1] / len];
  return (m[0] - c[0]) * n[0] + (m[1] - c[1]) * n[1] < 0 ? [-n[0], -n[1]] : n;
}
