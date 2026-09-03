package com.vaultonotemobile

import android.app.ActivityManager
import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Reports the physical limits that decide which on-device models may be offered.
 * A model larger than the device can hold does not degrade - the OS kills the app -
 * so this has to be known before a multi-gigabyte download starts.
 */
class DeviceCapabilitiesModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "DeviceCapabilities"

    @ReactMethod
    fun getCapabilities(promise: Promise) {
        try {
            val activityManager =
                reactContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            val memoryInfo = ActivityManager.MemoryInfo()
            activityManager?.getMemoryInfo(memoryInfo)

            val result = Arguments.createMap().apply {
                // Zero means "unknown" on the JS side, which never blocks a download.
                putDouble("totalMemoryBytes", memoryInfo.totalMem.toDouble())
                putInt("cpuCount", Runtime.getRuntime().availableProcessors())
                putBoolean("isLowRamDevice", activityManager?.isLowRamDevice ?: false)
            }
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject("DEVICE_CAPABILITIES_FAILED", error)
        }
    }
}
