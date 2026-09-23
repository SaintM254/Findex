# Releasing Findex

The first public version is **1.0** (`versionCode 1`, Android `versionName "1.0"`, tag `v1.0`). The npm package uses the equivalent SemVer `1.0.0`.

## Build and test

The `Findex checks` workflow builds the web assets, runs the browser/unit checks, and builds both Android variants with JDK 21 and SDK 36. Native JVM tests, debug/release lint, and release ZIP alignment must pass. The minified release APK in the workflow artifact is unsigned until the next step; it is not an installable distribution by itself.

The workflow also exports a minimal OpenJDK runtime and Google's `apksigner.jar`. These public tools allow signing outside the build runner when the connected GitHub integration cannot administer Actions secrets. No private keys are sent to Actions.

## Sign privately

Keep the PKCS#12 release keystore, its password, and the signing certificate backup outside Git. Findex's initial signing material is held in the ignored `.release-signing/` directory of the development workspace. **Back it up securely: all future updates to this app must use the same key.** Do not attach it to a public release or include it in an APK.

Using the downloaded signing tools (or a locally installed Android SDK):

```sh
# SIGNING_TOOLS points to the private working copy of the downloaded tools.
# KEYSTORE and PASSWORD_FILE point to files that are never committed or published.
"$SIGNING_TOOLS/findex-signing-runtime/bin/java" -jar "$SIGNING_TOOLS/apksigner.jar" sign \
  --ks "$KEYSTORE" --ks-type PKCS12 --ks-key-alias findex \
  --ks-pass "file:$PASSWORD_FILE" --key-pass "file:$PASSWORD_FILE" \
  --min-sdk-version 26 --out artifacts/Findex-1.0.apk \
  app-release-unsigned.apk

"$SIGNING_TOOLS/findex-signing-runtime/bin/java" -jar "$SIGNING_TOOLS/apksigner.jar" verify \
  --verbose --print-certs artifacts/Findex-1.0.apk
sha256sum artifacts/Findex-1.0.apk > artifacts/Findex-1.0.apk.sha256
```

Publish only the verified APK and checksum using `gh release create` / `gh release upload`. Target the tested commit on the current Arena branch. Do not merge or push another branch as part of a release.

See `RELEASE_CHECKLIST.md` for device-testing and distribution requirements. A passing build is not a claim that every Android/OEM combination has been physically tested.
