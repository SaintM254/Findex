# Releasing Findex

The first public version is **1.0** (`versionCode 1`, Android `versionName "1.0"`, tag `v1.0`). The npm package uses the equivalent SemVer `1.0.0`.

## Build and test

The `Findex checks` workflow builds the web assets, runs the browser/unit checks, and builds both Android variants with JDK 21 and SDK 36. Native JVM tests, debug/release lint, and release ZIP alignment must pass. The minified release APK in the build artifact is unsigned until the signing job; do not distribute that unsigned file.

## First-release signing

An explicitly authorized push containing `[publish v1.0]` on the existing Arena branch enables the signing job **only after both verification jobs succeed**. It does not merge any branch.

`scripts/prepare-release.sh` generates the first release's RSA signing identity on the isolated runner, creates an installable signed APK, verifies its signatures/alignment, and opens a **draft** GitHub release. This bootstrap refuses to replace an existing `v1.0` release or signing identity.

The signing key and password are encrypted before backup using **AES-256-GCM with RSA-OAEP key transport** to the public certificate in `signing/backup-recipient.pem`. Only the corresponding private recipient key in the ignored `.release-signing/` workspace directory can recover that backup. The certificate in Git is public, not a private key.

Authenticated ciphertext is transferred through CI check annotations because this sandbox cannot reach GitHub's artifact-download CDN. Neither the original private key nor its password is printed or committed. Only the APK, public signing-certificate report, and checksum are attached to the release.

## Before publishing the draft

1. Recover all encrypted-backup chunks through the check-runs API and verify their SHA-256.
2. Decrypt the CMS envelope using the local private recipient key; extract only `findex-release.p12` and `keystore-password.txt` into `.release-signing/`.
3. Verify the PKCS#12 certificate fingerprint matches the signed APK's public certificate report.
4. Back up this private directory securely. It is excluded from Git and must never become a public release asset.
5. Publish the draft with `gh release edit v1.0 --draft=false`.

## Future updates

**Reuse `findex-release.p12`. Generating a different key will prevent existing installations from accepting an update.** The first-release bootstrap is deliberately not a reusable key-rotation mechanism.

Before another release, the repository owner should configure the existing keystore and password as protected GitHub Actions secrets through GitHub Settings (the current integration cannot administer secrets), or sign locally with Android's `apksigner`. Never paste these credentials into chat or commit them. Increase `versionCode` and set the intended public `versionName` for every update.

See `RELEASE_CHECKLIST.md` for device-testing and distribution requirements. A passing build is not a claim of physical-device/OEM certification.
