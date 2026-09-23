import { describe, expect, it } from 'vitest';
import {
  categoryFor,
  descendants,
  fingerprint,
  formatBytes,
  isDescendant,
  topLevelSelection,
  uniqueName,
  validateName,
} from './utils';
import { file, folder } from '../test/fixtures';

describe('filesystem invariants', () => {
  it('rejects names that escape a parent or target Findex internals', () => {
    for (const name of [
      '',
      '  ',
      '.',
      '..',
      'a/b',
      'a\\b',
      'a\u0000b',
      '.findex-trash',
      '.findex-staging',
      'é'.repeat(121),
    ])
      expect(() => validateName(name)).toThrow();
    expect(validateName('  Autumn notes.md  ')).toBe('Autumn notes.md');
  });
  it('generates conflict-safe names without replacing originals', () => {
    expect(uniqueName('report.pdf', ['report.pdf', 'report (1).pdf'])).toBe('report (2).pdf');
    expect(uniqueName('Downloads', ['Downloads'])).toBe('Downloads (1)');
    expect(uniqueName('.notes', ['.notes'])).toBe('.notes (1)');
  });
  it('deduplicates nested selections to prevent processing a child twice', () => {
    const files = [
      folder(),
      file(),
      folder({ id: 'nested', parentId: 'downloads', path: '/Downloads/Nested' }),
      file({ id: 'deep', parentId: 'nested', path: '/Downloads/Nested/Deep.txt' }),
    ];
    expect(topLevelSelection(['downloads', 'file-1', 'deep'], files)).toEqual(['downloads']);
    expect(descendants('downloads', files)).toHaveLength(4);
    expect(isDescendant('nested', 'downloads', files)).toBe(true);
  });
  it('terminates even if an imported index contains a parent cycle', () => {
    const files = [folder({ id: 'a', parentId: 'b' }), folder({ id: 'b', parentId: 'a' })];
    expect(isDescendant('a', 'missing', files)).toBe(false);
  });
  it('classifies MKV, PDF and other supported formats', () => {
    expect(categoryFor('holiday.MKV')).toBe('videos');
    expect(categoryFor('report.PDF')).toBe('documents');
    expect(categoryFor('track', 'audio/flac')).toBe('audio');
    expect(categoryFor('stuff.zip')).toBe('archives');
    expect(categoryFor('package.apk')).toBe('other');
  });
  it('formats zero, invalid and large byte counts safely', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(-10)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
  });
  it('computes actual SHA-256, rather than a filename heuristic', async () => {
    expect(await fingerprint(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await fingerprint(new Blob(['abc']))).not.toBe(await fingerprint(new Blob(['abd'])));
  });
});
