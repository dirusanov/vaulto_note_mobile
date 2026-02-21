# Changelog

All notable changes to this project will be documented in this file.

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
