# Release gate — not a claim of completed certification

## Required automated checks

- [ ] Successful `npm ci`, strict TypeScript/Vite build, unit tests, formatting, and dependency audit.
- [ ] Desktop and phone Playwright suites passing from a clean workspace.
- [ ] Successful Android `assembleDebug`, `testDebugUnitTest`, and `lintDebug` on JDK 21 / SDK 36.
- [ ] Successful minified release build with privately managed signing.
- [ ] Review generated Room schema into source control once the first native build is available.

## Physical-device matrix

Test Android 8/10 legacy permission behavior and Android 11, 13, 15, and 16 all-files behavior. Include a small phone, a cutout device, a tablet/foldable, gesture navigation, three-button navigation, and light/dark/system themes.

- [ ] First-run grant, deny, permanently deny, revoke, and grant again; correct empty/permission states.
- [ ] System bars and display cutouts remain transparent/edge-to-edge; controls respect safe areas in portrait and landscape.
- [ ] Keyboard/IME appearance, modal focus, large system font, TalkBack, hardware Back, and touch target sizing.
- [ ] Long press, scroll cancellation, multi-select, all five selection actions, conditional paste, and clipboard persistence while navigating.
- [ ] SD-card insertion, removal, read-only media, cross-volume moves, FAT filename constraints, and URI grants to external apps.
- [ ] No silent overwrite on collisions or externally introduced destination files.
- [ ] Large files, >4 GB media, deeply nested folders, 100,000-item indexes, low disk space, and unreadable directories.
- [ ] Cancelling a batch after completed items; consistency of filesystem, Room, progress, and clipboard.
- [ ] Process kill / force-stop / reboot at each stage of copy, move, Trash, restore, and import. Validate pending journals and abandoned staging cleanup; confirm no original loss.
- [ ] Duplicate proof invalidates on content changes; favorites remain unchecked by default; empty-folder checks do not mistake unreadable folders for empty.
- [ ] APK/temp age thresholds; cleanup review; undo; restore name collision; separate permanent-delete confirmation.
- [ ] Media3 MP4/MKV codec matrix, malformed files, audio focus, rotate/background/resume, decoder errors, and external fallback.
- [ ] Large images, EXIF orientations, pinch/double-tap, swipe, and memory pressure.
- [ ] PDF continuous scroll, first/last page counts, very large page sizes, large page counts, pinch/pan, rotation restore, corrupted/password-protected files, and renderer cleanup.
- [ ] At least one real opt-in request to each provider using an authorized model; invalid key, no network, timeout, rate limits, and malformed/injected model responses.
- [ ] Provider keys remain encrypted and excluded from backup; no file content or secret appears in logs or request metadata.
- [ ] Inspect WorkManager/foreground notifications with notification permission denied and granted, battery restrictions, and Android 15/16 execution limits.

## Distribution

- [ ] App ID/name/icon and version are final.
- [ ] All-files-access declaration and foreground-service declaration are completed honestly for the chosen distribution channel.
- [ ] Privacy policy accurately covers opt-in third-party metadata sharing, provider retention, local index/snippets, and Trash behavior.
- [ ] Signing keystore is outside Git and CI plaintext; publishing is a separate explicitly authorized action.
- [ ] Sample content is either excluded from the release asset bundle or clearly retained solely for browser development.
- [ ] Accessibility and performance measurements, release notes, and recovery guidance are reviewed.
