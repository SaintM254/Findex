#!/usr/bin/env bash
# Owner-only: stores the Findex release signing identity as repository secrets.
# Run from a trusted machine that holds the decrypted keystore. The values are
# read from files only; never paste keys or passwords into chat or issues.
set -euo pipefail
repo=${GH_REPO:-SaintM254/Findex}
keystore=${1:?Usage: setup-release-secrets.sh keystore.p12 password-file}
password_file=${2:?A private password file is required}
test -s "$keystore"; test -s "$password_file"
gh secret set --repo "$repo" FINDEX_RELEASE_KEYSTORE_BASE64 --body "$(base64 -w0 < "$keystore")"
gh secret set --repo "$repo" FINDEX_RELEASE_KEYSTORE_PASSWORD --body-file "$password_file"
echo 'Secrets stored. Future release jobs sign with them; bootstrap generation stays retired.'
