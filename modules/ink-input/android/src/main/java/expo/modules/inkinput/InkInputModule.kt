package expo.modules.inkinput

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class InkInputModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("InkInput")

    /** True when the device can draw ink natively (InkLiveView): Android 10 and later. */
    Constant("nativeInk") { InkLiveView.supported() }

    /**
     * The strokes the native layer drew that the canvas does not have yet, read
     * at once from the JS thread (the canvas is going away; see InkLiveView).
     */
    Function("takeUnfinishedStrokes") {
      val view = InkLiveView.current?.get() ?: return@Function emptyList<Map<String, Any?>>()
      if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
        return@Function view.unfinishedStrokes()
      }
      val result = java.util.concurrent.atomic.AtomicReference<List<Map<String, Any?>>>(emptyList())
      val done = java.util.concurrent.CountDownLatch(1)
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        try {
          result.set(view.unfinishedStrokes())
        } finally {
          done.countDown()
        }
      }
      done.await(300, java.util.concurrent.TimeUnit.MILLISECONDS)
      result.get()
    }

    View(InkInputView::class) {}

    View(InkLiveView::class) {
      Name("InkLive")
      Events("onInkBegin", "onInkStroke")

      AsyncFunction("setConfig") { view: InkLiveView, config: Map<String, Any?> ->
        view.setConfig(config)
      }
      AsyncFunction("setTransform") { view: InkLiveView, tx: Double, ty: Double, scale: Double ->
        view.setTransform(tx, ty, scale)
      }
      AsyncFunction("release") { view: InkLiveView, ids: List<Int> ->
        view.release(ids)
      }
    }
  }
}
