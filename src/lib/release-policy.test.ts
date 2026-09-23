import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Android update identity', () => {
  it('pins the published v1.1 signer and keeps the application ID', () => {
    const policy = JSON.parse(readFileSync(resolve('signing/release-policy.json'), 'utf8'));
    expect(policy.applicationId).toBe('app.findex.files');
    expect(policy.expectedCertificateSha256).toBe(
      'e7c3b49f379c051566a3cdc1911e3ac96442d44926c7f70410b61962f0fd4b93',
    );
    expect(policy.signingIdentity).toBe('findex-release-v1.1');
    expect(policy.minimumUpdateVersionCode).toBe(2);
    expect(policy.versionName).toBe('1.1');
    expect(policy.versionCode).toBe(2);
    const gradle = readFileSync(resolve('android/app/build.gradle'), 'utf8');
    expect(gradle).toContain('applicationId "app.findex.files"');
    expect(gradle).toContain('versionCode 2');
    expect(gradle).toContain('versionName "1.1"');
  });
  it('refuses to mint an update signing key', () => {
    const signer = readFileSync(resolve('scripts/sign-compatible-release.sh'), 'utf8');
    expect(signer).not.toMatch(/genkeypair|genpkey|newkey/);
    expect(signer).toContain('this certificate does not match Findex 1.0');
    const retired = readFileSync(resolve('scripts/prepare-release.sh'), 'utf8');
    expect(retired).not.toMatch(/genkeypair|genpkey|newkey/);
    expect(retired).toContain('exit 1');
  });
});
