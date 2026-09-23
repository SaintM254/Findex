import { describe, expect, it } from 'vitest';
import {
  categoryFor,
  DEFAULT_MODELS,
  descendants,
  fingerprint,
  formatBytes,
  formatDuration,
  isDescendant,
  resolveModel,
  selectionRange,
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

describe('selection ranges and media metadata helpers', () => {
  it('selects the inclusive range between an anchor and a target, like shift on Windows', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    expect(selectionRange(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(selectionRange(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(selectionRange(order, 'c', 'c')).toEqual(['c']);
    expect(selectionRange(order, 'missing', 'd')).toEqual(['d']);
  });
  it('formats audio durations for pills and dialogs', () => {
    expect(formatDuration(63)).toBe('1:03');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
  });
  it('maps retired provider defaults onto current models', () => {
    expect(resolveModel('claude-sonnet-4-20250514')).toBe('claude-haiku-4-5');
    expect(resolveModel('gpt-4.1-mini')).toBe('gpt-5-mini');
    expect(resolveModel('gemini-2.5-flash')).toBe('gemini-2.5-flash');
    expect(DEFAULT_MODELS.anthropic).toBe('claude-haiku-4-5');
  });
  it('recognizes extended local audio formats', () => {
    expect(categoryFor('voice memo.amr')).toBe('audio');
    expect(categoryFor('album.mka')).toBe('audio');
    expect(categoryFor('memo.aiff', 'audio/x-aiff')).toBe('audio');
  });
});
