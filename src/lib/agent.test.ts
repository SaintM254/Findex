import { describe, expect, it } from 'vitest';
import {
  analyzeFiles,
  filesForPlan,
  organizePlan,
  planLocally,
  validateCloudPlan,
  validateDestination,
} from './agent';
import { file, folder, now } from '../test/fixtures';

const fixtures = [
  folder(),
  file({
    id: 'cv',
    name: 'Alex CV.pdf',
    extension: 'pdf',
    modifiedAt: new Date(2026, 7, 17).getTime(),
  }),
  file({
    id: 'shot',
    name: 'Screenshot 2026-09-21.png',
    category: 'images',
    extension: 'png',
    modifiedAt: new Date(2026, 8, 21, 10).getTime(),
  }),
];
describe('local action planning', () => {
  it('finds the CV edited last month with an explicit date filter', () => {
    const plan = planLocally('Find the CV I edited last month', fixtures, now);
    expect(plan.kind).toBe('search');
    expect(filesForPlan(plan, fixtures).map((item) => item.id)).toEqual(['cv']);
  });
  it('plans yesterday’s screenshots without changing any files', () => {
    const before = JSON.stringify(fixtures);
    const plan = planLocally(
      'Move yesterday’s screenshots to Screenshots/September',
      fixtures,
      now,
    );
    expect(plan.kind).toBe('move');
    expect(plan.destination).toBe('Screenshots/September');
    expect(filesForPlan(plan, fixtures).map((item) => item.id)).toEqual(['shot']);
    expect(JSON.stringify(fixtures)).toBe(before);
  });
  it('organizes only direct child files, leaving folders and trash alone', () => {
    const files = [
      ...fixtures,
      folder({ id: 'nested', parentId: 'downloads' }),
      file({ id: 'trashed', trashedAt: 123 }),
    ];
    const plan = planLocally('Organize my downloads', files, now);
    expect(plan.sourceFolder).toBe('downloads');
    expect(organizePlan(plan.sourceFolder!, files)).toEqual([
      { id: 'cv', destination: 'Documents' },
      { id: 'shot', destination: 'Images' },
    ]);
  });
  it('preserves descriptive terms in category searches', () => {
    const files = [
      file({ id: 'coast', name: 'Coastal.jpg', category: 'images' }),
      file({ id: 'alpine', name: 'Alpine.jpg', category: 'images' }),
    ];
    const plan = planLocally('Find my pictures of coast', files, now);
    expect(filesForPlan(plan, files).map((file) => file.id)).toEqual(['coast']);
  });
  it('does not invent a missing source folder', () => {
    expect(() => planLocally('Organize my downloads', [], now)).toThrow('Name a folder');
  });
  it('rejects vague moves and path traversal', () => {
    expect(() => planLocally('Move everything', fixtures, now)).toThrow('destination');
    expect(() => planLocally('Move screenshots to ../private', fixtures, now)).toThrow('relative');
    for (const path of ['/etc', '../x', 'a/../b', 'a//b', 'a\\b', '.findex-trash/a'])
      expect(() => validateDestination(path)).toThrow();
  });
});
describe('cloud response safety boundary', () => {
  it('rejects arbitrary commands and destructive action names', () => {
    for (const kind of ['shell', 'delete', 'format', 'execute'])
      expect(() => validateCloudPlan({ kind, command: 'rm -rf /' }, fixtures)).toThrow();
  });
  it('rejects nonexistent sources and unconstrained moves', () => {
    expect(() =>
      validateCloudPlan({ kind: 'organize', sourceFolder: 'fictional' }, fixtures),
    ).toThrow('real source');
    expect(() => validateCloudPlan({ kind: 'move', destination: 'Photos' }, fixtures)).toThrow(
      'specific files',
    );
    expect(() =>
      validateCloudPlan(
        { kind: 'move', destination: 'Photos', filter: { text: '', minSize: 0 } },
        fixtures,
      ),
    ).toThrow('specific files');
    expect(() =>
      validateCloudPlan(
        { kind: 'move', filter: { text: 'cv' }, destination: '../../data' },
        fixtures,
      ),
    ).toThrow();
  });
  it('only retains allowlisted, finite query parameters', () => {
    const plan = validateCloudPlan(
      {
        kind: 'search',
        filter: {
          text: 'cv',
          modifiedAfter: Infinity,
          minSize: -1,
          category: 'imaginary',
          command: 'bad',
        },
      },
      fixtures,
    );
    expect(plan.filter).toEqual({ text: 'cv' });
  });
  it('validates an actual organization source', () => {
    expect(
      validateCloudPlan({ kind: 'organize', sourceFolder: 'downloads' }, fixtures).sourceFolder,
    ).toBe('downloads');
  });
});
describe('evidence-based storage analysis', () => {
  it('does not call same-name or same-size files duplicates without hashes', () => {
    const report = analyzeFiles([file({ id: 'a' }), file({ id: 'b' })], undefined, now.getTime());
    expect(report.duplicates).toEqual([]);
    expect(report.cleanup).toEqual([]);
  });
  it('retains the favorite copy and only proposes redundant copies', () => {
    const files = [
      file({ id: 'favorite', fingerprint: 'verified', favorite: true, createdAt: 200 }),
      file({ id: 'other', fingerprint: 'verified', createdAt: 100 }),
    ];
    const report = analyzeFiles(files, undefined, now.getTime());
    expect(report.duplicates[0][0].id).toBe('favorite');
    expect(report.cleanup.map((item) => item.id)).toEqual(['other']);
  });
  it('uses a 30-day threshold for installers and temporary files', () => {
    const report = analyzeFiles(
      [
        file({ id: 'old', extension: 'apk', modifiedAt: now.getTime() - 31 * 86400_000 }),
        file({ id: 'new', extension: 'tmp', modifiedAt: now.getTime() }),
      ],
      undefined,
      now.getTime(),
    );
    expect(report.cleanup.map((item) => item.id)).toEqual(['old']);
  });
  it('reports exact sizes and honest first-scan growth', () => {
    const report = analyzeFiles(
      [folder(), file({ size: 100 }), file({ id: '2', size: 200 })],
      undefined,
      now.getTime(),
    );
    expect(report.totalBytes).toBe(300);
    expect(report.totalFiles).toBe(2);
    expect(report.growth[0]).toEqual({ name: 'Downloads', bytes: 300, previousBytes: null });
    expect(
      analyzeFiles([folder(), file({ size: 400 })], { downloads: 300 }).growth[0].previousBytes,
    ).toBe(300);
  });
  it('never suggests a non-empty folder as empty', () => {
    expect(analyzeFiles([folder(), file()]).emptyFolders).toHaveLength(0);
    expect(analyzeFiles([folder()]).emptyFolders).toHaveLength(1);
  });
});
