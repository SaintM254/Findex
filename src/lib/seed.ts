import { zipSync, strToU8 } from 'fflate';
import type { FileItem, FolderColor } from './types';
import { categoryFor, extension, fingerprint, mimeFor } from './utils';

export async function seedWorkspace(): Promise<{ files: FileItem[]; blobs: Map<string, Blob> }> {
  const now = new Date();
  now.setHours(10, 42, 0, 0);
  const today = now.getTime();
  const files: FileItem[] = [];
  const blobs = new Map<string, Blob>();
  const folders: [string, string, FolderColor, boolean][] = [
    ['projects', 'Work projects', 'sage', true],
    ['personal', 'Personal', 'sand', true],
    ['designs', 'Design library', 'lavender', true],
    ['downloads', 'Downloads', 'blue', true],
    ['screenshots', 'Screenshots', 'sage', false],
  ];
  for (const [id, name, color, pinned] of folders)
    files.push({
      id,
      name,
      path: `/${name}`,
      parentId: 'root',
      kind: 'folder',
      category: 'other',
      extension: '',
      mime: 'inode/directory',
      size: 0,
      createdAt: today - 60 * 86400_000,
      modifiedAt: today,
      favorite: id === 'projects',
      color,
      pinned,
    });
  const assets = await Promise.all(
    [
      '/samples/brand-guidelines.pdf',
      '/samples/cv.pdf',
      '/images/alpine-lake.jpg',
      '/images/coastal-escape.jpg',
      '/samples/sunday-mornings.wav',
      '/samples/alpine-morning.mp4',
    ].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not load the preview files. Please refresh.');
      return response.blob();
    }),
  );
  const [brand, cv, alpine, coast, audio, video] = assets;
  const archive = new Blob(
    [
      zipSync({
        'readme.txt': strToU8(
          'Findex website assets\nA small, real ZIP archive for the preview workspace.',
        ),
        'palette.json': strToU8('{"evergreen":"#244b36","sage":"#dfe8d8","canvas":"#f4f6f1"}'),
      }) as Uint8Array<ArrayBuffer>,
    ],
    { type: 'application/zip' },
  );
  type Definition = [string, string, string, Blob | string, number, boolean?, string?];
  const definitions: Definition[] = [
    [
      'guidelines',
      'Brand guidelines.pdf',
      'projects',
      brand,
      0,
      true,
      'Findex brand guidelines. Visual identity, typography, color palette, interaction design.',
    ],
    ['coastal', 'Coastal escape.jpg', 'personal', coast, 0.01, true],
    [
      'budget',
      'Q3 budget.csv',
      'projects',
      'Category,July,August,September\nDesign,2400,2600,2800\nDevelopment,6500,6500,7200\nResearch,1200,1800,1400\nOperations,850,850,900\nTotal,10950,11750,12300',
      0.03,
    ],
    ['video', 'Alpine morning.mp4', 'downloads', video, 0.1],
    [
      'audio',
      'Sunday mornings.wav',
      'downloads',
      audio,
      1,
      false,
      'A short, gentle, generated ambient chord.',
    ],
    ['archive', 'Website assets.zip', 'designs', archive, 1.1],
    ['alpine', 'The quiet way home.jpg', 'personal', alpine, 2, true],
    [
      'cv',
      'Alex Morgan — CV.pdf',
      'personal',
      cv,
      35,
      false,
      'Curriculum vitae. Alex Morgan, product designer, work experience and education.',
    ],
    [
      'checklist',
      'Launch checklist.md',
      'projects',
      '# A thoughtful launch\n\n- [x] Finish the design system\n- [x] Review accessibility\n- [ ] Test the Android build on a physical device\n- [ ] Validate large-file operations\n- [ ] Publish the release notes\n\nSmall details make the difference.',
      2.2,
    ],
    [
      'proposal',
      'Project proposal.txt',
      'projects',
      'NORTH STUDIO\nProject proposal — Autumn 2026\n\nOur aim\nBuild a simpler, more considered digital workspace.\n\nScope\nDiscovery, visual design, prototyping, and implementation.\n\nTimeline\nDiscovery: 2 weeks\nDesign: 3 weeks\nBuild: 4 weeks\n\nNext steps\nGather feedback and align on the first milestone.',
      4,
    ],
    [
      'research',
      'Research notes.md',
      'projects',
      '# A better everyday\n\nPeople want to find their files without remembering where they saved them.\n\n## Principles\n1. Keep it clear.\n2. Make the next action obvious.\n3. Never delete without asking.\n4. Build trust with real data.',
      5,
    ],
    [
      'palette',
      'Color palette.json',
      'designs',
      '{\n  "evergreen": "#244B36",\n  "softSage": "#DFE8D8",\n  "warmCanvas": "#F4F6F1",\n  "ink": "#26372E"\n}',
      4,
    ],
    [
      'type',
      'Typography notes.txt',
      'designs',
      'A quiet, confident voice.\n\nHeadings: Manrope\nBody: Inter\n\nUse generous spacing and a clear hierarchy.\nPrefer sentence case.\nKeep the interface calm and the content front and center.',
      6,
    ],
    [
      'weekend',
      'Weekend plans.txt',
      'personal',
      'A little time outside\n\nSaturday\n- A slow breakfast\n- Walk by the coast\n- Pick up a new book\n\nSunday\n- Take the long way home\n- Make something good for dinner',
      3,
    ],
    [
      'reading',
      'Reading list.md',
      'personal',
      '# On the nightstand\n\n- The Design of Everyday Things\n- A Philosophy of Walking\n- The Creative Act\n\nMake room for curiosity.',
      8,
    ],
    [
      'invoice',
      'September invoice.csv',
      'downloads',
      'Description,Quantity,Rate,Total\nProduct design,40,95,3800\nResearch workshop,1,650,650\nTotal,,,4450',
      3,
    ],
    ['duplicate-coast', 'Coastal escape (copy).jpg', 'downloads', coast, 2.5],
    [
      'download-notes',
      'Meeting notes.txt',
      'downloads',
      'Monday standup\n\nFocus for the week:\n- Finalize the file manager experience\n- Review keyboard navigation\n- Test small screens\n- Document the native permission flow',
      5,
    ],
    [
      'old-temp',
      'export-session.tmp',
      'downloads',
      'Temporary export session. Safe sample data for the cleanup review.',
      45,
    ],
    ['screenshot', 'Screenshot 2026-09-21.jpg', 'screenshots', alpine, 1],
  ];
  for (const [id, name, parentId, content, daysAgo, favorite = false, summary] of definitions) {
    const mime = mimeFor(name);
    const blob =
      typeof content === 'string'
        ? new Blob([content], { type: mime })
        : new Blob([content], { type: mime });
    const parent = files.find((file) => file.id === parentId)!;
    const modifiedAt =
      id === 'cv'
        ? new Date(now.getFullYear(), now.getMonth() - 1, 17, 14, 30).getTime()
        : today - daysAgo * 86400_000;
    files.push({
      id,
      name,
      parentId,
      path: `${parent.path}/${name}`,
      kind: 'file',
      category: categoryFor(name, mime),
      extension: extension(name),
      mime,
      size: blob.size,
      createdAt: modifiedAt - 7 * 86400_000,
      modifiedAt,
      favorite,
      summary: summary || (typeof content === 'string' ? content.slice(0, 2000) : undefined),
      fingerprint: await fingerprint(blob),
      previewUrl: name.endsWith('.jpg')
        ? content === coast
          ? '/images/coastal-escape.jpg'
          : '/images/alpine-lake.jpg'
        : undefined,
    });
    blobs.set(id, blob);
  }
  files.push({
    id: 'old-exports',
    name: 'Old exports',
    parentId: 'downloads',
    path: '/Downloads/Old exports',
    kind: 'folder',
    category: 'other',
    extension: '',
    mime: 'inode/directory',
    size: 0,
    createdAt: today - 50 * 86400_000,
    modifiedAt: today - 45 * 86400_000,
    favorite: false,
    color: 'sand',
  });
  return { files, blobs };
}
