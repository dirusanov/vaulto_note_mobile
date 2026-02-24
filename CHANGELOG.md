# Changelog

## [1.0.34] - 2026-02-24

### Added
- **First-Install Demo Notes**: Restored the two starter demo cards on fresh installs with one-time seeding and duplicate protection.

### Changed
- **Custom AI Error UX**: Added a universal provider error in editor flows with an `Open Settings` action button.
- **Agent Mode Gate Copy**: Enforced clear Vaulto-only messaging when trying to enable Agent Mode with Custom AI.

### Fixed
- **Sync Lock Row**: Prevented `Off` status + toggle from appearing alongside `Unlock`; locked state now shows only `Locked` + `Unlock`.
- **Provider-Neutral Errors**: Removed `OpenAI` wording from missing-key errors for Custom AI provider flows.

## [1.0.33] - 2026-02-23

### Fixed
- **Sync Settings UX**: Fixed a bug where a switch was shown instead of the "Unlock" button when the sync vault was locked but sync was disabled.


All notable changes to this project will be documented in this file.

## [1.0.32] - 2026-02-23

### Fixed
- **Checklist Enter Behavior**: Fixed a bug where pressing Enter on checkbox items could create a phantom empty line.
- **Checklist Input Stability**: Removed duplicate-word side effects around Enter handling in checkbox rows.
- **Keyboard UX in Checklist**: Kept the keyboard open when creating the next checkbox item.

## [1.0.30] - 2026-02-21

### Added
- **Premium Delete Confirmation Dialog**: A redesigned, vibrant deletion prompt with smooth animations (`Animated.spring`), larger icons, and a modern top-accent aesthetic.
- **Unified Deletion UI**: Replaced native `Alert.alert` calls for recording deletions with the custom premium dialog for a consistent user experience.

### Changed
- **Toast Position**: Moved the toast notification higher (`bottom: 180`) to ensure it's not obscured by the keyboard or other UI elements.
- **showToast Utility**: Added support for custom durations in the `showToast` helper function.

### Fixed
- **Grammar Check Typo**: Corrected "Prefect! No grammar error founds" to "Perfect! No grammar errors found".
- **Code Integrity**: Resolved several syntax and scope issues in `NoteEditScreen.tsx`.
