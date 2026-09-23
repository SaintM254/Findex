#!/usr/bin/env python3
"""Recover only an authenticated, encrypted backup from an authorized release run.

The script never prints a private key or password. The certificate fingerprint
and verification status are public. GitHub access always goes through `gh`.
"""
import base64
import hashlib
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import tarfile

os.umask(0o077)
root = pathlib.Path(__file__).resolve().parent.parent
private = root / '.release-signing'
private.mkdir(mode=0o700, exist_ok=True)
if len(sys.argv) != 2 or not sys.argv[1].isdigit():
    raise SystemExit('Usage: python3 scripts/recover-release-backup.py RUN_ID')


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', path], cwd=root))


repo = json.loads(subprocess.check_output(
    ['gh', 'repo', 'view', '--json', 'nameWithOwner'], cwd=root
))['nameWithOwner']
run = api(f'repos/{repo}/actions/runs/{sys.argv[1]}')
if run['head_branch'] != 'arena/01a0caa2-findex':
    raise SystemExit('The run is not from the authorized release branch.')
jobs = api(f'repos/{repo}/actions/runs/{sys.argv[1]}/jobs')['jobs']
job = next((job for job in jobs if job['name'] in {
    'Sign APK and prepare v1.0 release', 'Sign the already verified v1.0 APK'
}), None)
if not job:
    raise SystemExit('Signing job not found.')
annotations = api(f"{job['check_run_url']}/annotations?per_page=100")
chunks = {}
expected_count = 0
expected_hash = None
expected_signer = None
for annotation in annotations:
    title = annotation.get('title', '')
    message = annotation['message'].strip()
    part = re.fullmatch(r'Findex encrypted backup (\d+)/(\d+)', title)
    if part:
        number, count = map(int, part.groups())
        if expected_count and count != expected_count:
            raise SystemExit('Inconsistent encrypted backup chunk count.')
        expected_count = count
        chunks[number] = message
    elif title == 'Findex encrypted backup SHA256':
        expected_hash = message.lower()
    elif title == 'Findex signing certificate SHA256':
        expected_signer = message.lower()
if not expected_count or set(chunks) != set(range(1, expected_count + 1)):
    raise SystemExit('Encrypted backup is not yet complete; no local signing key changed.')
payload = base64.b64decode(''.join(chunks[index] for index in sorted(chunks)), validate=True)
if hashlib.sha256(payload).hexdigest() != expected_hash:
    raise SystemExit('Encrypted backup checksum did not match.')
if not expected_signer or not re.fullmatch(r'[0-9a-f]{64}', expected_signer):
    raise SystemExit('Signed APK certificate fingerprint is missing.')
envelope = private / 'signing-backup.enc'
envelope.write_bytes(payload)
archive = subprocess.check_output([
    'openssl', 'cms', '-decrypt', '-binary', '-inform', 'DER', '-in', str(envelope),
    '-inkey', str(private / 'transport-key.pem'),
    '-passin', f'file:{private / "transport-password.txt"}',
])
with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as backup:
    expected = {'findex-release.p12', 'keystore-password.txt'}
    members = backup.getmembers()
    if {member.name for member in members} != expected or any(
        not member.isfile() or member.size > 100_000 for member in members
    ):
        raise SystemExit('Unexpected content in the decrypted backup.')
    extracted = {member.name: backup.extractfile(member).read() for member in members}

candidate_key = private / 'candidate.p12'
candidate_password = private / 'candidate-password.txt'
try:
    candidate_key.write_bytes(extracted['findex-release.p12'])
    candidate_password.write_bytes(extracted['keystore-password.txt'])
    public_certificate = subprocess.check_output([
        'openssl', 'pkcs12', '-in', str(candidate_key),
        '-passin', f'file:{candidate_password}', '-clcerts', '-nokeys',
    ], stderr=subprocess.DEVNULL)
    fingerprint = subprocess.check_output([
        'openssl', 'x509', '-noout', '-fingerprint', '-sha256',
    ], input=public_certificate).decode().strip().split('=', 1)[1].replace(':', '').lower()
    if fingerprint != expected_signer:
        raise SystemExit('Backup identity does not match the verified APK signer.')
    for name, value in extracted.items():
        target = private / name
        if target.exists() and target.read_bytes() != value:
            raise SystemExit(f'Refusing to overwrite an existing {name}.')
    for name, value in extracted.items():
        (private / name).write_bytes(value)
    (private / 'verification.json').write_text(json.dumps({
        'release': 'v1.0', 'run': run['html_url'], 'sourceCommit': run['head_sha'],
        'certificateSha256': fingerprint, 'encryptedBackupSha256': expected_hash,
    }, indent=2) + '\n')
    print('Signing backup decrypted and verified; private files saved outside Git.')
    print('Public signing certificate SHA-256:', fingerprint)
finally:
    candidate_key.unlink(missing_ok=True)
    candidate_password.unlink(missing_ok=True)
