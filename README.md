# Findex

**A home for everything.** An edge-to-edge Android file manager with a considered glass interface, native background file operations, and an assistant that works with real indexed files—not invented answers.

## Run the interactive preview

```sh
npm ci
npm run dev
```

Open the development server on port **5173**. It binds to `0.0.0.0` and accepts the Arena preview host. There is no separate backend or browser-facing localhost API.

The browser preview is a **sandboxed workspace**, clearly marked in the sidebar and Settings. It includes real, small sample PDFs, photographs, a video, generated audio, text, CSV, and ZIP files. Import your own files with **Add files** or drag and drop. Creation, rename, favorites, nested copy/move, conflict-safe paste, Trash, restore, permanent deletion, and assistant plans all work and persist in IndexedDB. The displayed sample storage totals come from the actual file bytes, not invented device statistics.

**The preview cannot access your phone's entire filesystem.** Android uses a separate, native repository. It never seeds the sample workspace onto your device.

## Android app

### Toolchain

- Node.js 22.12+ and npm
- JDK **21**
- Android Studio with Android SDK **36** and build tools **36.0.0**
- Minimum device: **Android 8 / API 26**, with an up-to-date Android System WebView
- Capacitor 8, Kotlin, Room, WorkManager, Media3, and `PdfRenderer`

```sh
npm ci
npm run android:sync
npm run android:open

# Or build from the terminal:
cd android
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

The debug APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`. With a connected device, install it using `adb install -r` with that path. Keep `android/local.properties`, signing keys, and API keys out of Git.

On first launch, allow **All files access** in Android Settings. Android 8–10 use the legacy storage permission flow. Primary shared storage and available removable volumes are indexed. Private app sandboxes, protected `Android/data` / `Android/obb`, and system partitions are intentionally not exposed; `MANAGE_EXTERNAL_STORAGE` cannot bypass Android's restrictions.

### What is native

| Capability                 | Implementation                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edge-to-edge canvas        | `WindowCompat.setDecorFitsSystemWindows(window, false)`, transparent system bars, display-cutout support, inset events feeding CSS safe areas         |
| Metadata index             | Room with indexed path, parent, type, modification time, and SHA-256 columns; periodic and foreground-triggered WorkManager scans                     |
| Background file operations | WorkManager foreground workers, coroutine I/O, per-item durable checkpoints, cancellation, and progress events                                        |
| Safe copy / move           | Volume-local staging, fsync, SHA-256 verification, no silent replacement; cross-volume moves copy and verify before removing the original             |
| Reversible cleanup         | Volume-local `.findex-trash`, recovery manifests, reviewed candidates, and a separate permanent-deletion confirmation                                 |
| Media                      | Hardware-backed Media3 player for supported audio/video codecs; bounded image decoding, EXIF orientation, pinch/double-tap zoom, and swipe navigation |
| PDF                        | Native `PdfRenderer`, continuous RecyclerView pages, pinch/double-tap zoom, horizontal panning, a page-count pill, and a bounded bitmap cache         |
| Unsupported formats        | Read-only content-URI grants and `ACTION_VIEW`, preserving Android's normal **Just once / Always** resolver                                           |
| Personal API keys          | Non-exportable Android Keystore AES-GCM key; only ciphertext in excluded-from-backup preferences                                                      |

The user interface is **React/TypeScript inside Capacitor**, not Jetpack Compose. Filesystem access and Android viewers are native. In the browser, Web Workers handle search/analysis and PDF.js handles local PDFs.

## The assistant

Open **Findex assistant** in the sidebar or the overview card. On-device structured tools do not require a cloud account or API key:

- **“Find the CV I edited last month”** → name/resume aliases and an explicit calendar-month modification range.
- **“Organize my downloads”** → a reviewable batch plan, grouping direct child files by type.
- **“Analyze my storage”** → indexed byte totals, largest files, verified duplicate groups, and growth compared with a previous scan/baseline.
- **“Clean up safely”** → redundant byte-identical copies, APK/temp/backup files older than 30 days, and empty folders. Favorites are kept by default.
- **“Move yesterday’s screenshots to Screenshots/September”** → date/name/type filtering, a safe relative destination, and a confirmation before moving.

These local tools are a deterministic planner, **not an on-device LLM**. Search uses metadata and available document text; it does not infer image contents or claim to know when a file was last opened. Old installers are candidates based on modification age, not a claim that they are unused.

For flexible language, use **Settings → Intelligence** to choose OpenAI, Anthropic, or Gemini, supply your personal key and model name, and explicitly allow metadata sharing. Switch the assistant's mode to **Connected AI**. Provider calls are direct HTTPS requests; there is no Findex relay server.

### Privacy and action boundaries

- Cloud requests include the query, local timezone, and **up to 500 indexed filenames, IDs, parent IDs, types, sizes, and modification dates**. They do not contain file bytes, document text, or file hashes.
- The UI explicitly discloses this scope. Cloud calls are blocked until consent and a matching provider key are present.
- Cloud responses must pass an allowlisted plan schema. Shell commands, invented source folders, path traversal, and unconstrained moves are rejected.
- Planning never changes files. Every assistant move/organization/cleanup shows the actual candidates and requires confirmation.
- Browser keys live **only in the current tab's memory**. Reloading removes them. Android keys are encrypted with Keystore.
- Ordinary settings and the local metadata index are stored locally. There is no analytics, authentication, or cloud-backup service.

## Controls

- Open files and folders with a click/tap.
- **Long-press** a file or quick-access folder to select it. Desktop checkboxes and Space are also available.
- The inset frosted selection pill appears only while items are selected. Select all, cut, copy, conditional paste, delete, and Trash restore are icon-only and accessibility-labelled.
- `Ctrl/Cmd K`: focus search. `Ctrl/Cmd A`: select visible files. `Ctrl/Cmd X/C/V`: cut/copy/paste. Delete: open removal confirmation. Escape: dismiss/clear.
- Use the sun/moon control or Settings for light, dark, or system appearance.
- “Refresh file index” records a storage baseline. No previous baseline is shown as **First scan**, never fabricated growth.

## Verification

```sh
npm test                 # Unit/integration tests for search, planning, hashing, and real IndexedDB operations
npm run build            # Strict TypeScript check + production bundle
npm run format:check
npm audit

npx playwright install chromium
npm run test:ui          # Desktop + phone interaction tests

# Optional, restricted Linux sandbox runner (bundled Chromium through npm):
npm run test:ui:sandbox
```

The GitHub Actions workflow runs web checks and an independent Android debug build, JVM tests, and Android lint. It does not sign, publish, merge, or deploy a release.

### Current verification boundary

The web build, **50 unit tests**, and **20 desktop/phone browser tests** passed in this sandbox. See [`docs/VERIFICATION.md`](docs/VERIFICATION.md) for the exact checks. **This sandbox has no JDK/Android SDK, and its network blocks Android/Gradle distribution downloads. Consequently, no native APK or physical-device run has been verified here.** The Android code and CI configuration are supplied, but a successful Android build and the device checklist in [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) are required before calling the app production-ready.

Real provider credentials were not used to make paid API calls. Verify the configured model and provider access before release.

## Layout

```text
src/
  components/              Glass workspace, viewers, dialogs, settings, assistant
  lib/
    types.ts               Shared repository and plan contracts
    browser-repository.ts  Real IndexedDB filesystem for the preview
    native-repository.ts   Typed Capacitor bridge
    agent.ts               Deterministic planner and cloud-plan validation
    search.ts              Exact query predicates and calendar ranges
    indexer.worker.ts      Off-main-thread browser metadata search/analysis
android/app/src/main/java/app/findex/files/
  FindexPlugin.kt           Native bridge and permission lifecycle
  storage/                 Path policy, safe storage engine, read-only URI provider
  data/                    Room entities and DAO
  security/                Keystore, preferences, provider client
  workers/                 Indexing and durable file-operation workers
  viewers/                 Native media and continuous PDF viewing
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for safety semantics and known platform limits. Asset provenance is documented in [`public/ASSETS.md`](public/ASSETS.md).
