#!/usr/bin/env bash
# The v1.0 bootstrap generated the application's signing identity exactly once.
# Never generate a replacement for an update: Android would reject it.
set -euo pipefail
echo 'The first-release signing bootstrap is retired.' >&2
echo 'Use scripts/sign-compatible-release.sh with the original Findex 1.0 keystore.' >&2
echo 'A missing key is a release blocker, not permission to create a new signing identity.' >&2
exit 1
