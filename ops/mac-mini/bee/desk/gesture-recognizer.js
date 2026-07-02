(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BeeGesture = api;
})(typeof window === 'object' ? window : globalThis, function buildRecognizer() {
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const pathLength = (stroke) => stroke.slice(1).reduce((sum, point, i) => sum + distance(stroke[i], point), 0);
  const box = (points) => ({
    minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)),
  });
  const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  const intersects = (a, b, c, d) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);

  function isReject(strokes) {
    if (strokes.length !== 2 || strokes.some((s) => s.length < 3 || pathLength(s) < 80)) return false;
    const [a, b] = strokes, ab = box(a), bb = box(b);
    if (ab.maxX - ab.minX < 55 || ab.maxY - ab.minY < 55 || bb.maxX - bb.minX < 55 || bb.maxY - bb.minY < 55) return false;
    const slopeA = (a.at(-1).y - a[0].y) / (a.at(-1).x - a[0].x || 0.001);
    const slopeB = (b.at(-1).y - b[0].y) / (b.at(-1).x - b[0].x || 0.001);
    if (slopeA * slopeB >= -0.2) return false;
    for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) if (intersects(a[i - 1], a[i], b[j - 1], b[j])) return true;
    return false;
  }

  function isApprove(stroke) {
    if (!stroke || stroke.length < 8 || pathLength(stroke) < 150) return false;
    const bounds = box(stroke);
    if (bounds.maxX - bounds.minX < 85 || bounds.maxY - bounds.minY < 65) return false;
    let valleyIndex = 0;
    for (let i = 1; i < stroke.length; i++) if (stroke[i].y > stroke[valleyIndex].y) valleyIndex = i;
    const start = stroke[0], valley = stroke[valleyIndex], end = stroke.at(-1);
    const valleyPosition = valleyIndex / (stroke.length - 1);
    const shortLegDown = valley.x - start.x >= 18 && valley.y - start.y >= 42;
    const longLegUp = end.x - valley.x >= 55 && valley.y - end.y >= 52;
    const overallRight = end.x - start.x >= 82;
    return valleyPosition >= 0.18 && valleyPosition <= 0.62 && shortLegDown && longLegUp && overallRight;
  }

  // A checkmark drawn as two segments that meet at the valley is ONE gesture, not an X.
  // Merge two strokes whose ends touch (shared vertex) so a split ✓ reads as approve, not reject.
  function mergeIfTouching(strokes) {
    if (strokes.length !== 2) return strokes;
    const [a, b] = strokes;
    if (distance(a.at(-1), b[0]) <= 30) return [a.concat(b)];
    if (distance(a.at(-1), b.at(-1)) <= 30) return [a.concat([...b].reverse())];
    return strokes;
  }
  function recognize(strokes) {
    if (!Array.isArray(strokes) || !strokes.length) return null;
    const s = mergeIfTouching(strokes);
    if (isReject(s)) return 'reject';                          // a true X: two strokes that cross, not merged
    if (s.length === 1 && isApprove(s[0])) return 'approve';
    return null;
  }

  return { recognize };
});
