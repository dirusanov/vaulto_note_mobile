package expo.modules.inkinput

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class InkInputModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("InkInput")

    View(InkInputView::class) {}
  }
}
