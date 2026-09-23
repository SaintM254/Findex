# Findex 1.1 verification — 2026-09-23

## Verified locally

- Strict TypeScript/Vite production build and Capacitor asset synchronization pass.
- **55 unit/integration tests** pass, including 50,000-record indexing/selection and v1.0 signing-policy guards.
- Dependency audit reports no vulnerabilities.
- **26 desktop/phone tests** pass locally, including explicit checks that the circled controls are absent from the header/main canvas and that navigation file tools preserve the current folder. Interaction coverage includes real file operations, PDFs, image/audio/video previews, assistant review, settings, theme/accessibility, and large-index navigation. The updated blue contrast and 12,000-record navigation tests pass.
- The 12,000-record navigation benchmark measured approximately **16–33 ms** to the open navigation state in the test browser. This is an environment-specific measurement, not a universal hardware promise.

## Android / hosted CI

- Runs `35823498626` and `35824106160` passed Android debug/release builds, JVM unit tests, debug/release lint, ZIP alignment, and the web/browser checks for their respective commits.
- The first Android 35 emulator run passed unindexed-folder browsing and the large-index/navigation checks. It found a timestamp-precision mismatch during copy/Trash/restore.
- The timestamp fix was pushed in commit `8674ceb`; another emulator run was started in `35824106160`.
- After the GitHub connection was restored, run `35824106160` was confirmed **successful**, including all three Android 35 instrumentation cases (unindexed-folder paging, large-index navigation, and copy/Trash/restore). This result applies to that run’s commit; screenshot cleanup has its own updated local browser checks and follow-up CI run.

## Release gates still open

1. Recover the original v1.0 private signing key through a secure channel. It is not in the restored workspace. No replacement key or differently signed update is created.
2. Test the responsive file browser on the affected physical device. Emulator and browser results are not a guarantee for every OEM/storage card.

The annotated screenshot was received and its circled controls have been removed from the main screen. This UI gate is complete.

The source remains on `arena/01a0caa2-findex`; no branch was merged. `v1.0` was not overwritten, and `v1.1` was not published as a compatible signed update.
