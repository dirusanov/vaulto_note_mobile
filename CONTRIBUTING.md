# Contributing to Vaulto Note

Start with an issue describing the bug, intended behavior, or user task. For a larger change, discuss scope before investing in implementation. Contributions to the mobile client are under [GPL-3.0-only](LICENSE). Do not submit third-party code without clear reuse rights; preserve upstream notices.

## Useful bug reports

Include app version, Android/iOS version, device and RAM when relevant, local/cloud mode, selected models, reproduction steps, and expected versus observed behavior. Use a small fictional note or recording. Remove account identifiers, access tokens, recovery keys, and personal content from logs and screenshots.

Security vulnerabilities should be reported privately via [SECURITY.md](SECURITY.md).

## Development

Follow [the development guide](docs/DEVELOPMENT.md). Native modules require a development build; Expo Go is not sufficient. Run `npm test` for code changes and describe which device flows were checked. Documentation-only changes do not need an Android release build.

Keep changes focused. Preserve encryption compatibility, recoverable user recordings, and existing AI-edit versions. New network behavior needs a clear explanation in the privacy documentation. Tests should cover behavior or regressions rather than duplicate implementation.

For pull requests, explain the concrete problem, resulting behavior, and validation. Include screenshots for UI changes, using fictional data. Do not commit `.env`, upload keystores, signing passwords, service-account files, or real notes. The standard Android debug keystore is for development only.

## Releases

The maintainer handles store releases. Release signing and publishing are separate from normal contribution; see [RELEASE.md](RELEASE.md) and project release instructions in [AGENTS.md](AGENTS.md).
