# Architecture and safety model

## One interface, two repositories

`Repository` is the only file-access interface used by the UI. Capacitor platform detection selects Android's `Findex` plugin or the IndexedDB preview repository. Native calls are not silently emulated with sample data if permissions or device APIs fail.

The responsive UI is packaged locally in the APK; it does not load a remote website. Fonts, illustrations, icons, and browser-viewer code are local assets. Vite's development host accepts the Arena proxy domain. API calls use fixed provider HTTPS endpoints, not browser-facing localhost services.

## Index and search

The Android index lives in an app-private Room database using WAL. It retains stable IDs across Findex moves and renames. Indexing is serialized against mutations and uses WorkManager plus coroutine I/O. File modification/size changes invalidate cached hashes and extracted metadata. Read failures do not turn inaccessible directories into deletion instructions.

Index records contain path, extension, category, size, creation/modification times, favorite state, optional duration/dimensions, text snippets, and optional SHA-256. Filesystems without a meaningful birth timestamp fall back to modification time. Plain text/Markdown/CSV/JSON are read with a bounded prefix. PDF text is indexed where the platform exposes extraction; older releases retain PDF page metadata. Binary office documents are categorized but are not semantically summarized. There is no embedding model, OCR, or invented document summary.

In the browser, metadata snapshots go to a dedicated Web Worker for indexed matching and analysis. Search is debounced. File lists render in batches of 80 rather than creating an unbounded DOM. This is incremental rendering, not a benchmark claim of constant-time traversal for arbitrarily large storage.

Native full scans are periodic (at least 15 minutes, subject to Android scheduling), requested on eligible resumes, and available explicitly in Settings. Changes by another application may not be reflected until the next scan. This is not an always-live recursive filesystem observer.

## File mutations

### Android

- `PathPolicy` canonicalizes every boundary and rejects paths outside discovered shared-storage roots, protected app directories, reserved internal folders, and symlink traversal.
- A process-wide coroutine mutex serializes the scanner and writers. Destination operations validate writable directories and reject moving a directory into itself or a descendant.
- Creation and rename fail on collisions. Copy/move use a numbered alternative name. Final moves do not use `REPLACE_EXISTING` for user files.
- Copy streams bounded 1 MB buffers to staging on the destination volume, syncs bytes, verifies SHA-256, and promotes the staged item. A same-volume move uses the filesystem rename; a cross-volume move verifies a copy before removing the source.
- User-initiated batch operations are WorkManager foreground work. The app-private journal stores immutable request IDs, an append-only completed-item log, and a small atomic pending-item record, rather than rewriting a large batch for every file. The native worker can continue while the UI is backgrounded and resume item checkpoints after ordinary process recreation.
- Cancellation is **per-item**, not whole-batch rollback. Already completed items remain completed; incomplete staged copies are removed when the worker can clean up. Power loss can leave abandoned staging files. The next serialized scan removes only UUID staging folders marked as owned by Findex; validating startup recovery and disk-full behavior is a release gate.
- Import from a document provider currently streams on the plugin's I/O coroutine rather than the durable operation worker. It should not be treated as resumable after process death.
- Trash is physical, per-volume, and excluded from normal indexing. A manifest is written before a move for recovery after index/app-data loss. Restore avoids overwriting collisions. Permanent delete is only accepted for items already in Trash.
- External filesystem races cannot be eliminated globally: other apps may change files. The engine checks observed size/time, validates reviewed hashes where available, refuses collisions, and reports errors rather than overwriting.

### Browser

IndexedDB transactions provide atomic copy/move/trash/delete changes within a batch. The browser implementation stores the actual Blob bytes. Web Locks (with a local queue fallback) serialize writes. Duplicate names get deterministic numbered suffixes. Folder copies remap descendants to the newly created parent IDs. Permanent deletion removes both metadata and blobs.

Browser import is committed file-by-file; a quota error can leave earlier imports completed. Hashing imported browser files is limited to 128 MB per file to avoid allocating huge buffers. Larger files are not called duplicates without a verified hash. Native duplicate hashing is streaming and does not have that browser allocation limit.

A browser workspace is not a substitute for a filesystem permission: it cannot silently browse arbitrary OS paths. Clearing site data removes its files. There is no automatic backup. API keys never enter IndexedDB.

## Assistant execution

1. The local planner or selected provider proposes a structured intent.
2. Provider JSON is parsed and checked against a narrow allowlist.
3. Candidate IDs are resolved from the local index; names alone do not authorize an operation.
4. Exact candidate files and destinations are shown. Users can uncheck files.
5. Before execution, the current metadata is compared to the reviewed snapshot.
6. The confirmed plan invokes normal repository operations, with all of their path, collision, progress, and Trash protections.

The provider never receives a shell, direct filesystem capability, or permission to permanently delete. Connected requests are bounded to 500 metadata records, so broad-language results may be limited by that snapshot. Local structured tools operate against the full loaded index.

Duplicates require byte hashes; filename/size matches are candidates for hashing, not proof. A favored copy is preferred as the retained original. APK/temp/backup candidates require age over 30 days. No last-opened telemetry is collected. Growth is a comparison with a real stored baseline, not a projection.

## Native viewers and external apps

Media3 uses the device's codecs and hardware acceleration where available. MKV is a container, not a guarantee that every enclosed video/audio codec is supported. Decode errors offer the native open-with route. Thumbnail requests use sampled, orientation-corrected JPEGs in a 40 MB private cache instead of loading every original into the WebView. Images use sampled decoding to bound memory; very large images are not full-resolution tiled gigapixel viewers.

PDF rendering is single-threaded behind a dedicated dispatcher because `PdfRenderer` allows one open page at a time. RecyclerView binds only nearby pages. The bitmap cache is bounded; page raster dimensions are capped. The UI supports continuous vertical reading and zoom/pan, but does not implement PDF annotation, form editing, or password entry. Protected documents can be opened externally.

The custom content provider is non-exported and exposes read-only access only through per-URI grants. It resolves opaque file IDs through the path policy and supports removable storage. Unsupported types use a plain `ACTION_VIEW`, not a forced chooser that would suppress Android's default-app semantics.

## Release limits

- Android's all-files permission is subject to Google Play's file-manager policy and declaration review.
- Protected private app data and system files are unavailable without privileges this app does not request.
- WorkManager scheduling, foreground-service limits, battery restrictions, volume removal, and codec support vary by Android/OEM.
- The entire loaded metadata snapshot crosses the native bridge. Large-index memory/latency profiling and native query pagination are important before shipping to very large libraries.
- This environment could not build or instrument Android; native compilation, lint, physical-device gestures, and lifecycle behavior are not represented as verified.
- A developer must provide release signing, actual application identity, privacy policy, store declarations, and successful release checks. No secrets or signing credentials are committed.
