# Building the mobile client

## Requirements

- Node.js and npm compatible with the checked-in Expo/React Native dependencies. Use `npm ci` and `package-lock.json`; there is not yet a tested Node version pin.
- JDK 17, Android SDK, a configured emulator or a physical Android device.
- For iOS: macOS, Xcode, and the native dependency setup required by the checked-in iOS project. The iOS build path was not verified while preparing this documentation.

This app uses `whisper.rn`, `llama.rn`, and custom native modules. **Expo Go cannot run it.** Start from the checked-in native projects and use a development build.

## Configuration

Copy `.env.example` to `.env`. The sample uses Android emulator loopback `10.0.2.2`. On a physical device, use reachable development endpoints, typically your computer's LAN IP. For an iOS simulator, use reachable local endpoints such as `localhost`.

Gateway and authentication services are separate from this repository. Local model processing is implemented in the client; guest trial provisioning, cloud AI, account flows, billing, and hosted sync require compatible backend services. The app attempts to create a guest session on startup; an offline inference path is not a promise of zero network requests when online.

Configure Google sign-in and RevenueCat with your own projects when testing those integrations. The checked-in `google-services.json`, package IDs, EAS ownership and production settings belong to the official app. They are not credentials granting ownership of those projects, and a fork needs its own configuration for distribution.

Every `EXPO_PUBLIC_*` variable is readable in the built app. Only public client configuration belongs in those values. Never embed server secrets or signing passwords.

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
