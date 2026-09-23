#!/usr/bin/env bash
# Only the existing v1.0 signer may sign Findex updates. This script never creates a key.
set -euo pipefail
umask 077
: "${ANDROID_HOME:?Android SDK required}"
: "${ANDROID_KEYSTORE_PATH:?Restore the original Findex 1.0 keystore through a secure channel}"
: "${ANDROID_KEYSTORE_PASSWORD_FILE:?A private password file is required; never paste it into logs or chat}"
input=${1:?Usage: sign-compatible-release.sh unsigned.apk output.apk}
output=${2:?An output path is required}
root=$(cd "$(dirname "$0")/.." && pwd)
expected=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["expectedCertificateSha256"])' "$root/signing/release-policy.json")
public_cert=$(mktemp)
verification=$(mktemp)
trap 'rm -f "$public_cert" "$verification"' EXIT
keytool -exportcert -keystore "$ANDROID_KEYSTORE_PATH" -alias "${ANDROID_KEY_ALIAS:-findex}" \
  -storepass:file "$ANDROID_KEYSTORE_PASSWORD_FILE" -file "$public_cert" >/dev/null
actual=$(openssl x509 -inform DER -in "$public_cert" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':' | tr '[:upper:]' '[:lower:]')
if [[ "$actual" != "$expected" ]]; then
  echo 'Signing blocked: this certificate does not match Findex 1.0.' >&2
  exit 1
fi
mkdir -p "$(dirname "$output")"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" sign --ks "$ANDROID_KEYSTORE_PATH" \
  --ks-key-alias "${ANDROID_KEY_ALIAS:-findex}" --ks-pass "file:$ANDROID_KEYSTORE_PASSWORD_FILE" \
  --v4-signing-enabled false --min-sdk-version 26 --out "$output" "$input"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$output" > "$verification"
signer=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$verification" | tr '[:upper:]' '[:lower:]')
if [[ "$signer" != "$expected" ]]; then rm -f "$output"; echo 'Signed APK certificate validation failed.' >&2; exit 1; fi
"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 4 "$output"
cp "$verification" "${output%.apk}-signature.txt"
(cd "$(dirname "$output")" && sha256sum "$(basename "$output")" > "$(basename "$output").sha256")
echo 'APK signature matches Findex 1.0. The application ID and increasing versionCode permit an in-place update.'
