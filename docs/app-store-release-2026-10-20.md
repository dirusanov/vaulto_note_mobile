# Initial App Store release — 20 October 2026

Status: App Store Connect version is **Prepare for Submission**. Native QA is in progress;
signed archive built successfully; nothing has been submitted for Apple review.

## Source and release scope

Branch `release/ios-1.0.94`, based on `af2adf5`, in the isolated worktree
`/private/tmp/vaulto-ios-release-1.0.94`. The original mobile workspace and its
unrelated trial/paywall edits are preserved. Prior follow-up routing/privacy/UI
fixes are included. Version/build: **1.0.94 / 94**.

The first iOS release is free and offers email sign-in and guest note-taking.
Unconfigured Google sign-in and store billing are excluded from native iOS
linking; platform-specific adapters avoid importing those SDKs. The paywall,
upgrade actions, restore and offerings calls are disabled on iOS. Existing
backend account access and cloud limits remain in force. Android keeps its
Google sign-in and purchases.

Expo SDK 57 patches are aligned, including the scene lifecycle required by the
installed iOS SDK. The six custom native module sources live in `native/ios`;
`plugins/ios-native-modules.js` registers them and the React bridging header
when regenerating the native project. This preserves KeyBackup,
AudioTranscode and DeviceCapabilities across prebuild.

## Store configuration verified

- Apple team `PC7H2H9BH5`; bundle identifier `com.vaultonotemobile`.
- App Store Connect app **6824942467**, name **Vaulto: Private AI Voice Notes**,
  locale en-US, version 1.0.94; Productivity / Utilities, age override 13+ on
  current OS versions (legacy ratings may differ).
- Free Apps Agreement active; paid agreement, bank and tax setup deferred.
- Price $0.00; 148 territories selected, excluding the 27 EU countries.
  Future territories are not enabled automatically. DSA compliance is Active;
  the selected Apple option includes **no planned distribution in the EU**.
  This records the initial availability choice, not a conclusion about the
  owner's general trader status.
- iPhone and iPad release; automatic Mac and Vision Pro distribution disabled.
- App Privacy responses published: email address, audio, other user content,
  user ID, device ID, product interaction. App functionality only, linked to
  identity, no tracking. Privacy/support URLs saved and independently read back.
- Listing, support/marketing URLs, copyright, licensed-content declaration,
  reviewer contact, reviewer instructions and dedicated account saved through
  Apple's authenticated API and verified independently of browser form state.
- Dedicated review email confirmed by the owner; backend sign-in and verified
  profile checked. Credentials are outside the repository and in Apple's
  private review form. They must not appear in reports or screenshots.
- Automatic release after Apple approval is selected.
- Distribution certificate and active provisioning profile configured in EAS.
  API signing key is stored outside the repository. Required Apple WWDR G3
  intermediate installed from Apple's official certificate authority site.

## Validation and issues found

- Full `npm test` passes after dependency alignment: typecheck and project test
  suites, including 17 voice-workflow cases.
- Expo Doctor: 20/21 checks pass. The remaining warning concerns keeping native
  projects alongside app.json. This project intentionally commits the native
  projects; changes were applied to iOS and must be regenerated explicitly.
- Release simulator build compiled with Xcode 27.1, arm64, production API
  configuration. Initial no-scene launch failed; SDK 57 scene support fixes it.
- Native XCTest launch/settings/editor/email-screen smoke checks passed on
  iPhone 18 Pro / iOS 27.0. Hidden Google sign-in was checked.
- Initial unsigned simulator run could not save notes because SecureStore
  reported missing Keychain entitlement. This is a test signing problem;
  corrected Xcode simulator signing restores Keychain access. Native tests pass
  for writing a note, returning to the list, force-quit/relaunch, and verified
  email-account sign-in. SQLite independently confirms encrypted title/body.
- First local signed-build attempt failed validating the certificate import;
  the missing WWDR G3 intermediate was installed. The next signed build passed;
  IPA version 1.0.94 / 94, bundle ID and cryptographic signature were checked.

## Remaining before review

1. Native iPhone persistence/account and iPad create/edit/layout checks pass.
2. Capture and upload real app screenshots for supported required display sizes.
3. Build and inspect the signed 1.0.94 IPA, upload, and verify Apple processing.
4. Complete export questions for actual standard client-side AES-GCM and
   XChaCha20-Poly1305 cryptography. No false “only OS encryption” or blanket
   no-encryption declaration has been made. France is excluded with the EU.
5. Select the build, resolve Apple's validation messages and submit for review.

Apple review and public availability are separate states. Uploading an IPA alone
is not publication and does not submit the App Store version for review.
