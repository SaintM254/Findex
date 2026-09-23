import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRepository, defaultPreferences } from './browser-repository';
import { file, folder } from '../test/fixtures';
import { openDB } from 'idb';

vi.mock('./seed', () => ({
  seedWorkspace: async () => ({
    files: [
      folder(),
      folder({ id: 'personal', name: 'Personal', path: '/Personal' }),
      file({ id: 'notes', size: 12 }),
      folder({ id: 'nested', name: 'Nested', path: '/Downloads/Nested', parentId: 'downloads' }),
      file({
        id: 'deep',
        name: 'Deep.txt',
        path: '/Downloads/Nested/Deep.txt',
        parentId: 'nested',
        size: 5,
      }),
    ],
    blobs: new Map([
      ['notes', new Blob(['hello findex'], { type: 'text/plain' })],
      ['deep', new Blob(['hello'], { type: 'text/plain' })],
    ]),
  }),
}));
let repo: BrowserRepository;
let databaseName: string;
beforeEach(() => {
  databaseName = `findex-test-${crypto.randomUUID()}`;
  repo = new BrowserRepository(databaseName);
});
const live = async () => (await repo.load()).files.filter((file) => !file.trashedAt);

describe('real, persistent file operations', () => {
  it('initializes a clearly marked browser workspace with exact byte totals', async () => {
    const snapshot = await repo.load();
    expect(snapshot.storage.isDemo).toBe(true);
    expect(snapshot.storage.indexed).toBe(17);
    expect(snapshot.files).toHaveLength(5);
  });
  it('creates a folder and rejects duplicate names and non-folder destinations', async () => {
    const id = await repo.createFolder('Autumn', 'personal');
    expect((await live()).find((file) => file.id === id)?.path).toBe('/Personal/Autumn');
    await expect(repo.createFolder('Autumn', 'personal')).rejects.toThrow('already exists');
    await expect(repo.createFolder('Invalid', 'notes')).rejects.toThrow('destination');
  });
  it('serializes concurrent writes so two identical names cannot slip through', async () => {
    const results = await Promise.allSettled([
      repo.createFolder('Same', 'root'),
      repo.createFolder('Same', 'root'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await live()).filter((file) => file.name === 'Same')).toHaveLength(1);
  });
  it('renames whole subtrees without changing stable IDs', async () => {
    await repo.rename('downloads', 'Inbox');
    expect((await live()).find((file) => file.id === 'deep')?.path).toBe('/Inbox/Nested/Deep.txt');
    expect((await live()).find((file) => file.id === 'notes')?.name).toBe('Notes.txt');
  });
  it('copies actual bytes and generates a unique name on repeated paste', async () => {
    await repo.operate({ action: 'copy', ids: ['notes'], destination: 'personal' });
    await repo.operate({ action: 'copy', ids: ['notes'], destination: 'personal' });
    const copies = (await live()).filter((file) => file.parentId === 'personal');
    expect(copies.map((file) => file.name).sort()).toEqual(['Notes (1).txt', 'Notes.txt']);
    for (const copy of copies)
      expect(await (await repo.getBlob(copy.id)).text()).toBe('hello findex');
    expect(await (await repo.getBlob('notes')).text()).toBe('hello findex');
  });
  it('copies nested selections only once and remaps child parent IDs', async () => {
    await repo.operate({
      action: 'copy',
      ids: ['downloads', 'notes', 'deep'],
      destination: 'personal',
    });
    const files = await live();
    const copy = files.find((file) => file.path === '/Personal/Downloads')!;
    const nested = files.find((file) => file.path === '/Personal/Downloads/Nested')!;
    expect(nested.parentId).toBe(copy.id);
    expect(
      files.find((file) => file.path === '/Personal/Downloads/Nested/Deep.txt')?.parentId,
    ).toBe(nested.id);
    expect(files).toHaveLength(9);
  });
  it('moves entire directories and rejects self / descendant destinations', async () => {
    await expect(
      repo.operate({ action: 'move', ids: ['downloads'], destination: 'nested' }),
    ).rejects.toThrow('inside itself');
    await expect(
      repo.operate({ action: 'copy', ids: ['downloads'], destination: 'downloads' }),
    ).rejects.toThrow('inside itself');
    await repo.operate({ action: 'move', ids: ['nested'], destination: 'personal' });
    expect((await live()).find((file) => file.id === 'deep')?.path).toBe(
      '/Personal/Nested/Deep.txt',
    );
    expect((await live()).find((file) => file.id === 'nested')?.parentId).toBe('personal');
  });
  it('treats a move into the existing parent as a no-op', async () => {
    await repo.operate({ action: 'move', ids: ['notes'], destination: 'downloads' });
    expect((await live()).find((file) => file.id === 'notes')?.name).toBe('Notes.txt');
  });
  it('rolls back a cancelled batch instead of leaving partial copies', async () => {
    await repo.load();
    await expect(
      repo.operate({ action: 'copy', ids: ['notes', 'deep'], destination: 'personal' }, () => {
        void repo.cancelOperation();
      }),
    ).rejects.toThrow();
    expect((await live()).filter((file) => file.parentId === 'personal')).toHaveLength(0);
  });
  it('moves to Trash without destroying blobs, then restores safely around conflicts', async () => {
    await repo.operate({ action: 'trash', ids: ['downloads'] });
    expect((await live()).some((file) => file.id === 'notes')).toBe(false);
    expect(await (await repo.getBlob('notes')).text()).toBe('hello findex');
    await repo.createFolder('Downloads', 'root');
    await repo.operate({ action: 'restore', ids: ['downloads'] });
    expect((await live()).find((file) => file.id === 'downloads')?.name).toBe('Downloads (1)');
    expect((await live()).find((file) => file.id === 'deep')?.path).toBe(
      '/Downloads (1)/Nested/Deep.txt',
    );
  });
  it('only permits permanent deletion from Trash', async () => {
    await expect(repo.operate({ action: 'delete', ids: ['notes'] })).rejects.toThrow('Trash');
    await repo.operate({ action: 'trash', ids: ['nested'] });
    await repo.operate({ action: 'delete', ids: ['nested'] });
    expect((await repo.load()).files.some((file) => file.id === 'deep')).toBe(false);
    await expect(repo.getBlob('deep')).rejects.toThrow('cannot be read');
    expect(await (await repo.getBlob('notes')).text()).toBe('hello findex');
  });
  it('rejects copying trashed files and requests with missing IDs', async () => {
    await repo.operate({ action: 'trash', ids: ['notes'] });
    await expect(
      repo.operate({ action: 'copy', ids: ['notes'], destination: 'personal' }),
    ).rejects.toThrow('Restore');
    await expect(
      repo.operate({ action: 'move', ids: ['not-real'], destination: 'personal' }),
    ).rejects.toThrow('changed');
  });
  it('persists favorites and uses folder favorites for quick access', async () => {
    await repo.setFavorite('nested', true);
    const loaded = await new BrowserRepository(databaseName).load();
    expect(loaded.files.find((file) => file.id === 'nested')).toMatchObject({
      favorite: true,
      pinned: true,
    });
  });
  it('imports real files with text indexing and verified hashes', async () => {
    const upload = new File(['A thoughtful little document.'], 'Imported.txt', {
      type: 'text/plain',
      lastModified: 12345,
    });
    await repo.importFiles([upload, upload], 'personal');
    const imported = (await live()).filter((file) => file.parentId === 'personal');
    expect(imported.map((file) => file.name).sort()).toEqual(['Imported (1).txt', 'Imported.txt']);
    expect(imported[0]).toMatchObject({
      size: upload.size,
      summary: 'A thoughtful little document.',
      modifiedAt: 12345,
    });
    expect(imported[0].fingerprint).toHaveLength(64);
    expect(await (await repo.getBlob(imported[0].id)).text()).toBe('A thoughtful little document.');
  });
});
describe('personal API key boundaries', () => {
  it('keeps browser keys in this session, never in IndexedDB', async () => {
    await repo.savePreferences(
      { ...defaultPreferences, metadataConsent: true },
      'fictional-test-key',
    );
    expect((await repo.load()).preferences.hasKey).toBe(true);
    expect((await new BrowserRepository(databaseName).load()).preferences.hasKey).toBe(false);
    const db = await openDB(databaseName);
    const values = await db.getAll('meta');
    expect(JSON.stringify(values)).not.toContain('fictional-test-key');
    db.close();
  });
  it('never sends metadata without explicit consent', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await repo.savePreferences(defaultPreferences, 'fictional-test-key');
    await expect(repo.askAgent('Find my CV', (await repo.load()).files)).rejects.toThrow(
      'allow metadata',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not reuse a key with a different provider', async () => {
    await repo.savePreferences(
      { ...defaultPreferences, metadataConsent: true },
      'fictional-test-key',
    );
    await repo.savePreferences({
      ...defaultPreferences,
      provider: 'anthropic',
      metadataConsent: true,
    });
    expect((await repo.load()).preferences.hasKey).toBe(false);
    await expect(repo.askAgent('Find my CV', [])).rejects.toThrow('allow metadata');
  });
  it('checks provider responses before accepting any file plan', async () => {
    await repo.savePreferences(
      { ...defaultPreferences, metadataConsent: true },
      'fictional-test-key',
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        choices: [{ message: { content: '{"kind":"shell","command":"destructive"}' } }],
      }),
    );
    await expect(repo.askAgent('Organize files', (await repo.load()).files)).rejects.toThrow(
      'not supported',
    );
    expect(await live()).toHaveLength(5);
  });
});
