#!/usr/bin/env bash
# Run only in an explicitly authorized release job after all verification jobs pass.
# Private keys/passwords never enter Git, logs, or public release assets.
set -euo pipefail
umask 077
: "${RUNNER_TEMP:?}"
: "${ANDROID_HOME:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_SHA:?}"
: "${GH_TOKEN:?}"

if gh release view v1.0 --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  echo '::error::v1.0 already exists. Refusing to generate a replacement signing identity or overwrite this release.'
  exit 1
fi

private_dir="$RUNNER_TEMP/findex-release-private"
mkdir -p "$private_dir" release-assets
trap 'rm -rf "$private_dir"' EXIT
echo 'Preparing the private release signing identity.'
openssl rand -hex 32 > "$private_dir/keystore-password.txt"
keytool -genkeypair -noprompt -storetype PKCS12 \
  -keystore "$private_dir/findex-release.p12" -alias findex \
  -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity 10000 \
  -dname 'CN=Findex Release, O=Findex' \
  -storepass:file "$private_dir/keystore-password.txt" \
  -keypass:file "$private_dir/keystore-password.txt"

echo 'Inspecting the verified APK artifact.'
find downloaded-apks -maxdepth 4 -type f -name '*.apk'
unsigned_apk='downloaded-apks/release/app-release-unsigned.apk'
test -s "$unsigned_apk"
"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 4 "$unsigned_apk"
# PKCS#12 uses the store password for its key. Do not read the same password
# file twice: apksigner intentionally consumes a new line for each password.
echo 'Signing the release APK.'
"$ANDROID_HOME/build-tools/36.0.0/apksigner" sign \
  --ks "$private_dir/findex-release.p12" --ks-type PKCS12 --ks-key-alias findex \
  --ks-pass "file:$private_dir/keystore-password.txt" \
  --v4-signing-enabled false --min-sdk-version 26 \
  --out release-assets/Findex-1.0.apk "$unsigned_apk"
echo 'Verifying the signed APK.'
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs \
  release-assets/Findex-1.0.apk | tee release-assets/Findex-1.0-signature.txt
"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging release-assets/Findex-1.0.apk > release-assets/apk-badging.txt
head -1 release-assets/apk-badging.txt
python3 - release-assets/Findex-1.0-signature.txt <<'PYTHON'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text()
match = re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)", text)
if not match:
    raise SystemExit("Signing certificate fingerprint missing")
print(f"::notice title=Findex signing certificate SHA256::{match.group(1).lower()}")
PYTHON
(cd release-assets && sha256sum Findex-1.0.apk > Findex-1.0.apk.sha256)

# Envelope encryption: RSA-OAEP wraps an AES-256-GCM key. Only the workspace's
# private recipient key can recover this backup. The public certificate is not a secret.
tar -czf "$private_dir/backup.tar.gz" -C "$private_dir" findex-release.p12 keystore-password.txt
openssl cms -encrypt -binary -aes-256-gcm -outform DER \
  -in "$private_dir/backup.tar.gz" -out "$private_dir/signing-backup.enc" \
  -recip signing/backup-recipient.pem -keyopt rsa_padding_mode:oaep

# Transfer only authenticated ciphertext through check annotations. This works
# even when the development sandbox cannot reach GitHub's artifact CDN. Neither
# the original key nor its password is written to any annotation or public asset.
python3 - "$private_dir/signing-backup.enc" <<'PYTHON'
import base64, hashlib, pathlib, sys
payload = pathlib.Path(sys.argv[1]).read_bytes()
encoded = base64.b64encode(payload).decode('ascii')
chunks = [encoded[offset:offset + 2800] for offset in range(0, len(encoded), 2800)]
print(f'::notice title=Findex encrypted backup SHA256::{hashlib.sha256(payload).hexdigest()}')
for index, chunk in enumerate(chunks, 1):
    print(f'::notice title=Findex encrypted backup {index}/{len(chunks)}::{chunk}')
PYTHON

gh release create v1.0 \
  --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" --draft \
  --title 'Findex 1.0' --notes-file docs/releases/v1.0.md \
  release-assets/Findex-1.0.apk \
  release-assets/Findex-1.0.apk.sha256 \
  release-assets/Findex-1.0-signature.txt
# A human/agent publishes the draft only after the encrypted signing backup has
# been recovered and verified in the private workspace.
