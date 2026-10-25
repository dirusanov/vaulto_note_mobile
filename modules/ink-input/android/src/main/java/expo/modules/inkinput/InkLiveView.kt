package expo.modules.inkinput

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.BlendMode
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.view.Choreographer
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.SurfaceView
import androidx.annotation.RequiresApi
import androidx.graphics.lowlatency.CanvasFrontBufferedRenderer
import androidx.input.motionprediction.MotionEventPredictor
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

/**
 * Draws the stroke under the pen (or finger) natively, in a front-buffered
 * layer over the canvas: the ink reaches the screen within a frame of the pen
 * moving, without React Native, the gesture library or the canvas taking part.
 *
 * InkInputView, which sees every touch first, hands the touches meant for ink
 * to the view on screen ([current]). When the pen lifts, the stroke goes to JS
 * (onInkStroke) and stays drawn here until the canvas has drawn it itself and
 * calls [release].
 *
 * Everything stays in the front buffer: the stroke under the pen, lifted
 * strokes waiting for the canvas, the hover dot. Each update repaints only the
 * part of the buffer that changed, with all of them in it. The renderer's
 * commit to its multi-buffered layer is never used: it hides and clears the
 * front buffer asynchronously, and a stroke begun meanwhile vanished for a
 * frame or two (fast handwriting blinked).
 *
 * Coordinates: touches arrive in this view's pixels; the canvas works in
 * density-independent pixels, and the drawing in document units through the
 * canvas's pan and zoom ([setTransform]). The stroke is modelled in document
 * units by the same code as ink.ts (InkGeometry.kt), so the committed stroke is
 * the same shape as the one drawn here.
 */
class InkLiveView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onInkBegin by EventDispatcher()
  private val onInkStroke by EventDispatcher()

  private val density = resources.displayMetrics.density
  private val surface = SurfaceView(context).apply {
    // Above the canvas's own SurfaceView, below the window: React views over the
    // canvas (tool bars, popovers) stay on top.
    setZOrderMediaOverlay(true)
    holder.setFormat(PixelFormat.TRANSLUCENT)
  }
  private var renderer: Any? = null

  init {
    addView(surface)
  }

  // ---------------------------------------------------------------- config

  /** What the next stroke draws with; set from JS. */
  class Config(
    val enabled: Boolean = false,
    val fingers: Boolean = false,
    val tool: String = "fountain",
    val color: String = "#000000",
    val colorInt: Int = Color.BLACK,
    val size: Double = 3.0,
    val spec: InkSpec = InkSpec(0.5, 0.2, true, 0.0),
    val opacity: Float = 1f,
    val grain: Boolean = false,
    val snapShapes: Boolean = false,
    val invert: Boolean = false,
    val hoverColor: Int = Color.BLACK,
    /** Pages clip the ink at their edges: [docWidth, pitch, pageHeight, count], or null for a canvas. */
    val pages: DoubleArray? = null,
  )

  @Volatile private var config = Config()
  private var clip: Path? = null

  fun setConfig(map: Map<String, Any?>) {
    fun num(key: String, fallback: Double) = (map[key] as? Number)?.toDouble() ?: fallback
    fun flag(key: String) = map[key] as? Boolean ?: false
    val color = map["color"] as? String ?: "#000000"
    val pages = (map["pages"] as? List<*>)?.mapNotNull { (it as? Number)?.toDouble() }?.toDoubleArray()
    val next = Config(
      enabled = flag("enabled"),
      fingers = flag("fingers"),
      tool = map["tool"] as? String ?: "fountain",
      color = color,
      colorInt = parseColor(color),
      size = num("size", 3.0),
      spec = InkSpec(num("thinning", 0.5), num("streamline", 0.2), flag("taper"), num("nib", 0.0)),
      opacity = num("opacity", 1.0).toFloat(),
      grain = flag("grain"),
      snapShapes = flag("snapShapes"),
      invert = flag("invert"),
      hoverColor = parseColor(map["hoverColor"] as? String ?: color),
      pages = if (pages != null && pages.size == 4) pages else null,
    )
    if (!next.pages.contentEquals(config.pages)) {
      clip = next.pages?.let { (docWidth, pitch, pageHeight, count) ->
        Path().apply {
          for (i in 0 until count.toInt()) {
            addRect(0f, (i * pitch).toFloat(), docWidth.toFloat(), (i * pitch + pageHeight).toFloat(), Path.Direction.CW)
          }
        }
      }
    }
    config = next
    if (!next.enabled) {
      hoverEnd()
    }
  }

  /** Document → screen (dp): x * scale + tx. */
  @Volatile private var transform = doubleArrayOf(0.0, 0.0, 1.0)

  fun setTransform(tx: Double, ty: Double, scale: Double) {
    transform = doubleArrayOf(tx, ty, scale)
  }

  /** Document units → this view's pixels. */
  private fun docMatrix(t: DoubleArray): Matrix = Matrix().apply {
    setScale((t[2] * density).toFloat(), (t[2] * density).toFloat())
    postTranslate((t[0] * density).toFloat(), (t[1] * density).toFloat())
  }

  // ------------------------------------------------------------- rendering

  /** How a stroke is painted: colour, opacity, grain, dark-mode filter, page clip. */
  private class Style(
    val color: Int,
    val opacity: Float,
    val grain: Boolean,
    val invert: Boolean,
    val clip: Path?,
    val matrix: Matrix,
  )

  /** The stroke under the pen as last built: shared with the render thread, never changed. */
  private class LiveInk(
    val style: Style,
    /** Frozen pieces and the tail of the outline, in document units. */
    val pieces: List<Path>,
    val tail: Path?,
    /** Centre line of a shape or of the predicted pen path, stroked at [lineWidth]. */
    val line: Path?,
    val lineWidth: Float,
  )

  /** A lifted stroke shown until the canvas draws it; [bounds] in this view's pixels. */
  private class Held(val id: Int, val style: Style, val path: Path?, val line: Path?, val lineWidth: Float, val bounds: RectF)

  /** The whole picture at one moment, and the pixels it changed. */
  private class Frame(
    /** Pixels to repaint; everything outside them is already right. */
    val dirty: RectF,
    val held: List<Held>,
    val live: LiveInk?,
    val hover: FloatArray?,
    val hoverColor: Int,
  )

  private val held = CopyOnWriteArrayList<Held>()
  private var liveInk: LiveInk? = null
  private var hoverDot: FloatArray? = null
  private val latest = AtomicReference<Frame?>(null)
  private var pendingDirty = RectF()

  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val layerPaint = Paint()
  private val hoverPaint = Paint(Paint.ANTI_ALIAS_FLAG)

  /** Draws ink in the layer it needs: one opacity over the whole stroke, as the canvas fills one path. */
  private fun drawInk(canvas: Canvas, style: Style, pieces: List<Path>, tail: Path?, line: Path?, lineWidth: Float, round: Boolean) {
    canvas.save()
    canvas.concat(style.matrix)
    style.clip?.let { canvas.clipPath(it) }
    layerPaint.alpha = (style.opacity * 255).toInt().coerceIn(0, 255)
    layerPaint.colorFilter = if (style.invert) INVERT_FILTER else null
    canvas.saveLayer(null, layerPaint)
    fillPaint.color = style.color
    fillPaint.alpha = 255
    fillPaint.shader = if (style.grain) grainShader else null
    for (piece in pieces) {
      canvas.drawPath(piece, fillPaint)
    }
    tail?.let { canvas.drawPath(it, fillPaint) }
    if (line != null) {
      linePaint.color = style.color
      linePaint.alpha = 255
      linePaint.shader = fillPaint.shader
      linePaint.strokeWidth = lineWidth
      linePaint.strokeCap = if (round) Paint.Cap.ROUND else Paint.Cap.BUTT
      linePaint.strokeJoin = Paint.Join.ROUND
      canvas.drawPath(line, linePaint)
    }
    canvas.restore()
    canvas.restore()
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun makeRenderer() = CanvasFrontBufferedRenderer(surface, object : CanvasFrontBufferedRenderer.Callback<Frame> {
    // Both run on the renderer's own thread.
    override fun onDrawFrontBufferedLayer(canvas: Canvas, bufferWidth: Int, bufferHeight: Int, param: Frame) {
      pendingDirty.union(param.dirty)
      // Samples come faster than frames: only the newest state is drawn, over
      // everything the skipped ones changed.
      if (latest.get() !== param) {
        return
      }
      canvas.save()
      canvas.clipRect(pendingDirty)
      canvas.drawColor(Color.TRANSPARENT, BlendMode.CLEAR)
      for (stroke in param.held) {
        if (RectF.intersects(stroke.bounds, pendingDirty)) {
          drawInk(canvas, stroke.style, stroke.path?.let { listOf(it) } ?: emptyList(), null, stroke.line, stroke.lineWidth, true)
        }
      }
      param.live?.let { drawInk(canvas, it.style, it.pieces, it.tail, it.line, it.lineWidth, true) }
      param.hover?.let { (x, y, r) ->
        hoverPaint.color = param.hoverColor
        hoverPaint.alpha = (0.18f * 255).toInt()
        canvas.drawCircle(x, y, r, hoverPaint)
      }
      canvas.restore()
      pendingDirty = RectF()
    }

    // Never committed to (see above); empty when the renderer sets itself up.
    override fun onDrawMultiBufferedLayer(canvas: Canvas, bufferWidth: Int, bufferHeight: Int, params: Collection<Frame>) {
      canvas.drawColor(Color.TRANSPARENT, BlendMode.CLEAR)
    }
  })

  @Suppress("UNCHECKED_CAST")
  private val frontRenderer: CanvasFrontBufferedRenderer<Frame>?
    get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) renderer as? CanvasFrontBufferedRenderer<Frame> else null

  /** Repaints [dirty] (this view's pixels) with everything as it is now. */
  private fun show(dirty: RectF) {
    if (dirty.isEmpty) {
      return
    }
    val frame = Frame(RectF(dirty), held.toList(), liveInk, hoverDot, config.hoverColor)
    latest.set(frame)
    frontRenderer?.renderFrontBufferedLayer(frame)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    current = WeakReference(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && renderer == null) {
      renderer = makeRenderer()
    }
  }

  override fun onDetachedFromWindow() {
    if (current?.get() === this) {
      current = null
    }
    cancelStroke()
    frontRenderer?.release(true)
    renderer = null
    super.onDetachedFromWindow()
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    surface.layout(0, 0, r - l, b - t)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    surface.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    surface.layout(0, 0, w, h)
  }

  // ---------------------------------------------------------------- input

  /** True when a touch at (x, y) of [from]'s coordinates should draw here. */
  fun wants(from: android.view.View, x: Float, y: Float, isPen: Boolean): Boolean {
    val cfg = config
    if (!cfg.enabled || renderer == null || !isShown || (!isPen && !cfg.fingers)) {
      return false
    }
    val local = toLocal(from, x, y)
    return local[0] >= 0 && local[1] >= 0 && local[0] < width && local[1] < height
  }

  private val fromLoc = IntArray(2)
  private val ownLoc = IntArray(2)
  private var offsetX = 0f
  private var offsetY = 0f

  private fun toLocal(from: android.view.View, x: Float, y: Float): FloatArray {
    from.getLocationInWindow(fromLoc)
    getLocationInWindow(ownLoc)
    offsetX = (fromLoc[0] - ownLoc[0]).toFloat()
    offsetY = (fromLoc[1] - ownLoc[1]).toFloat()
    return floatArrayOf(x + offsetX, y + offsetY)
  }

  /** The stroke being drawn. */
  private class Live(
    val id: Int,
    val config: Config,
    val style: Style,
    val transform: DoubleArray,
    val isPen: Boolean,
  ) {
    val points = DoubleList(512)
    val trace = InkTrace(config.size, config.spec.thinning, config.spec.streamline, config.spec.taper, config.spec.nib)
    val pieces = ArrayList<Path>()
    var frozenTo = -1
    var snapped = false
    var stillX = 0f
    var stillY = 0f
    var stillT = 0L
    var lastX = 0f
    var lastY = 0f
    var lastT = 0L
    var lastP = 0.55
    var tailBounds = RectF()
    /** Everything the stroke has covered on screen, to clear it if it is cancelled. */
    val allBounds = RectF()
  }

  private var live: Live? = null
  private var nextId = 1
  private var predictor: MotionEventPredictor? = null

  /** Starts a stroke; the event's coordinates are in [from]'s pixels. */
  fun begin(from: android.view.View, event: MotionEvent, index: Int, isPen: Boolean) {
    val cfg = config
    val t = transform
    // The dot goes where it was; the stroke's own frames only repaint around the nib.
    hoverEnd()
    toLocal(from, 0f, 0f)
    val stroke = Live(
      nextId++,
      cfg,
      Style(cfg.colorInt, cfg.opacity, cfg.grain, cfg.invert, clip, docMatrix(t)),
      t,
      isPen,
    )
    live = stroke
    val x = event.getX(index) + offsetX
    val y = event.getY(index) + offsetY
    val time = event.eventTime
    val pressure = if (isPen) event.getPressure(index).toDouble() else 0.55
    stroke.lastX = x
    stroke.lastY = y
    stroke.lastT = time
    stroke.lastP = pressure
    stroke.stillX = x
    stroke.stillY = y
    stroke.stillT = time
    addSample(stroke, x, y, pressure)
    predictor = if (isPen) MotionEventPredictor.newInstance(this) else null
    record(event, index)
    render(stroke)
    if (cfg.snapShapes) {
      Choreographer.getInstance().postFrameCallback(shapeWatch)
    }
    onInkBegin(mapOf("stylus" to isPen))
  }

  /** All samples of a move, oldest first. */
  fun move(event: MotionEvent, index: Int) {
    val stroke = live ?: return
    if (stroke.snapped) {
      // The shape stays as it snapped until the pen lifts.
      return
    }
    for (h in 0 until event.historySize) {
      sample(stroke, event.getHistoricalX(index, h) + offsetX, event.getHistoricalY(index, h) + offsetY,
        event.getHistoricalPressure(index, h).toDouble(), event.getHistoricalEventTime(h))
    }
    sample(stroke, event.getX(index) + offsetX, event.getY(index) + offsetY, event.getPressure(index).toDouble(), event.eventTime)
    record(event, index)
    render(stroke)
  }

  /** The pen or finger lifted: the stroke is finished and goes to the canvas. */
  fun end(event: MotionEvent, index: Int) {
    val stroke = live ?: return
    if (!stroke.snapped) {
      for (h in 0 until event.historySize) {
        sample(stroke, event.getHistoricalX(index, h) + offsetX, event.getHistoricalY(index, h) + offsetY,
          event.getHistoricalPressure(index, h).toDouble(), event.getHistoricalEventTime(h))
      }
      // The lift-off point ends the line, even when no move reported it.
      val end = toDoc(stroke, event.getX(index) + offsetX, event.getY(index) + offsetY)
      val pts = stroke.points
      val n = pts.size
      if (n >= 3 && hypot(end[0] - pts[n - 3], end[1] - pts[n - 2]) > 0.5) {
        pts.add(end[0], end[1], pts[n - 1])
      }
    }
    finish(stroke)
  }

  /** The touch was cancelled (a palm, a second finger): its ink is void. */
  fun cancelStroke() {
    val stroke = live ?: return
    live = null
    predictor = null
    Choreographer.getInstance().removeFrameCallback(shapeWatch)
    liveInk = null
    show(RectF(stroke.allBounds))
  }

  private fun record(event: MotionEvent, index: Int) {
    val predictor = predictor ?: return
    // The predictor wants the pen alone, as a view's own events.
    val single = singlePointer(event, index)
    predictor.record(single)
    single.recycle()
  }

  private fun singlePointer(event: MotionEvent, index: Int): MotionEvent {
    val properties = MotionEvent.PointerProperties()
    event.getPointerProperties(index, properties)
    properties.id = 0
    val count = event.historySize
    val action = when (event.actionMasked) {
      MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> MotionEvent.ACTION_DOWN
      MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> MotionEvent.ACTION_UP
      MotionEvent.ACTION_CANCEL -> MotionEvent.ACTION_CANCEL
      else -> MotionEvent.ACTION_MOVE
    }
    fun coordsAt(h: Int): Array<MotionEvent.PointerCoords> {
      val c = MotionEvent.PointerCoords()
      if (h >= 0) event.getHistoricalPointerCoords(index, h, c) else event.getPointerCoords(index, c)
      c.x += offsetX
      c.y += offsetY
      return arrayOf(c)
    }
    val first = if (count > 0) 0 else -1
    val out = MotionEvent.obtain(
      event.downTime, if (first >= 0) event.getHistoricalEventTime(0) else event.eventTime, action, 1,
      arrayOf(properties), coordsAt(first), event.metaState, event.buttonState, 1f, 1f,
      event.deviceId, 0, event.source, event.flags,
    )
    for (h in 1 until count) {
      out.addBatch(event.getHistoricalEventTime(h), coordsAt(h), event.metaState)
    }
    if (count > 0) {
      out.addBatch(event.eventTime, coordsAt(-1), event.metaState)
    }
    return out
  }

  private fun toDoc(stroke: Live, px: Float, py: Float): DoubleArray {
    val t = stroke.transform
    val x = px / density
    val y = py / density
    return doubleArrayOf((x - t[0]) / t[2], (y - t[1]) / t[2])
  }

  private fun addSample(stroke: Live, px: Float, py: Float, pressure: Double) {
    val d = toDoc(stroke, px, py)
    stroke.points.add(d[0], d[1], pressure)
  }

  /** One sample of a move, as DrawingCanvas's onUpdate takes it (pressure from speed for a finger). */
  private fun sample(stroke: Live, px: Float, py: Float, rawPressure: Double, time: Long) {
    val sx = px / density
    val sy = py / density
    if (hypot(sx - stroke.stillX / density, sy - stroke.stillY / density) > SHAPE_STILL_DP) {
      stroke.stillX = px
      stroke.stillY = py
      stroke.stillT = time
    }
    val pressure: Double
    if (stroke.isPen) {
      pressure = rawPressure
    } else {
      // A finger has no pressure: faster movement draws thinner, like ink.
      val dt = time - stroke.lastT
      if (dt >= SPEED_WINDOW_MS) {
        val speed = hypot(sx - stroke.lastX / density, sy - stroke.lastY / density) / dt
        val target = min(0.9, max(0.2, 0.85 - speed * 0.22))
        pressure = stroke.lastP + (target - stroke.lastP) * 0.3
        stroke.lastX = px
        stroke.lastY = py
        stroke.lastT = time
        stroke.lastP = pressure
      } else {
        pressure = stroke.lastP
      }
    }
    addSample(stroke, px, py, pressure)
  }

  /** Builds the outline of what is new and shows it. */
  private fun render(stroke: Live) {
    val matrix = stroke.style.matrix
    if (stroke.snapped) {
      // Drawn once, when it snaps: the hand-drawn line goes, the shape comes.
      val line = shapeLine(stroke.points)
      val width = shapeWidth(stroke.config.size, stroke.config.spec.thinning, stroke.points).toFloat()
      liveInk = LiveInk(stroke.style, emptyList(), null, line, width)
      val bounds = RectF().also { line.computeBounds(it, true) }
      bounds.inset(-width, -width)
      matrix.mapRect(bounds)
      bounds.inset(-DIRTY_PAD, -DIRTY_PAD)
      stroke.allBounds.union(bounds)
      show(RectF(stroke.allBounds))
      return
    }
    val trace = stroke.trace
    trace.append(stroke.points)
    var piece = nextFrozenPiece(stroke.frozenTo, trace.done)
    while (piece != null) {
      val path = Path()
      addOutline(path, trace.outline(null, piece[0], piece[1], piece[0] == 0, false))
      stroke.pieces.add(path)
      stroke.frozenTo = piece[1]
      piece = nextFrozenPiece(stroke.frozenTo, trace.done)
    }
    val tail = trace.tail(stroke.points)
    if (tail.n == 0) {
      return
    }
    val from = liveTailStart(stroke.frozenTo)
    val outline = trace.outline(tail, from, tail.n - 1, from == 0, true)
    val tailPath = Path()
    addOutline(tailPath, outline)
    val bounds = outlineBounds(outline)
    // Where the pen is about to be: a short line on from the nib, redrawn with
    // each sample. It only bridges the time to the next sample.
    var prediction: Path? = null
    var predictionWidth = 0f
    val predicted = predictor?.predict()
    if (predicted != null) {
      val last = tail.n - 1 - trace.done
      val radius = if (last >= 0 && last < tail.radius.size) tail.radius[last] else trace.size / 2
      val startX = stroke.points[stroke.points.size - 3]
      val startY = stroke.points[stroke.points.size - 2]
      val line = Path().apply { moveTo(startX.toFloat(), startY.toFloat()) }
      var reach = 0.0
      var px = startX
      var py = startY
      val limit = MAX_PREDICTION_DP / stroke.transform[2]
      for (h in 0..predicted.historySize) {
        val x = if (h < predicted.historySize) predicted.getHistoricalX(0, h) else predicted.getX(0)
        val y = if (h < predicted.historySize) predicted.getHistoricalY(0, h) else predicted.getY(0)
        val d = toDoc(stroke, x, y)
        val step = hypot(d[0] - px, d[1] - py)
        if (reach + step > limit) {
          break
        }
        reach += step
        line.lineTo(d[0].toFloat(), d[1].toFloat())
        bounds.union(d[0].toFloat() - radius.toFloat(), d[1].toFloat() - radius.toFloat(), d[0].toFloat() + radius.toFloat(), d[1].toFloat() + radius.toFloat())
        px = d[0]
        py = d[1]
      }
      predicted.recycle()
      if (reach > 0) {
        prediction = line
        predictionWidth = (radius * 2).toFloat()
      }
    }
    matrix.mapRect(bounds)
    bounds.inset(-DIRTY_PAD, -DIRTY_PAD)
    val dirty = RectF(bounds)
    dirty.union(stroke.tailBounds)
    stroke.tailBounds = bounds
    stroke.allBounds.union(bounds)
    liveInk = LiveInk(stroke.style, ArrayList(stroke.pieces), tailPath, prediction, predictionWidth)
    show(dirty)
  }

  private fun outlineBounds(outline: DoubleList): RectF {
    var minX = Double.POSITIVE_INFINITY
    var minY = Double.POSITIVE_INFINITY
    var maxX = Double.NEGATIVE_INFINITY
    var maxY = Double.NEGATIVE_INFINITY
    var i = 0
    while (i + 1 < outline.size) {
      minX = min(minX, outline[i])
      maxX = max(maxX, outline[i])
      minY = min(minY, outline[i + 1])
      maxY = max(maxY, outline[i + 1])
      i += 2
    }
    return if (minX <= maxX) RectF(minX.toFloat(), minY.toFloat(), maxX.toFloat(), maxY.toFloat()) else RectF()
  }

  /** Watches for the pen coming to rest, to straighten the stroke into a shape. */
  private val shapeWatch = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      val stroke = live ?: return
      if (stroke.snapped || !stroke.config.snapShapes) {
        return
      }
      if (SystemClock.uptimeMillis() - stroke.stillT >= SHAPE_HOLD_MS) {
        val shape = recognizeShape(stroke.points)
        if (shape != null) {
          stroke.snapped = true
          stroke.points.clear()
          for (i in 0 until shape.size) {
            stroke.points.add(shape[i])
          }
          performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
          render(stroke)
          return
        }
        // Not a shape: try again only after the pen moves and rests anew.
        stroke.stillT = Long.MAX_VALUE / 2
      }
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  private fun finish(stroke: Live) {
    live = null
    predictor = null
    Choreographer.getInstance().removeFrameCallback(shapeWatch)
    val points = stroke.points.toArray()
    val all = DoubleList(points.size).also { list -> points.forEach { list.add(it) } }
    // Shown as it will be committed (no prediction), until the canvas has it.
    val bounds = RectF()
    val entry = if (stroke.snapped) {
      val line = shapeLine(all)
      val width = shapeWidth(stroke.config.size, stroke.config.spec.thinning, all).toFloat()
      line.computeBounds(bounds, true)
      bounds.inset(-width, -width)
      Held(stroke.id, stroke.style, null, line, width, bounds)
    } else {
      val path = Path()
      addOutline(path, strokeOutline(all, stroke.config.size, stroke.config.spec, false))
      path.computeBounds(bounds, true)
      Held(stroke.id, stroke.style, path, null, 0f, bounds)
    }
    stroke.style.matrix.mapRect(bounds)
    bounds.inset(-DIRTY_PAD, -DIRTY_PAD)
    held.add(entry)
    liveInk = null
    // Over all the live stroke covered: the prediction ahead of the nib goes.
    show(RectF(stroke.allBounds).apply { union(bounds) })
    val payload = strokePayload(stroke, points)
    unacked[stroke.id] = payload
    onInkStroke(payload)
    // Should the canvas never report it drawn (it went away), it goes anyway.
    postDelayed({ release(listOf(stroke.id)) }, HELD_TIMEOUT_MS)
  }

  /** The canvas draws these strokes now: they stop being drawn here, a frame later to be safe. */
  fun release(ids: List<Int>) {
    ids.forEach { unacked.remove(it) }
    Choreographer.getInstance().postFrameCallback {
      val gone = held.filter { it.id in ids }
      if (gone.isNotEmpty()) {
        held.removeAll(gone.toSet())
        val dirty = RectF()
        gone.forEach { dirty.union(it.bounds) }
        show(dirty)
      }
    }
  }

  /** What JS gets for a stroke: its look, its samples, and the pan and zoom it was mapped with. */
  private fun strokePayload(stroke: Live, points: DoubleArray): Map<String, Any> = mapOf(
    "id" to stroke.id,
    "tool" to stroke.config.tool,
    "color" to stroke.config.color,
    "size" to stroke.config.size,
    "shape" to stroke.snapped,
    "points" to points.toList(),
    "transform" to stroke.transform.toList(),
  )

  /** Lifted strokes JS has not taken over yet (it lets go of them with [release]). */
  private val unacked = java.util.concurrent.ConcurrentHashMap<Int, Map<String, Any>>()

  /**
   * The strokes the canvas does not have yet: lifted ones whose event may still
   * be on its way, and the one under the pen. The canvas takes them when it
   * goes away (a theme switch remounts it), as it does with its own.
   */
  fun unfinishedStrokes(): List<Map<String, Any>> {
    val out = ArrayList<Map<String, Any>>(unacked.values.sortedBy { it["id"] as Int })
    live?.let { stroke ->
      if (stroke.points.size >= 3) {
        out.add(strokePayload(stroke, stroke.points.toArray()))
      }
    }
    return out
  }

  // ----------------------------------------------------------------- hover

  private var hoverDirty: RectF? = null

  fun hoverEnabled(): Boolean = config.enabled && renderer != null && live == null

  /** The pen hovers at (x, y) of [from]'s coordinates: a faint dot where the nib will land. */
  fun hover(from: android.view.View, x: Float, y: Float) {
    if (!hoverEnabled()) {
      return
    }
    val local = toLocal(from, x, y)
    val cfg = config
    val r = (max(1.5, cfg.size / 2 * transform[2]) * density).toFloat()
    val dirty = RectF(local[0] - r - DIRTY_PAD, local[1] - r - DIRTY_PAD, local[0] + r + DIRTY_PAD, local[1] + r + DIRTY_PAD)
    hoverDirty?.let { dirty.union(it) }
    hoverDirty = RectF(local[0] - r - DIRTY_PAD, local[1] - r - DIRTY_PAD, local[0] + r + DIRTY_PAD, local[1] + r + DIRTY_PAD)
    hoverDot = floatArrayOf(local[0], local[1], r)
    show(dirty)
  }

  fun hoverEnd(redraw: Boolean = true) {
    val dirty = hoverDirty ?: return
    hoverDirty = null
    hoverDot = null
    if (redraw) {
      show(dirty)
    }
  }

  companion object {
    /** The view on screen, if any (one drawing editor at a time). */
    var current: WeakReference<InkLiveView>? = null

    fun supported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

    private const val SPEED_WINDOW_MS = 8
    private const val SHAPE_HOLD_MS = 700L
    private const val SHAPE_STILL_DP = 6.0
    private const val MAX_PREDICTION_DP = 24.0
    private const val DIRTY_PAD = 3f
    private const val HELD_TIMEOUT_MS = 10_000L

    /** SMART_INVERT_MATRIX of ink.ts; Android takes the offsets in 0..255. */
    private val INVERT_FILTER = ColorMatrixColorFilter(ColorMatrix(floatArrayOf(
      0.574f, -1.43f, -0.144f, 0f, 255f,
      -0.426f, -0.43f, -0.144f, 0f, 255f,
      -0.426f, -1.43f, 0.856f, 0f, 255f,
      0f, 0f, 0f, 1f, 0f,
    )))

    /**
     * Pencil graphite: fine noise in the ink's alpha, close to the canvas's
     * fractal noise run through pencilGrainMatrix (alpha = 2.6·noise − 0.55).
     * In document units, so it stays put under the moving pen.
     */
    private val grainShader: Shader by lazy {
      // The canvas's noise (base frequency 0.9, two octaves) shows as grain finer
      // than a document unit: cells of half and a quarter unit, drawn at 8 px a unit.
      val units = 64
      val perUnit = 8
      val size = units * perUnit
      val random = Random(3)
      fun grid(n: Int) = Array(n) { FloatArray(n) { random.nextFloat() * 2 - 1 } }
      val coarse = grid(units * 2)
      val fine = grid(units * 4)
      fun sample(g: Array<FloatArray>, u: Float, v: Float): Float {
        val n = g.size
        val x0 = u.toInt()
        val y0 = v.toInt()
        val fx = u - x0
        val fy = v - y0
        val sx = fx * fx * (3 - 2 * fx)
        val sy = fy * fy * (3 - 2 * fy)
        val a = g[y0 % n][x0 % n]
        val b = g[y0 % n][(x0 + 1) % n]
        val c = g[(y0 + 1) % n][x0 % n]
        val d = g[(y0 + 1) % n][(x0 + 1) % n]
        return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy
      }
      val pixels = IntArray(size * size)
      for (y in 0 until size) {
        for (x in 0 until size) {
          val u = x.toFloat() / perUnit
          val v = y.toFloat() / perUnit
          val noise = sample(coarse, u * 2, v * 2) * 0.5f + sample(fine, u * 4, v * 4) * 0.35f
          val value = 0.54f + noise * 0.5f
          val alpha = (2.6f * value - 0.55f).coerceIn(0f, 1f)
          pixels[y * size + x] = Color.argb((alpha * 255).toInt(), 255, 255, 255)
        }
      }
      val bitmap = Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888).extractAlpha()
      BitmapShader(bitmap, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT).apply {
        setLocalMatrix(Matrix().apply { setScale(1f / perUnit, 1f / perUnit) })
      }
    }

    private fun parseColor(value: String): Int = try {
      Color.parseColor(value)
    } catch (_: IllegalArgumentException) {
      Color.BLACK
    }
  }
}
