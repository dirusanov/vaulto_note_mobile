package expo.modules.inkinput

import android.graphics.Path
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

// A line-for-line port of the stroke model in src/drawing/ink.ts. The live
// stroke drawn here and the stroke the canvas draws once it is committed must
// be the same shape, so any change there must be made here too
// (tests/inkNative.test.cjs compares the two).

/** A growable list of doubles without boxing. */
class DoubleList(capacity: Int = 64) {
  var data = DoubleArray(capacity)
    private set
  var size = 0
    private set

  operator fun get(i: Int): Double = data[i]

  operator fun set(i: Int, value: Double) {
    data[i] = value
  }

  fun add(value: Double) {
    if (size == data.size) {
      data = data.copyOf(data.size * 2)
    }
    data[size++] = value
  }

  fun add(a: Double, b: Double) {
    add(a)
    add(b)
  }

  fun add(a: Double, b: Double, c: Double) {
    add(a)
    add(b)
    add(c)
  }

  fun pop() {
    size -= 1
  }

  fun clear() {
    size = 0
  }

  fun last(): Double = data[size - 1]

  fun toArray(): DoubleArray = data.copyOf(size)
}

/** Tool parameters, as in INK_TOOLS. */
data class InkSpec(
  val thinning: Double,
  val streamline: Double,
  val taper: Boolean,
  val nib: Double,
)

private const val CAP_STEPS = 8

/** See InkTrace in ink.ts. */
class InkTrace(
  val size: Double,
  val thinning: Double,
  val streamline: Double,
  val taper: Boolean,
  val nib: Double,
) {
  val minRadius = size * 0.08
  val taperLength = size * 2.5
  val nibReach = max(1.5, size * 0.6)
  var consumed = 0
  var sx = 0.0
  var sy = 0.0
  var sp = 0.0
  var travelled = 0.0
  val xs = DoubleList()
  val ys = DoubleList()
  val rs = DoubleList()
  val dist = DoubleList()
  val left = DoubleList()
  val right = DoubleList()
  val dirX = DoubleList()
  val dirY = DoubleList()
  val radius = DoubleList()
  var done = 0
  var back = 0

  private val edge = DoubleArray(7)

  /** Edges of point i of a centre line with `n` points; returns the new nib cursor. */
  private fun edge(n: Int, i: Int, backIn: Int, out: DoubleArray): Int {
    var back = backIn
    val a = max(0, i - 1)
    val b = min(n - 1, i + 1)
    var dx = xs[b] - xs[a]
    var dy = ys[b] - ys[a]
    val length = hypot(dx, dy).let { if (it == 0.0) 1.0 else it }
    dx /= length
    dy /= length
    var r = rs[i]
    if (nib > 0) {
      while (back < i && dist[i] - dist[back + 1] >= nibReach) {
        back += 1
      }
      val j = if (back < i) back else 0
      val k = if (back < i) i else min(n - 1, 1)
      val ndx = xs[k] - xs[j]
      val ndy = ys[k] - ys[j]
      val nl = hypot(ndx, ndy).let { if (it == 0.0) 1.0 else it }
      val across = abs((ndx / nl) * 0.7071 + (ndy / nl) * 0.7071)
      r = max(minRadius, r * (1 - nib + nib * 1.25 * across))
    }
    out[0] = xs[i] - dy * r
    out[1] = ys[i] + dx * r
    out[2] = xs[i] + dy * r
    out[3] = ys[i] - dx * r
    out[4] = dx
    out[5] = dy
    out[6] = r
    return back
  }

  /** traceAppend: reads the samples not read yet and fixes the points that are final now. */
  fun append(points: DoubleList) {
    val count = points.size / 3
    for (i in consumed until count) {
      if (i == 0) {
        sx = points[0]
        sy = points[1]
        sp = points[2]
      } else {
        sx += (points[i * 3] - sx) * (1 - streamline)
        sy += (points[i * 3 + 1] - sy) * (1 - streamline)
        sp += (points[i * 3 + 2] - sp) * 0.35
        val last = xs.size - 1
        val dx = sx - xs[last]
        val dy = sy - ys[last]
        val step2 = dx * dx + dy * dy
        if (step2 < 0.6) {
          continue
        }
        travelled += sqrt(step2)
      }
      var r = max(minRadius, (size / 2) * (1 + thinning * (sp - 0.5) * 1.6))
      if (taper && travelled < taperLength) {
        val k = travelled / taperLength
        r = max(minRadius, r * (0.3 + 0.7 * (1 - (1 - k) * (1 - k))))
      }
      xs.add(sx)
      ys.add(sy)
      rs.add(r)
      dist.add(travelled)
    }
    consumed = max(consumed, count)
    while (done + 1 < xs.size) {
      back = edge(xs.size, done, back, edge)
      left.add(edge[0], edge[1])
      right.add(edge[2], edge[3])
      dirX.add(edge[4])
      dirY.add(edge[5])
      radius.add(edge[6])
      done += 1
    }
  }

  /** traceTail: edges of the points that may still change. */
  fun tail(points: DoubleList): InkTail {
    val count = points.size / 3
    val smoothed = xs.size
    val tail = InkTail()
    tail.n = smoothed
    if (smoothed == 0) {
      return tail
    }
    if (count > 1) {
      val lx = points[(count - 1) * 3]
      val ly = points[(count - 1) * 3 + 1]
      val last = smoothed - 1
      val gap = hypot(lx - xs[last], ly - ys[last])
      if (gap > 0.05) {
        xs.add(lx)
        ys.add(ly)
        rs.add(rs[last])
        dist.add(dist[last] + gap)
      }
    }
    val n = xs.size
    tail.n = n
    if (n == 1) {
      tail.xs.add(xs[0])
      tail.ys.add(ys[0])
      tail.dot = rs[0]
    } else {
      val out = DoubleArray(7)
      var b = back
      for (i in done until n) {
        b = edge(n, i, b, out)
        tail.xs.add(xs[i])
        tail.ys.add(ys[i])
        tail.left.add(out[0], out[1])
        tail.right.add(out[2], out[3])
        tail.dirX.add(out[4])
        tail.dirY.add(out[5])
        tail.radius.add(out[6])
      }
    }
    if (n > smoothed) {
      xs.pop()
      ys.pop()
      rs.pop()
      dist.pop()
    }
    return tail
  }

  /** traceOutline: outline polygon [x, y, ...] of points from .. to. */
  fun outline(tail: InkTail?, from: Int, to: Int, capStart: Boolean, capEnd: Boolean): DoubleList {
    val outline = DoubleList(max(16, (to - from + 2) * 4 + CAP_STEPS * 4))
    if (tail != null && tail.n == 1) {
      val r = tail.dot
      for (i in 0 until CAP_STEPS * 2) {
        val angle = (i.toDouble() / (CAP_STEPS * 2)) * PI * 2
        outline.add(tail.xs[0] + cos(angle) * r, tail.ys[0] + sin(angle) * r)
      }
      return outline
    }
    val fixed = min(to + 1, done)
    for (i in from until fixed) {
      outline.add(left[i * 2], left[i * 2 + 1])
    }
    if (tail != null) {
      for (i in max(from, done)..to) {
        outline.add(tail.left[(i - done) * 2], tail.left[(i - done) * 2 + 1])
      }
    }
    if (capEnd) {
      cap(outline, tail, to, 1.0)
    }
    if (tail != null) {
      for (i in to downTo max(from, done)) {
        outline.add(tail.right[(i - done) * 2], tail.right[(i - done) * 2 + 1])
      }
    }
    for (i in fixed - 1 downTo from) {
      outline.add(right[i * 2], right[i * 2 + 1])
    }
    if (capStart) {
      cap(outline, tail, from, -1.0)
    }
    return outline
  }

  private fun cap(outline: DoubleList, tail: InkTail?, at: Int, sign: Double) {
    val e = at - done
    val fromTail = e >= 0 && tail != null
    val cx = if (fromTail) tail!!.xs[e] else xs[at]
    val cy = if (fromTail) tail!!.ys[e] else ys[at]
    val r = if (fromTail) tail!!.radius[e] else radius[at]
    val dx = if (fromTail) tail!!.dirX[e] else dirX[at]
    val dy = if (fromTail) tail!!.dirY[e] else dirY[at]
    for (s in 1 until CAP_STEPS) {
      val theta = (s.toDouble() / CAP_STEPS) * PI
      val nx = -dy
      val ny = dx
      outline.add(
        cx + sign * r * (nx * cos(theta) + dx * sin(theta)),
        cy + sign * r * (ny * cos(theta) + dy * sin(theta)),
      )
    }
  }
}

class InkTail {
  var n = 0
  val xs = DoubleList(8)
  val ys = DoubleList(8)
  val left = DoubleList(16)
  val right = DoubleList(16)
  val dirX = DoubleList(8)
  val dirY = DoubleList(8)
  val radius = DoubleList(8)
  var dot = 0.0
}

const val LIVE_PIECE = 32
const val LIVE_OVERLAP = 3

/** nextFrozenPiece: [from, to] of the next piece to freeze, or null. */
fun nextFrozenPiece(frozenTo: Int, done: Int): IntArray? {
  val from = if (frozenTo < 0) 0 else frozenTo - LIVE_OVERLAP
  val to = max(0, frozenTo) + LIVE_PIECE
  return if (to < done) intArrayOf(from, to) else null
}

fun liveTailStart(frozenTo: Int): Int = if (frozenTo < 0) 0 else frozenTo - LIVE_OVERLAP

/** strokeOutline: the whole outline of a finished stroke. */
fun strokeOutline(points: DoubleList, size: Double, spec: InkSpec, cut: Boolean): DoubleList {
  if (points.size / 3 == 0) {
    return DoubleList(1)
  }
  val trace = InkTrace(size, spec.thinning, spec.streamline, spec.taper && !cut, spec.nib)
  trace.append(points)
  val tail = trace.tail(points)
  return trace.outline(tail, 0, tail.n - 1, true, true)
}

/**
 * addOutline: one closed contour of quadratic segments through the midpoints of
 * the outline points, as the canvas builds it.
 */
fun addOutline(path: Path, outline: DoubleList) {
  val n = outline.size / 2
  if (n < 3) {
    return
  }
  fun mx(i: Int) = ((outline[(i % n) * 2] + outline[((i + 1) % n) * 2]) / 2).toFloat()
  fun my(i: Int) = ((outline[(i % n) * 2 + 1] + outline[((i + 1) % n) * 2 + 1]) / 2).toFloat()
  path.moveTo(mx(0), my(0))
  for (i in 1..n) {
    path.quadTo(outline[(i % n) * 2].toFloat(), outline[(i % n) * 2 + 1].toFloat(), mx(i), my(i))
  }
  path.close()
}

/** shapeWidth: line width of a shape. */
fun shapeWidth(size: Double, thinning: Double, points: DoubleList): Double {
  val pressure = if (points.size >= 3) points[2] else 0.5
  return max(size * 0.16, size * (1 + thinning * (pressure - 0.5) * 1.6))
}

fun shapeIsClosed(points: DoubleList): Boolean {
  val n = points.size
  return n >= 9 && hypot(points[0] - points[n - 3], points[1] - points[n - 2]) < 0.5
}

/** The centre line of a shape (drawn stroked, round joins and caps). */
fun shapeLine(points: DoubleList): Path {
  val line = Path()
  if (points.size < 6) {
    return line
  }
  line.moveTo(points[0].toFloat(), points[1].toFloat())
  var i = 3
  while (i + 1 < points.size) {
    line.lineTo(points[i].toFloat(), points[i + 1].toFloat())
    i += 3
  }
  if (shapeIsClosed(points)) {
    line.close()
  }
  return line
}

// ---------------------------------------------------------------------------
// Shapes: recognizeShape and its helpers from ink.ts.

private const val SHAPE_MIN_SIZE = 56.0
private const val SNAP_ANGLE = (4 * PI) / 180

private fun simplify(xs: DoubleArray, ys: DoubleArray, epsilon: Double): IntArray {
  val last = xs.size - 1
  val keep = BooleanArray(xs.size)
  keep[0] = true
  keep[last] = true
  val spans = ArrayList<Int>()
  spans.add(0)
  spans.add(last)
  while (spans.isNotEmpty()) {
    val to = spans.removeAt(spans.size - 1)
    val from = spans.removeAt(spans.size - 1)
    var worst = -1
    var worstDistance = epsilon
    val dx = xs[to] - xs[from]
    val dy = ys[to] - ys[from]
    val length = hypot(dx, dy).let { if (it == 0.0) 1.0 else it }
    for (i in from + 1 until to) {
      val distance = abs(dy * (xs[i] - xs[from]) - dx * (ys[i] - ys[from])) / length
      if (distance > worstDistance) {
        worst = i
        worstDistance = distance
      }
    }
    if (worst >= 0) {
      keep[worst] = true
      spans.add(from)
      spans.add(worst)
      spans.add(worst)
      spans.add(to)
    }
  }
  return keep.indices.filter { keep[it] }.toIntArray()
}

private fun segmentDistance(px: Double, py: Double, ax: Double, ay: Double, bx: Double, by: Double): Double {
  val abx = bx - ax
  val aby = by - ay
  val len2 = abx * abx + aby * aby
  val t = if (len2 > 0) max(0.0, min(1.0, ((px - ax) * abx + (py - ay) * aby) / len2)) else 0.0
  return hypot(ax + abx * t - px, ay + aby * t - py)
}

private fun polylineError(xs: DoubleArray, ys: DoubleArray, corners: List<Double>): Double {
  var total = 0.0
  for (i in xs.indices) {
    var best = Double.POSITIVE_INFINITY
    var c = 0
    while (c + 3 < corners.size) {
      best = min(best, segmentDistance(xs[i], ys[i], corners[c], corners[c + 1], corners[c + 2], corners[c + 3]))
      c += 2
    }
    total += best
  }
  return total / xs.size
}

private fun snapDirection(dx: Double, dy: Double): DoubleArray {
  val length = hypot(dx, dy)
  val angle = atan2(dy, dx)
  val step = PI / 4
  // Math.round in JS: halves go up (Kotlin's round would go to even).
  val nearest = floor(angle / step + 0.5) * step
  if (abs(angle - nearest) < SNAP_ANGLE) {
    return doubleArrayOf(cos(nearest) * length, sin(nearest) * length)
  }
  return doubleArrayOf(dx, dy)
}

private fun resample(corners: List<Double>, spacing: Double, pressure: Double): DoubleList {
  val out = DoubleList()
  out.add(corners[0], corners[1], pressure)
  var c = 0
  while (c + 3 < corners.size) {
    val ax = corners[c]
    val ay = corners[c + 1]
    val bx = corners[c + 2]
    val by = corners[c + 3]
    val steps = max(1.0, ceil(hypot(bx - ax, by - ay) / spacing)).toInt()
    for (k in 1..steps) {
      out.add(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, pressure)
    }
    c += 2
  }
  return out
}

/** recognizeShape: the clean shape a held stroke resembles, or null. */
fun recognizeShape(points: DoubleList): DoubleList? {
  val count = points.size / 3
  if (count < 3) {
    return null
  }
  val xs = DoubleArray(count)
  val ys = DoubleArray(count)
  var pressure = 0.0
  var length = 0.0
  var minX = Double.POSITIVE_INFINITY
  var minY = Double.POSITIVE_INFINITY
  var maxX = Double.NEGATIVE_INFINITY
  var maxY = Double.NEGATIVE_INFINITY
  for (i in 0 until count) {
    val x = points[i * 3]
    val y = points[i * 3 + 1]
    if (i > 0) {
      length += hypot(x - xs[i - 1], y - ys[i - 1])
    }
    xs[i] = x
    ys[i] = y
    pressure += points[i * 3 + 2]
    minX = min(minX, x)
    maxX = max(maxX, x)
    minY = min(minY, y)
    maxY = max(maxY, y)
  }
  pressure /= count
  val size = hypot(maxX - minX, maxY - minY)
  if (size < SHAPE_MIN_SIZE) {
    return null
  }
  val spacing = 2.0
  val n = count - 1
  val chord = hypot(xs[n] - xs[0], ys[n] - ys[0])

  if (chord > size * 0.9) {
    var worst = 0.0
    for (i in 0 until count) {
      worst = max(worst, segmentDistance(xs[i], ys[i], xs[0], ys[0], xs[n], ys[n]))
    }
    if (worst < max(3.0, chord * 0.06)) {
      val d = snapDirection(xs[n] - xs[0], ys[n] - ys[0])
      return resample(listOf(xs[0], ys[0], xs[0] + d[0], ys[0] + d[1]), spacing, pressure)
    }
  }

  val closed = chord < size * 0.25 && length > size * 1.5
  val epsilon = size * 0.06
  val indices = simplify(xs, ys, epsilon)
  val corners = ArrayList<Double>()
  indices.forEach { corners.add(xs[it]); corners.add(ys[it]) }

  if (closed) {
    val cx = (minX + maxX) / 2
    val cy = (minY + maxY) / 2
    var rx = (maxX - minX) / 2
    var ry = (maxY - minY) / 2
    var ellipseError = 0.0
    val rxd = if (rx == 0.0) 1.0 else rx
    val ryd = if (ry == 0.0) 1.0 else ry
    for (i in 0 until count) {
      ellipseError += abs(hypot((xs[i] - cx) / rxd, (ys[i] - cy) / ryd) - 1)
    }
    ellipseError /= count

    // splice(-2, 2): drop the last corner (it repeats the first).
    if (corners.size >= 2) {
      corners.removeAt(corners.size - 1)
      corners.removeAt(corners.size - 1)
    }
    var changed = true
    while (changed && corners.size > 6) {
      changed = false
      val count2 = corners.size / 2
      for (c in 0 until count2) {
        val p = ((c - 1 + count2) % count2) * 2
        val q = ((c + 1) % count2) * 2
        val a1 = atan2(corners[c * 2 + 1] - corners[p + 1], corners[c * 2] - corners[p])
        val a2 = atan2(corners[q + 1] - corners[c * 2 + 1], corners[q] - corners[c * 2])
        var turn = abs(a2 - a1)
        turn = min(turn, PI * 2 - turn)
        if (turn < (25 * PI) / 180) {
          corners.removeAt(c * 2)
          corners.removeAt(c * 2)
          changed = true
          break
        }
      }
    }
    val sides = corners.size / 2
    if (sides in 3..5) {
      val ring = ArrayList(corners)
      ring.add(corners[0])
      ring.add(corners[1])
      val polygonError = polylineError(xs, ys, ring) / size
      if (polygonError < 0.035 && polygonError * 2.5 < ellipseError) {
        if (sides == 4) {
          var square = true
          for (c in 0 until 4) {
            val ax = ring[c * 2]
            val ay = ring[c * 2 + 1]
            val bx = ring[c * 2 + 2]
            val by = ring[c * 2 + 3]
            val angle = abs(atan2(by - ay, bx - ax)) % (PI / 2)
            if (min(angle, PI / 2 - angle) > (12 * PI) / 180) {
              square = false
            }
          }
          if (square) {
            return resample(listOf(minX, minY, maxX, minY, maxX, maxY, minX, maxY, minX, minY), spacing, pressure)
          }
        }
        return resample(ring, spacing, pressure)
      }
    }
    if (ellipseError < 0.1) {
      if (abs(rx - ry) < max(rx, ry) * 0.08) {
        rx = (rx + ry) / 2
        ry = rx
      }
      val start = atan2((ys[0] - cy) / (if (ry == 0.0) 1.0 else ry), (xs[0] - cx) / (if (rx == 0.0) 1.0 else rx))
      var turn = 0.0
      for (i in 1 until count) {
        turn += (xs[i - 1] - cx) * (ys[i] - cy) - (ys[i - 1] - cy) * (xs[i] - cx)
      }
      val direction = if (turn >= 0) 1 else -1
      val steps = max(24.0, ceil((PI * (rx + ry)) / spacing)).toInt()
      val out = DoubleList()
      for (k in 0..steps) {
        val angle = start + direction * ((k.toDouble() / steps) * PI * 2)
        out.add(cx + cos(angle) * rx, cy + sin(angle) * ry, pressure)
      }
      return out
    }
    return null
  }

  val parts = corners.size / 2 - 1
  if (parts in 2..4 && polylineError(xs, ys, corners) / size < 0.025) {
    return resample(corners, spacing, pressure)
  }
  return null
}
