/**
 * SAM — phoneGeometry: pure box helpers over a built `Scene` and its `Layout` (T14).
 *
 * The phone pyramid's tests (and later tickets') ask the same questions of the floor: is a platform, bust, label,
 * the SAM tag or the ring's 12 numeral inside the canvas, clear of another one, or under a link. These helpers
 * give each thing as a polygon or a `[x, y, w, h]` box in canvas px. Plain maths, no canvas, no DOM.
 */

import type { PhoneGeneralLabel, Pt, Layout, Scene, Station } from './floorRender.js';
import { ringGeometry } from './ringRender.js';
import type { Box } from './ringRender.js';

/** The convex hull of a point set (Andrew's monotone chain), counter-clockwise in canvas px. */
function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (pts: Pt[]) => {
    const h: Pt[] = [];
    for (const q of pts) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** The tightest `[x, y, w, h]` box round a point set. */
export function boundsOf(points: Pt[]): Box {
  const xs = points.map((q) => q[0]), ys = points.map((q) => q[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}

/** A General's platform: the hull of its box's top, left and right faces. */
export function platformPoly(st: Pick<Station, 'box'>): Pt[] {
  return hull([...st.box.top, ...st.box.left, ...st.box.right]);
}

/**
 * A General's bust, from its bottom centre up by its drawn height. Busts are drawn about as wide as they are
 * tall; 0.8 of the height is a little generous.
 */
export function bustBox(st: Pick<Station, 'bustSlot'>): Box {
  const { x, y, heightPx } = st.bustSlot, w = heightPx * 0.8;
  return [x - w / 2, y - heightPx, w, heightPx];
}

/**
 * A General's name and state text on the phone, centred on its station: the name's baseline is 10 px under the
 * label's top and the state's 22 px under it (`drawPhoneLabels`). The width is generous to the longer of the two
 * (0.62 em a character, at least 11 px type, wider than a real glyph run) and the height reaches the state's descenders.
 */
export function labelBox(label: Pick<PhoneGeneralLabel, 'name' | 'state' | 'x' | 'y'>, px = 11): Box {
  const type = Math.max(11, px), w = Math.max(label.name.length, label.state.length) * 0.62 * type;
  return [label.x - w / 2, label.y + 10 - type, w, 22 + 4 - (10 - type)];
}

/** The SAM tag ("SAM" over "ORCHESTRATOR") at the point `phoneLabels` gives for it. */
export function samTagBox(sam: { x: number; y: number }): Box {
  return [sam.x, sam.y - 14, 80, 27];
}

/** The ring's 12 numeral (the one under the dial), from the ring's own geometry. */
export function numeralBox(layout: Layout, scene: Scene, zeusDrawn = true): Box {
  const n = ringGeometry(layout, scene.view.cam, zeusDrawn).nums.find((m) => m.t === '12')!;
  return [...n.r];
}

/** Every worker pad's box (its three faces' bounds) in canvas px, in scene order. */
export function padBoxes(scene: Scene): Box[] {
  return scene.pads.map((p) => boundsOf([...p.box.top, ...p.box.left, ...p.box.right]));
}

/** Whether two boxes overlap, with `margin` px of clear space required between them (default none). */
export function rectsOverlap(a: Box, b: Box, margin = 0): boolean {
  return a[0] < b[0] + b[2] + margin && b[0] < a[0] + a[2] + margin && a[1] < b[1] + b[3] + margin && b[1] < a[1] + a[3] + margin;
}
