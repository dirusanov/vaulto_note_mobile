@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

package com.vaultonotemobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AudioTranscodePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(
            AudioTranscodeModule(reactContext),
            DeviceCapabilitiesModule(reactContext),
            ShareIntentModule(reactContext),
        )
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
