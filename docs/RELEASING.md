# Releasing Findex

Current identity: **v1.1 signing key** (generated 2026-09-23 after the v1.0 key was unrecoverable). v1.0 required a one-time uninstall; **v1.1 and all later versions share this one identity**, so v1.2 installs over v1.1 normally.

## Automated path

`sign-release` runs only on `arena/01a0caa2-findex` after `workspace`, `android`, and `device` succeed, and only for commits marked `[publish release]` (or the one-time `[bootstrap signing]`, now retired because v1.1 exists). It signs the same unsigned APK that passed lint/alignment, verifies the certificate against `signing/release-policy.json`, and creates a **draft** release. The operator publishes the draft only after pinning the certificate and recovering the backup.

## Where the key lives

1. GitHub repository secrets (preferred, durable):
   - `FINDEX_RELEASE_KEYSTORE_BASE64`
   - `FINDEX_RELEASE_KEYSTORE_PASSWORD`
     Store them with `scripts/setup-release-secrets.sh keystore.p12 password-file` from a trusted machine. The current Arena GitHub integration cannot manage secrets (403), so this owner step is required before v1.2 can be signed in CI.
2. Until the secrets exist, an encrypted copy of the key is retained in the ignored local `.release-signing/` backup created during the v1.1 bootstrap. Recover it with `scripts/recover-release-backup.py <run-id>` if needed. It is never committed, published, or printed.

If neither source is available, release signing fails with instructions. No workflow, script, or human step may generate a replacement identity for an update; `scripts/release-sign.sh` refuses bootstrap once `v1.1` exists.

## Version updates

For v1.2: bump `versionCode`/`versionName` in `android/app/build.gradle`, update `signing/release-policy.json` accordingly, run checks, then push a commit containing `[publish release]`.

See `docs/RELEASE_CHECKLIST.md` for device/distribution gates.
