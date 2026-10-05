# Local processing, cloud processing, and encrypted sync

This describes the mobile implementation at source version 1.0.89. It is not an independent security audit or a guarantee about every backend deployment. The hosted backend is outside this repository.

## The choices that matter

| Action | Content processing | Network or storage boundary |
| --- | --- | --- |
| On-device transcription | Downloaded Whisper model processes audio on the phone | Model acquisition needs a network connection; transcription itself is local |
| On-device AI | Downloaded Qwen model processes the selected notes on the phone | Model acquisition needs a network connection; inference itself is local |
| Cloud transcription / AI | Selected audio or text is sent for server processing | HTTPS protects transport; the processing service needs readable content |
| Local note storage | Titles, contents, and transcriptions are encrypted before database storage | App-managed encryption; this is not a claim that every filesystem byte or recording cache is encrypted |
| End-to-end encrypted sync | The client encrypts note payloads with its sync key | Ciphertext is uploaded while the account is in E2EE mode; account/sync metadata still exists |
| Guest session / billing / login | Services provision guest quotas, accounts, or purchases | These can contact services even when the chosen inference model is local |

## Inspect the paths

- [LocalWhisperService](../src/services/LocalWhisperService.ts) and [LocalLLMService](../src/services/LocalLLMService.ts): model downloads and local inference.
- [offlineMode](../src/services/offlineMode.ts) and [DeviceCapabilities](../src/services/DeviceCapabilities.ts): model selection and memory checks.
- [TranscriptionService](../src/services/TranscriptionService.ts) and [AIService](../src/services/AIService.ts): local versus cloud routing.
- [DatabaseService](../src/services/DatabaseService.ts) and [encryption](../src/crypto/encryption.ts): encrypted note fields and device/sync encryption modes.
- [e2ee](../src/crypto/e2ee.ts) and [SyncService](../src/services/SyncService.ts): recovery key, payload encryption, and synchronization.
- [keyBackup](../src/services/keyBackup.ts) and [Android key backup module](../android/app/src/main/java/com/vaultonotemobile/KeyBackupModule.kt): platform-assisted recovery.
- [AuthContext](../src/context/AuthContext.tsx) and [SubscriptionContext](../src/context/SubscriptionContext.tsx): guest sessions, authentication, and purchases.

## Important distinctions

New signed-in accounts in recent releases initialize encrypted sync; legacy settings and migration state can differ. Review the effective encryption mode rather than assuming every historical account has identical settings. Protected notes are excluded from plaintext sync paths.

End-to-end encryption protects the synchronized payload in E2EE mode. It does **not** mean that a cloud AI provider can process the text without seeing the text. Choosing on-device inference keeps that computation local; choosing cloud processing sends the input for processing.

Audio recording and transcoding can create temporary files. Recent releases clean abandoned recording caches; that is not a guarantee of forensic erasure. Operating-system access, backups, a compromised device, and lost recovery material remain separate concerns.

Opening the code makes these paths inspectable. Demonstrating that a published binary matches a particular source revision requires additional release provenance or reproducible-build work; that has not been established here.

See the [published privacy policy](https://vaultonote.com/privacy) for service disclosures and [SECURITY.md](../SECURITY.md) for private reporting.
