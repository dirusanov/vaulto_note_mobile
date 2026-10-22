package com.vaultonotemobile
import expo.modules.splashscreen.SplashScreenManager

import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    applyOrientationPolicy(resources.configuration)
    super.onCreate(null)
    // "Share -> Vaulto" that cold-started the app.
    ShareIntentStore.capture(applicationContext, intent)
  }

  // Folding, unfolding and window resizes arrive here (smallestScreenSize is in
  // configChanges), so the screen is re-laid out instead of recreated.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applyOrientationPolicy(newConfig)
  }

  override fun onMultiWindowModeChanged(isInMultiWindowMode: Boolean, newConfig: Configuration) {
    super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig)
    applyOrientationPolicy(newConfig)
  }

  // Phones are kept in portrait; tablets and unfolded foldables (600dp+) rotate
  // freely, as Android 16 already does on large screens. The manifest does not
  // lock the orientation: a manifest lock made Android 15 and older start a
  // tablet in a letterboxed phone-shaped frame, whose configuration then also
  // looked like a phone. So the size is read from the display, not the window.
  // Only decided when the app owns the whole display: in split screen or a
  // desktop/ChromeOS window a narrow window must not lock the app to portrait.
  @Suppress("UNUSED_PARAMETER")
  private fun applyOrientationPolicy(config: Configuration) {
    if (isInMultiWindowMode) return
    val orientation = if (displaySmallestWidthDp() >= 600) {
      ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    } else {
      ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }
    if (requestedOrientation != orientation) {
      requestedOrientation = orientation
    }
  }

  private fun displaySmallestWidthDp(): Int {
    val density = resources.displayMetrics.density
    val (width, height) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = windowManager.maximumWindowMetrics.bounds
      bounds.width() to bounds.height()
    } else {
      @Suppress("DEPRECATION")
      val metrics = android.util.DisplayMetrics().also { windowManager.defaultDisplay.getRealMetrics(it) }
      metrics.widthPixels to metrics.heightPixels
    }
    return (minOf(width, height) / density).toInt()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    // "Share -> Vaulto" while the app is already running.
    ShareIntentStore.capture(applicationContext, intent)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
