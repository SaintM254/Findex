# Verification record

Development sandbox checks performed on 2026-09-22. These are concrete local results, not a release certification.

| Check                                          | Result                                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript + Vite production build      | Passed                                                                                                                                                                                                        |
| Capacitor Android asset/config synchronization | Passed — synchronization is **not** an Android compilation                                                                                                                                                    |
| Vitest                                         | 50 tests passed: IndexedDB CRUD, actual Blob preservation, cancellation rollback, Trash/restore, naming/path validation, SHA-256, calendar queries, plan allowlisting, consent, and key isolation             |
| Browser interactions                           | **20 tests passed** across desktop (1440 px) and phone (390 px), covering for real file operations, import/persistence, PDFs, image zoom, media playback, reviewed assistant actions, settings, and selection |
| Automated accessibility                        | Axe WCAG A/AA checks on overview, dark mode, and assistant; additional manual runs on Settings and Intelligence. These do not replace TalkBack/device testing.                                                |
| Dependency audit                               | No reported npm vulnerabilities at the time of testing                                                                                                                                                        |
| Native syntax parser                           | No Kotlin syntax errors found by the available tree-sitter parser; this is **not** a Kotlin type check or Android build                                                                                       |
| Native Gradle build                            | Blocked: `JAVA_HOME` unset and no Java executable/Android SDK. External toolchain downloads fail from this sandbox.                                                                                           |
| GitHub CI                                      | Not run. The connection returned `HTTP 401: Bad credentials`; reconnect GitHub in Arena to authorize a future CI run. No credentials were requested or stored in chat.                                        |
| Paid provider API calls                        | Not made; mocked response validation and consent/key boundaries tested locally                                                                                                                                |

## Browser cases

Each runs against both desktop and phone viewports:

1. Responsive canvas, hidden selection pill, grid/list navigation.
2. Folder creation, real copy, collision-safe paste, removal confirmation, Trash, and restore.
3. File import, indexed search, actual document preview, and persistence after reload.
4. Continuous PDF pages/page count, PDF zoom, and image zoom.
5. Calendar-aware CV search and confirmed real Downloads organization.
6. Byte-verified cleanup, recoverable Trash, and persistent dark mode.
7. Personal-key disclosure and proof that a browser key is gone after reload.
8. Long-press selection, icon-only actions, and viewport fit.
9. Real MP4 and WAV metadata, decode, and advancing playback time.
10. Automated WCAG contrast/structure checks across light/dark/assistant states.

No branch was switched or merged, and no commit or push was made. Build outputs, dependencies, temporary screenshots, traces, credentials, and private signing material are excluded from Git.
