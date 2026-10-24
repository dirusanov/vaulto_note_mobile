package expo.modules.inkinput

import android.content.Context
import android.os.Build
import android.view.InputDevice
import android.view.MotionEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Wraps the drawing editor, above its gesture handler root, and prepares touch
 * input the way a notebook app needs it:
 *
 * - Unbuffered dispatch. Android batches touch samples and hands them to the
 *   app once per frame; the gesture library then only sees the newest one, so
 *   a fast stroke lost most of its points. Asking for unbuffered dispatch on
 *   touch-down delivers samples as they arrive, and the few that still come
 *   batched are replayed one by one.
 * - Palm rejection. While a pen touches the screen, only the pen reaches the
 *   views below: a hand resting on the glass neither ends the stroke nor
 *   zooms. A palm that landed first is cancelled when the pen comes down, and
 *   fingers still down when the pen lifts are ignored until they lift too.
 * - Pen eraser. The eraser end of a pen, or the pen with its side button held,
 *   is passed on as a pen with pressure [ERASER_PRESSURE]; the canvas erases.
 * - Native ink. A touch that draws ink (the pen, or a finger when fingers
 *   draw) on the drawing canvas goes to [InkLiveView] alone, which draws it
 *   with the lowest latency the device allows; the views below never see it.
 *   A second finger turns a finger stroke into a scroll or pinch for them.
 */
class InkInputView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private enum class Stream { NONE, FINGERS, PEN, IGNORE, INK_PEN, INK_FINGER }

  private var stream = Stream.NONE
  private var penId = -1
  private var penDownTime = 0L
  private var penErasing = false

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    val action = event.actionMasked
    if (action == MotionEvent.ACTION_DOWN) {
      requestUnbufferedDispatch(event)
      stream = Stream.NONE
    }
    when (stream) {
      Stream.NONE -> {
        if (action != MotionEvent.ACTION_DOWN) {
          return super.dispatchTouchEvent(event)
        }
        if (isPen(event, 0)) {
          startPen(event, 0)
          return true
        }
        if (startInk(event, 0, false)) {
          return true
        }
        stream = Stream.FINGERS
        return super.dispatchTouchEvent(event)
      }
      Stream.FINGERS -> {
        if (action == MotionEvent.ACTION_POINTER_DOWN && isPen(event, event.actionIndex)) {
          // The palm touched first: whatever it started is void, the pen begins anew.
          val cancel = MotionEvent.obtain(event)
          cancel.action = MotionEvent.ACTION_CANCEL
          super.dispatchTouchEvent(cancel)
          cancel.recycle()
          startPen(event, event.actionIndex)
          return true
        }
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
          stream = Stream.NONE
        }
        if (action == MotionEvent.ACTION_MOVE && event.pointerCount == 1 && event.historySize > 0) {
          // A finger drawing alone: its batched samples too. (Two fingers scroll or zoom; the newest sample is enough.)
          for (h in 0 until event.historySize) {
            send(event, 0, MotionEvent.ACTION_MOVE, h, event.downTime)
          }
          send(event, 0, MotionEvent.ACTION_MOVE, -1, event.downTime)
          return true
        }
        return super.dispatchTouchEvent(event)
      }
      Stream.INK_PEN -> {
        val ink = inkView()
        val index = event.findPointerIndex(penId)
        if (ink == null || index < 0) {
          ink?.cancelStroke()
          stream = Stream.IGNORE
          return true
        }
        when (action) {
          MotionEvent.ACTION_MOVE -> ink.move(event, index)
          MotionEvent.ACTION_POINTER_UP -> if (event.actionIndex == index) {
            liftInk(ink, event, index)
            stream = Stream.IGNORE
          }
          MotionEvent.ACTION_UP -> {
            liftInk(ink, event, index)
            stream = Stream.NONE
          }
          MotionEvent.ACTION_CANCEL -> {
            ink.cancelStroke()
            stream = Stream.NONE
          }
          // Another pointer landing while the pen writes: a palm, ignored.
        }
        return true
      }
      Stream.INK_FINGER -> {
        val ink = inkView()
        if (ink == null) {
          stream = Stream.IGNORE
          return true
        }
        when (action) {
          MotionEvent.ACTION_MOVE -> ink.move(event, 0)
          MotionEvent.ACTION_UP -> {
            liftInk(ink, event, 0)
            stream = Stream.NONE
          }
          MotionEvent.ACTION_CANCEL -> {
            ink.cancelStroke()
            stream = Stream.NONE
          }
          MotionEvent.ACTION_POINTER_DOWN -> {
            ink.cancelStroke()
            if (isPen(event, event.actionIndex)) {
              // The hand touched first: the pen begins anew.
              startPen(event, event.actionIndex)
              return true
            }
            // A second finger: no stroke, but a scroll, zoom or two-finger tap
            // for the canvas, which has not seen the first finger yet.
            stream = Stream.FINGERS
            send(event, 0, MotionEvent.ACTION_DOWN, -1, event.downTime)
            return super.dispatchTouchEvent(event)
          }
        }
        return true
      }
      Stream.PEN -> {
        val index = event.findPointerIndex(penId)
        if (index < 0) {
          // The pen vanished without lifting: end what it started.
          val cancel = MotionEvent.obtain(event)
          cancel.action = MotionEvent.ACTION_CANCEL
          super.dispatchTouchEvent(cancel)
          cancel.recycle()
          stream = Stream.IGNORE
          return true
        }
        when (action) {
          MotionEvent.ACTION_MOVE -> {
            // Batched samples first, oldest to newest, then the current one.
            for (h in 0 until event.historySize) {
              send(event, index, MotionEvent.ACTION_MOVE, h)
            }
            send(event, index, MotionEvent.ACTION_MOVE)
          }
          MotionEvent.ACTION_POINTER_UP -> if (event.actionIndex == index) {
            send(event, index, liftAction(event))
            stream = Stream.IGNORE
          }
          MotionEvent.ACTION_UP -> {
            send(event, index, liftAction(event))
            stream = Stream.NONE
          }
          MotionEvent.ACTION_CANCEL -> {
            send(event, index, MotionEvent.ACTION_CANCEL)
            stream = Stream.NONE
          }
          // Another pointer landing while the pen writes: a palm, ignored.
        }
        return true
      }
      Stream.IGNORE -> {
        if (action == MotionEvent.ACTION_POINTER_DOWN && isPen(event, event.actionIndex)) {
          startPen(event, event.actionIndex)
        } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
          stream = Stream.NONE
        }
        return true
      }
    }
  }

  /**
   * How the pen's lift is passed on: Android 13+ marks a pointer it decided was
   * not meant to touch (e.g. an accidental contact) with FLAG_CANCELED on its
   * up event; that stroke is cancelled, not finished.
   */
  private fun liftAction(event: MotionEvent): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && event.flags and MotionEvent.FLAG_CANCELED != 0) {
      MotionEvent.ACTION_CANCEL
    } else {
      MotionEvent.ACTION_UP
    }

  private fun isPen(event: MotionEvent, index: Int): Boolean {
    val tool = event.getToolType(index)
    return tool == MotionEvent.TOOL_TYPE_STYLUS || tool == MotionEvent.TOOL_TYPE_ERASER
  }

  private fun startPen(event: MotionEvent, index: Int) {
    penId = event.getPointerId(index)
    penDownTime = event.eventTime
    penErasing = event.getToolType(index) == MotionEvent.TOOL_TYPE_ERASER ||
      event.buttonState and (MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_SECONDARY) != 0
    // An erasing pen goes the usual way: the canvas erases.
    if (!penErasing && startInk(event, index, true)) {
      return
    }
    stream = Stream.PEN
    send(event, index, MotionEvent.ACTION_DOWN)
  }

  private fun inkView(): InkLiveView? = InkLiveView.current?.get()

  /** Hands the touch to the native ink layer when it lands there and should draw. */
  private fun startInk(event: MotionEvent, index: Int, pen: Boolean): Boolean {
    val ink = inkView() ?: return false
    if (!ink.wants(this, event.getX(index), event.getY(index), pen)) {
      return false
    }
    stream = if (pen) Stream.INK_PEN else Stream.INK_FINGER
    penId = event.getPointerId(index)
    ink.begin(this, event, index, pen)
    return true
  }

  /** Android 13+ cancels a pointer it decided was not meant to touch (see [liftAction]). */
  private fun liftInk(ink: InkLiveView, event: MotionEvent, index: Int) {
    if (liftAction(event) == MotionEvent.ACTION_CANCEL) {
      ink.cancelStroke()
    } else {
      ink.end(event, index)
    }
  }

  /**
   * A hovering pen shows its dot from the ink layer, and is kept from the views
   * below, which would redraw the whole canvas for each hover sample.
   */
  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
    val ink = inkView()
    if (ink != null && event.isFromSource(InputDevice.SOURCE_STYLUS) && isPen(event, 0)) {
      when (event.actionMasked) {
        MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE -> {
          if (ink.hoverEnabled() && ink.wants(this, event.x, event.y, true)) {
            ink.hover(this, event.x, event.y)
            return true
          }
          ink.hoverEnd()
        }
        MotionEvent.ACTION_HOVER_EXIT -> {
          val shown = ink.hoverEnabled()
          ink.hoverEnd()
          if (shown) {
            return true
          }
        }
      }
    }
    return super.dispatchGenericMotionEvent(event)
  }

  /** Passes on one pointer alone, as sample [history] (or the current one when -1). */
  private fun send(event: MotionEvent, index: Int, action: Int, history: Int = -1, downTime: Long = penDownTime) {
    val properties = MotionEvent.PointerProperties()
    event.getPointerProperties(index, properties)
    if (isPen(event, index)) {
      // The gesture library reports an eraser tool as an unknown pointer, not a pen.
      properties.toolType = MotionEvent.TOOL_TYPE_STYLUS
    }
    val coords = MotionEvent.PointerCoords()
    if (history >= 0) {
      event.getHistoricalPointerCoords(index, history, coords)
    } else {
      event.getPointerCoords(index, coords)
    }
    if (stream == Stream.PEN && penErasing) {
      coords.pressure = ERASER_PRESSURE
    }
    val time = if (history >= 0) event.getHistoricalEventTime(history) else event.eventTime
    val single = MotionEvent.obtain(
      downTime, time, action, 1, arrayOf(properties), arrayOf(coords),
      event.metaState, event.buttonState, event.xPrecision, event.yPrecision,
      event.deviceId, event.edgeFlags, event.source, event.flags
    )
    super.dispatchTouchEvent(single)
    single.recycle()
  }

  companion object {
    /** Pressure that marks an erasing pen; real pressure is never negative. */
    const val ERASER_PRESSURE = -2f
  }
}
