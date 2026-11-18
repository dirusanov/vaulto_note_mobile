# Building the mobile client

## Requirements

- Node.js and npm compatible with the checked-in Expo/React Native dependencies. Use `npm ci` and `package-lock.json`; there is not yet a tested Node version pin.
- JDK 17, Android SDK, a configured emulator or a physical Android device.
- For iOS: macOS, Xcode, CocoaPods, and iOS 16.4 or later.

This app uses `whisper.rn`, `llama.rn`, and custom native modules. **Expo Go cannot run it.** Start from the checked-in native projects and use a development build.

## Configuration

Copy `.env.example` to `.env`. The sample uses Android emulator loopback `10.0.2.2`. On a physical device, use reachable development endpoints, typically your computer's LAN IP. For an iOS simulator, use reachable local endpoints such as `localhost`.

Gateway and authentication services are separate from this repository. Local model processing is implemented in the client; guest trial provisioning, cloud AI, account flows, billing, and hosted sync require compatible backend services. The app attempts to create a guest session on startup; an offline inference path is not a promise of zero network requests when online.

Configure Google sign-in and RevenueCat with your own projects when testing those integrations. The checked-in `google-services.json`, package IDs, EAS ownership and production settings belong to the official app. They are not credentials granting ownership of those projects, and a fork needs its own configuration for distribution.

Every `EXPO_PUBLIC_*` variable is readable in the built app. Only public client configuration belongs in those values. Never embed server secrets or signing passwords.

## iOS subscriptions

The official App Store app and its RevenueCat app both use `com.vaultonotemobile`.
Use the App Store public SDK key in `EXPO_PUBLIC_REVENUECAT_APPLE_KEY`.
The EAS post-install hook rejects missing or placeholder iOS keys. iOS debug builds
also use the App Store key, so test purchases use Apple's sandbox. The optional
RevenueCat Test Store key applies only to Android development builds.

The default RevenueCat offering must include an App Store product for each package:

| Package | App Store product | Backend plan product |
| --- | --- | --- |
| `$rc_monthly` | `vaulto_premium.monthly` | `vaulto_premium:monthly` |
| `$rc_annual` | `vaulto_premium.yearly_plan` | `vaulto_premium:yearly-plan` |

Both products unlock the same Pro entitlement and belong to the same subscription
group and service level in App Store Connect. Backend product matching normalizes
punctuation, so these Apple IDs map to the existing plans without changing Android IDs.
Prices displayed to the user come from StoreKit through RevenueCat.

Configure the In-App Purchase key in RevenueCat and both App Store Server Notification
URLs in App Store Connect. Keep private `.p8` files outside this repository. The
RevenueCat webhook must include the iOS app and the test environment when testing.
Apple also requires the account holder's paid-app agreements, tax, and banking setup.
See [RevenueCat's Apple key setup](https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/in-app-purchase-key-configuration)
and [Apple's sandbox testing guide](https://developer.apple.com/help/app-store-connect/test-in-app-purchases/overview-of-testing-in-sandbox/).

The native single-window SceneDelegate and scene manifest are required when linking
with the iOS 27 SDK. Preserve forwarding of links and Expo lifecycle callbacks when
changing the app delegate.

Install native dependencies with `pod install --project-directory=ios`, then use
`npm run ios` with a development environment or the production EAS profile for
distribution. Before submission, test an expired free trial, both subscription
periods, a cancelled purchase, restoring purchases, and backend Pro activation in
sandbox/TestFlight. Unit tests and a successful native build do not verify billing.

## Android development build

```bash
npm ci
cp .env.example .env
# Edit .env for the services and integrations you want to test.
npm run android
```

For a previously installed development client:

```bash
npx expo start --dev-client
```

USB devices may need `adb reverse tcp:8081 tcp:8081` to reach Metro. When changing native dependencies or custom native modules, rebuild the development client.

Offline models are downloaded separately at runtime. Use fictional audio/notes when testing. Test model selection and memory behavior on real devices; emulator microphones can produce silence.

## Checks

`npm test` runs TypeScript checking and the existing behavioral tests for encryption state, Markdown formatting, E2EE, utilities, versions, search, tasks, tags, and note transfer. It does not establish correct microphone behavior, performance, Play Billing, or store-release compatibility on a physical device.

## Release builds

The release Gradle configuration requires signing credentials. Create your own signing key and follow [RELEASE.md](../RELEASE.md). The official upload key and signing passwords are excluded from version control. The checked-in `android/app/debug.keystore` is the standard development key and must not be used to publish an official release.

Do not run Expo prebuild as a routine reset: review its changes against the custom Android/iOS code and plugins. Store release metadata is documented in [AGENTS.md](../AGENTS.md).
