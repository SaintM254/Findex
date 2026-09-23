"""Validate update identity without handling any private signing credentials."""
import json
import pathlib
import re
import sys

policy = json.loads(pathlib.Path(sys.argv[1]).read_text())
badging = pathlib.Path(sys.argv[2]).read_text()
match = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
if not match:
    raise SystemExit('APK package/version metadata is missing.')
package, code, version = match.groups()
if package != policy['applicationId'] or int(code) != policy['versionCode'] or version != policy['versionName']:
    raise SystemExit('APK does not match the intended update package/version policy.')
if int(code) <= 1:
    raise SystemExit('An update must increase versionCode beyond the published v1.0 build.')
print(f'Update package verified: {package}, version {version}, versionCode {code}.')
