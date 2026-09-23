# 1.1 performance work

## Root causes addressed

1. `descendants()` called `isDescendant()` once per file, and that function rebuilt the entire ID map each time. Four overview folder totals repeated this quadratic work during parent UI updates.
2. Native `load()` waited for a complete first scan and then serialized every indexed file, including optional text metadata, into the WebView.
3. The scan held the same writer lock as file operations while probing media/PDF content, and app resumes could schedule another scan after 30 seconds.
4. `any { finishedIndexWork.add(id) }` stopped at the first completed job, leaving older completion IDs to trigger more refreshes later.

## Replacement

- `src/lib/file-index.ts`: cached immutable-snapshot lookup/adjacency maps and bottom-up folder totals. Index construction, subtree traversal, and top-level selection no longer rebuild a map per file.
- `FileCatalog.kt`: direct filesystem directory pages, bounded Room queries for global views, compact dashboard projections, and cached directory stat snapshots.
- Local filesystem locators allow browsing/opening unindexed files. Durable operations resolve them to stored UUIDs when queued work executes; Trash undo uses the durable IDs returned by the worker.
- `StorageEngine.scan()`: dedicated background-priority dispatcher, stat-only metadata, small writer sections, no document decoding before file rows appear.
- `EnrichmentWorker`: optional details only while charging and idle. On-demand details are fetched after the details panel opens.
- Android `FileObserver`: invalidates only the directory cache, not the whole application index.

## Regressions and measurements

- A 50,000-record unit test covers folder-byte aggregation, descendants, bulk selection, and repeated cached lookups. In this sandbox the complete test runs in approximately 120–160 ms; the threshold is a deliberately generous 1.8 s to catch accidental quadratic behavior.
- A Playwright test populates 12,000 metadata records, opens/closes the phone navigation four times, and measures click-to-open-state on animation frames. Observed samples were about 16–33 ms locally; both desktop and phone projects passed the 200 ms budget.
- Android instrumentation tests browse an unindexed 222-entry folder containing intentionally invalid PDF/video files, verify paging without decoder work, exercise copy/Trash/restore from filesystem locators, and open navigation with 10,000 existing indexed documents.
- Android testing caught a precision difference between NIO file timestamps and `File.lastModified()` on emulated storage. Metadata now uses the same clock/API as mutation stability checks; the checks are not disabled.

These measurements are test-environment results, not a guarantee for every phone/storage card. Physical-device profiling remains useful, especially for extremely large single directories and slow/removable storage.
