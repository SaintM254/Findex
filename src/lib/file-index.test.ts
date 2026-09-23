import { describe, expect, it } from 'vitest';
import { indexFiles } from './file-index';
import { descendants, folderBytes, topLevelSelection } from './utils';
import { file, folder } from '../test/fixtures';

describe('linear-time file indexing', () => {
  it('aggregates nested folders once and excludes Trash', () => {
    const files = [
      folder(),
      folder({ id: 'nested', parentId: 'downloads' }),
      file({ id: 'a', size: 10 }),
      file({ id: 'b', parentId: 'nested', size: 20 }),
      file({ id: 'gone', size: 500, trashedAt: 10 }),
    ];
    const index = indexFiles(files);
    expect(folderBytes('downloads', files)).toBe(30);
    expect(folderBytes('nested', files)).toBe(20);
    expect(index.directFileCount.get('downloads')).toBe(1);
    expect(indexFiles(files)).toBe(index);
    expect(index.trashRoots.map((item) => item.id)).toEqual(['gone']);
  });
  it('handles cycles without locking the main thread', () => {
    const files = [folder({ id: 'a', parentId: 'b' }), folder({ id: 'b', parentId: 'a' })];
    expect(descendants('a', files)).toHaveLength(2);
    expect(indexFiles(files).bytes.get('a')).toBe(0);
  });
  it('does not rebuild a complete lookup map for each of 50,000 files', () => {
    const files = [
      folder(),
      ...Array.from({ length: 50_000 }, (_, i) => file({ id: `f-${i}`, size: 100 })),
    ];
    const start = performance.now();
    const index = indexFiles(files);
    expect(folderBytes('downloads', files)).toBe(5_000_000);
    expect(descendants('downloads', files)).toHaveLength(50_001);
    expect(
      topLevelSelection(
        files.map((item) => item.id),
        files,
      ),
    ).toEqual(['downloads']);
    for (let tap = 0; tap < 100; tap++) expect(indexFiles(files)).toBe(index);
    // Generous CI budget, but catches the former O(n²) map construction (minutes).
    expect(performance.now() - start).toBeLessThan(1800);
  });
});
