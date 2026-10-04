# Android Release

The usual route (no passwords, EAS supplies the upload key) is in `AGENTS.md` → "Releasing to Google Play". The steps below are the manual-keystore alternative.

1. Copy `android/keystore.properties.example` to `android/keystore.properties`.
2. Put your upload keystore at the path from `storeFile` relative to `android/`.
3. Fill `storePassword`, `keyAlias`, and `keyPassword`.
4. Build the Play bundle:

```bash
cd android
./gradlew bundleRelease
```

The bundle will be created at `android/app/build/outputs/bundle/release/app-release.aab`.

Instead of `android/keystore.properties`, you can use these env vars:

```bash
ANDROID_KEYSTORE_FILE
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```
