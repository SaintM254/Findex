#!/usr/bin/env python3
"""Recover the encrypted v1.1 signing backup using the local private recipient key.

Never prints key material. Stores decrypted files only under the ignored
.release-signing directory.
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


repo = json.loads(subprocess.check_output(['gh', 'repo', 'view', '--json', 'nameWithOwner'], cwd=root))['nameWithOwner']
run = api(f'repos/{repo}/actions/runs/{sys.argv[1]}')
if run['head_branch'] != 'arena/01a0caa2-findex':
    raise SystemExit('The run is not from the authorized release branch.')
jobs = api(f'repos/{repo}/actions/runs/{sys.argv[1]}/jobs')['jobs']
sign_job = next((job for job in jobs if job['name'] == 'Sign and publish the authorized release'), None)
if not sign_job:
    raise SystemExit('No signing job in that run.')
annotations = api(f"{sign_job['check_run_url']}/annotations?per_page=100")
chunks, expected_hash, expected_cert = {}, None, None
for annotation in annotations:
    title = annotation.get('title', '')
    message = annotation['message'].strip()
    part = re.fullmatch(r'Findex encrypted signing backup (\d+)/(\d+)', title)
    if part:
        chunks[int(part.group(1))] = message
    elif title == 'Findex encrypted signing backup SHA256':
        expected_hash = message.lower()
    elif title == 'Findex signing certificate SHA256':
        expected_cert = message.lower()
if not chunks or not expected_hash:
    raise SystemExit('Encrypted backup is not present; the signing job may not have run in bootstrap mode.')
payload = base64.b64decode(''.join(chunks[i] for i in sorted(chunks)), validate=True)
if hashlib.sha256(payload).hexdigest() != expected_hash:
    raise SystemExit('Backup checksum mismatch.')
envelope = private / 'signing-backup.enc'
envelope.write_bytes(payload)
archive = subprocess.check_output([
    'openssl', 'cms', '-decrypt', '-binary', '-inform', 'DER', '-in', str(envelope),
    '-inkey', str(private / 'transport-key.pem'),
    '-passin', f'file:{private / "transport-password.txt"}',
])
with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as backup:
    expected = {'release.p12', 'password.txt'}
    members = backup.getmembers()
    if {member.name for member in members} != expected or any(not member.isfile() or member.size > 200_000 for member in members):
        raise SystemExit('Unexpected backup content.')
    files = {member.name: backup.extractfile(member).read() for member in members}
for name, value in files.items():
    target = private / name
    if target.exists() and target.read_bytes() != value:
        raise SystemExit(f'Refusing to overwrite an existing {name}.')
    target.write_bytes(value)
(public_certificate) = subprocess.check_output(['openssl', 'pkcs12', '-in', str(private / 'release.p12'), '-passin', f'file:{private / "password.txt"}', '-clcerts', '-nokeys'], stderr=subprocess.DEVNULL)
fingerprint = subprocess.check_output(['openssl', 'x509', '-noout', '-fingerprint', '-sha256'], input=public_certificate).decode().strip().split('=', 1)[1].replace(':', '').lower()
if expected_cert and fingerprint != expected_cert:
    raise SystemExit('Recovered key does not match the signed APK certificate.')
(private / 'verification.json').write_text(json.dumps({
    'release': 'v1.1', 'run': run['html_url'], 'certificateSha256': fingerprint,
    'backupSha256': expected_hash,
}, indent=2) + '\n')
print('Recovered the v1.1 signing backup outside Git.')
print('Public certificate SHA-256:', fingerprint)
