# Initial App Store release — 21 October 2026

Status: signed 1.0.95 is uploaded, Apple processing is **VALID**, and build 95
is selected in the review draft. **Review is held for a real provider outage**:
OpenAI credits for the production key are exhausted.

## Version and source

Version/build **1.0.95 / 95**, bundle `com.vaultonotemobile`, Apple team
`PC7H2H9BH5`, App Store Connect app **6824942467**. Branch
`release/ios-1.0.95` follows `eb0d422` (the prepared/uploaded 1.0.94).
Build 94 was accepted as VALID but was not submitted. Native checks found issues
worth fixing before the first App Store submission. The original working tree
and its unrelated changes remain untouched.

## Changes after 1.0.94

- Recovery dialog inputs and actions are separate accessibility elements.
  Editor modal backgrounds/cards no longer combine all actions into one
  accessibility label. Shared buttons expose their name, role, disabled and
  loading state.
- Before iOS uploads audio/text/questions to a cloud AI, a native permission
  dialog names Vaulto/OpenAI or the chosen custom API origin and explains that
  readable task input is separate from encrypted sync. Approval is stored per
  origin, can be revoked in Settings, and is never inferred from opening a note.
- Uploads remain blocked while permission is pending, canceled or cannot be
  saved. Concurrent requests share one dialog. Background retries cannot ask
  for new permission or upload without an existing approval.
- Downloaded speech models can handle a declined cloud request. Phone-only and
  other local processing paths do not request cloud permission. A deliberate
  cancellation leaves the note saved and does not open a second error dialog.
- These permission changes apply to iOS; Android keeps its existing flow.

## Verified

- Full `npm test` passes, including 18 voice-workflow cases and 7 cloud consent
  cases. Consent cases verify zero uploads before approval, cancellation,
  concurrent calls, separate custom services, revocation and storage failures.
- Release simulator compilation succeeds with production API configuration and
  correct simulated Keychain entitlements. No production secrets are in Git.
- iPhone: note creation/editing, return to list, force-quit/relaunch, verified
  email-account sign-in. Independent SQLite inspection confirms encrypted
  note title/body fields.
- iPad: signed into the same review account on a second simulator, entered the
  recovery words through the now individually accessible input, unlocked the
  vault, pulled the iPhone note and read its decrypted body. This is an actual
  cross-device recovery test. No iCloud synchronization or physical-device
  performance claim is made.
- iPad uninstall/reinstall of the final 95 simulator app: all 8 server-backed
  notes returned when opening the list; the sample note body was readable and
  remained available after force-quit/relaunch. SQLite independently reports
  8 notes, all synced, none dirty. This case retained the system Keychain key;
  the separate cross-device case above verifies manual recovery without it.
  The first automated attempt stayed in Settings behind a recovery confirmation;
  a corrected navigation check passed in 12.909 seconds.
- Review account server state: `enc_mode=e2ee`, epoch 1, no pending transition.
- Native iOS cloud permission cancellation, revocation in Settings and the next
  request asking again all pass; original text stays intact. The actual cloud
  summary/accept scenario is blocked by the provider outage described below.
- Final signed IPA 1.0.95 / 95 passes code-signature verification and was uploaded
  successfully on 21 October (delivery `34fea49e-f8c6-470b-ad6d-05874aaa56a1`).
- Real app screenshots uploaded for iPhone medium/large and iPad 13-inch.
- Apple build 95 processing: VALID, selected for version 1.0.95. Review draft
  and its single item are READY_FOR_REVIEW; submittedDate is null. Automatic
  release remains AFTER_APPROVAL. Build 94 remains an earlier upload.

## Store and compliance

The [20 October record](app-store-release-2026-10-20.md) contains the initial
setup. Price is free, no iOS purchases, 148 territories excluding EU27, DSA Active
for no planned EU distribution. App Privacy is published, reviewer credentials
are saved privately, and automatic release after approval is selected.

Actual client cryptography uses published AES-GCM, XChaCha20-Poly1305 and
PBKDF2-SHA256 implementations, not proprietary algorithms. France is excluded.
[Apple's export documentation table](https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/)
requires a French declaration for standard non-OS cryptography only when
shipping in France. Apple's API also rejects creating a documentation declaration
for non-proprietary cryptography outside France. Build compliance is therefore
marked documentation-exempt; this does not mean the app lacks encryption.

The iOS permission gate addresses Apple's requirement for explicit permission
before sharing personal data with third-party AI in
[Review Guideline 5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing).
Review credentials and the demonstration account recovery words are stored
outside Git and only in Apple's private review instructions. The dedicated
review account password was rotated after appearing in diagnostic output; old
login is rejected, new login succeeds, prior refresh sessions were revoked and
Apple's private reviewer password was updated and read back successfully.

## Provider outage found before submission

At 06:22 and 06:26 UTC on 21 October, an actual native summary request and an
independent synthetic request to `/ai/improve` both failed. Gateway HTTP 502 was
traced in the running production gateway logs to OpenAI HTTP 429:
`insufficient_quota` / `credit_balance_exhausted`, with the explicit provider
message that no credits remain. This is not the review account's app quota and
not a temperature/model-parameter regression. No secret or private user content
is included in this record. The original note remains intact.

The owner was asked to replenish the API balance. No funds were added, no payment
was made, no production key was replaced and no unrelated service was restarted.
The version must not be submitted with its main cloud path known to be failing.

## Remaining

Native permission checks, cross-device recovery, reinstall restoration, IPA
upload, Apple processing and build selection are complete. After the owner
restores the API balance, repeat the actual native summary/accept/original-switch
case, then submit the existing review draft under the publication authorization
already given. `submittedDate` remains null; the app is not yet in App Store
review or publicly available through this initial iOS release.
