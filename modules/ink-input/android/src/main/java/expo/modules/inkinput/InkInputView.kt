package expo.modules.inkinput

import android.content.Context
import android.view.MotionEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Wraps the drawing canvas. Android batches touch samples and hands them to
 * the app once per frame; the gesture library then only sees the newest one,
 * so a fast pen stroke lost most of its points and drew as a polygon. Asking
 * for unbuffered dispatch on touch-down delivers every sample as it arrives
 * (what Android's low-latency ink APIs do), until the finger or pen lifts.
 */
class InkInputView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      requestUnbufferedDispatch(event)
    }
    return super.dispatchTouchEvent(event)
  }
}
