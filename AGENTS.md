# Vaulto Note mobile — notes for agents

## Releasing to Google Play

The app is built locally; nobody types signing passwords.

1. **Version.** Bump to the next `1.0.N` / build `N` in all of:
   `android/app/build.gradle` (`versionCode`, `versionName`), `app.json` (`version`,
   `ios.buildNumber`, `android.versionCode`), `package.json`, `ios/VaultoNote/Info.plist`,
   `ios/VaultoNote.xcodeproj/project.pbxproj` (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`).
   Add a `CHANGELOG.md` entry. Commit as `chore: release 1.0.N`.
2. **Backend first.** If the release depends on gateway changes, deploy them before the
   app ships (old app versions must keep working with the new server).
3. **Checks.** `npm test` (typecheck + unit tests) must pass.
4. **Build the signed bundle** (EAS supplies the upload key from its servers; the build
   itself runs on this machine):

   ```bash
   export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
   export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
   export PATH=$JAVA_HOME/bin:$PATH
   npx eas-cli build -p android --profile production --local --non-interactive \
     --output build-1.0.N.aab
   ```

   Takes ~4–5 min on this Mac (measured 4m17s end to end; Gradle itself ~3.5 min — the
   "TOTAL ~850–1000s" in its profile table is summed parallel task time, not wall time).
   The `production` profile in `eas.json` sets the prod API URLs.
   `build-*.aab` is gitignored.
5. **Verify the bundle.**
   - Signature: `keytool -printcert -jarfile build-1.0.N.aab` must show upload key
     SHA-256 `BF:6B:4E:CB:B0:51:DA:CA:97:06:00:7F:C5:25:FE:3D:F4:69:95:F1:BF:51:15:EE:B7:23:A1:7E:4E:AC:32:00`
     (Play Console → App integrity). Another key means Play rejects the upload.
   - Smoke test the release build on an emulator: `bundletool build-apks --bundle=… --connected-device
     --ks=android/app/debug.keystore --ks-key-alias=androiddebugkey --ks-pass=pass:android
     --key-pass=pass:android`, then `bundletool install-apks`. Launch, open Settings, check the version.
     (Billing errors in logs are expected on emulators without Play.)
6. **Upload.** Play Console → Vaulto: Private AI Voice Notes → Production → Create release.
   The AAB (~130 MB) is too large for the browser automation upload (10 MB limit): the user
   drags `build-1.0.N.aab` into the draft. Fill "What's new" for `en-US` and `ru-RU`.
7. **Publish.** Review → "Ready to release" with no errors and no lost devices → Save →
   Publishing overview → "Send changes for review". Managed publishing is off, so the
   version goes live automatically once Google approves. Always get the user's explicit
   go-ahead (track and rollout %) before sending for review.

Alternative: plain `./gradlew bundleRelease` works only with `android/keystore.properties`
or `credentials.json` (both gitignored, not present by default). `credentials.json` can be
restored with `npx eas-cli credentials -p android` → production → Download (interactive
terminal only).

## Testing notes

- Debug builds: `./gradlew assembleDebug` (same JAVA_HOME/ANDROID_HOME) + `npx expo start`;
  the dev client needs `adb reverse tcp:8081 tcp:8081`.
- Two-device sync: AVDs `vaulto_test` (emulator-5554) and `vaulto_test2` (emulator-5556).
- In debug builds, `adb shell input text` into an unfocused field triggers Metro hotkeys
  ("r r" reloads). To enter a recovery key, push a JPEG QR to `/sdcard/Pictures` and use
  "Import from Image".
- The emulator microphone records silence on this Mac; voice tests need a temporary
  fake-mic hook (never ship it).
