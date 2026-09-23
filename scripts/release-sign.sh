#!/usr/bin/env bash
# Signs the verified unsigned APK for an authorized release.
#
# Key sources, in order:
#   1. Repository secrets FINDEX_RELEASE_KEYSTORE_BASE64 / FINDEX_RELEASE_KEYSTORE_PASSWORD.
#      This is the only accepted source once the v1.1 identity exists.
#   2. One-time bootstrap generation, allowed only while no v1.1 release exists
#      and only for a commit explicitly marked [bootstrap signing]. The private
#      material never touches Git, logs, or public release assets; it is
#      transferred as AES-256-GCM + RSA-OAEP ciphertext to the workspace's
#      ignored .release-signing backup recipient.
set -euo pipefail
umask 077
: "${ANDROID_HOME:?Android SDK required}"
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_SHA:?}"
: "${GH_TOKEN:?}"
input=${1:?Usage: release-sign.sh unsigned.apk}
output=${2:?An output path is required}
root=$(cd "$(dirname "$0")/.." && pwd)
private="$root/.release-signing"
policy_file="$root/signing/release-policy.json"
expected=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["expectedCertificateSha256"])' "$policy_file")
version_name=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["versionName"])' "$policy_file")
tag="v$version_name"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
keystore="$work/release.p12"
password_file="$work/password.txt"
public_cert="$work/cert.der"
verification="$work/verify.txt"
badging="$work/badging.txt"

source_kind=""
if [[ -n "${FINDEX_RELEASE_KEYSTORE_BASE64:-}" && -n "${FINDEX_RELEASE_KEYSTORE_PASSWORD:-}" ]]; then
  source_kind="repository-secret"
  printf '%s' "$FINDEX_RELEASE_KEYSTORE_BASE64" | base64 -d > "$keystore"
  printf '%s' "$FINDEX_RELEASE_KEYSTORE_PASSWORD" > "$password_file"
elif [[ "${FINDEX_BOOTSTRAP:-0}" == "1" ]]; then
  if gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
    echo "::error::$tag already exists. Bootstrap generation is retired; add the signing secrets instead." >&2
    exit 1
  fi
  source_kind="bootstrap"
  openssl rand -hex 32 > "$password_file"
  keytool -genkeypair -noprompt -storetype PKCS12 \
    -keystore "$keystore" -alias findex \
    -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity 10000 \
    -dname 'CN=Findex Release, O=Findex' \
    -storepass:file "$password_file" -keypass:file "$password_file" >/dev/null
else
  echo '::error::No signing secrets configured. Follow docs/RELEASING.md: add FINDEX_RELEASE_KEYSTORE_BASE64 and FINDEX_RELEASE_KEYSTORE_PASSWORD as repository secrets.' >&2
  exit 1
fi

keytool -exportcert -keystore "$keystore" -alias findex -storepass:file "$password_file" -file "$public_cert" >/dev/null
actual=$(openssl x509 -inform DER -in "$public_cert" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':' | tr '[:upper:]' '[:lower:]')
if [[ "$source_kind" == "repository-secret" && "$actual" != "$expected" ]]; then
  echo '::error::Configured signing secret does not match signing/release-policy.json.' >&2
  exit 1
fi

"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging "$input" > "$badging"
python3 "$root/scripts/verify-release-metadata.py" "$policy_file" "$badging"

mkdir -p "$(dirname "$output")"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" sign --ks "$keystore" --ks-type PKCS12 --ks-key-alias findex \
  --ks-pass "file:$password_file" --key-pass "file:$password_file" \
  --v4-signing-enabled false --min-sdk-version 26 --out "$output" "$input"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$output" > "$verification"
signer=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$verification" | tr '[:upper:]' '[:lower:]')
if [[ "$signer" != "$actual" ]]; then
  echo '::error::Signed APK certificate does not match the signing keystore.' >&2
  exit 1
fi
"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 4 "$output"
cp "$verification" "${output%.apk}-signature.txt"
(cd "$(dirname "$output")" && sha256sum "$(basename "$output")" > "$(basename "$output").sha256")

if [[ "$source_kind" == "bootstrap" ]]; then
  mkdir -p "$private"
  tar -czf "$work/backup.tar.gz" -C "$work" release.p12 password.txt
  openssl cms -encrypt -binary -aes-256-gcm -outform DER \
    -in "$work/backup.tar.gz" -out "$private/signing-backup-v1.1.enc" \
    -recip "$root/signing/backup-recipient.pem" -keyopt rsa_padding_mode:oaep
  python3 - "$private/signing-backup-v1.1.enc" <<'PYTHON'
import base64, hashlib, pathlib, sys
payload = pathlib.Path(sys.argv[1]).read_bytes()
encoded = base64.b64encode(payload).decode('ascii')
chunks = [encoded[offset:offset + 2800] for offset in range(0, len(encoded), 2800)]
print(f'::notice title=Findex encrypted signing backup SHA256::{hashlib.sha256(payload).hexdigest()}')
for index, chunk in enumerate(chunks, 1):
    print(f'::notice title=Findex encrypted signing backup {index}/{len(chunks)}::{chunk}')
PYTHON
  echo "::notice title=Findex signing certificate SHA256::$actual"
fi

if ! gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  gh release create "$tag" --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" --draft \
    --title "Findex $version_name" --notes-file "$root/docs/releases/$version_name.md" \
    "$output" "${output%.apk}-signature.txt" "${output}.sha256"
  echo "Draft release $tag created. It is published only after the operator verifies the certificate and updates the policy."
fi
echo "Signed $tag from $source_kind. Certificate SHA-256: $actual"
