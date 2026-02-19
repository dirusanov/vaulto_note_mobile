# Google Play Release Checklist (1.0.28)

## Versioning

- App version: `1.0.28`
- Android `versionCode`: `28`

## Build (AAB)

```bash
eas build --platform android --profile production
```

Profile `production` in `eas.json` is already configured with:

- `android.buildType = app-bundle`

## Submit to Google Play

```bash
eas submit --platform android --profile production --latest
```

## Release Notes

Use content from `RELEASE_NOTES_1.0.28.md` for the Play Console "What's new" field.

