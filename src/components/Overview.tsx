import { memo, useMemo } from 'react';
import { indexFiles } from '../lib/file-index';
import { ArrowRight, ArrowUpRight, Check, ChevronRight, MoreHorizontal } from 'lucide-react';
import type { FileItem, Location } from '../lib/types';
import { CATEGORY_LABELS, CATEGORY_ORDER, formatBytes } from '../lib/utils';
import { useWorkspace } from '../lib/workspace';
import { CategoryIcon, FolderGlyph, IconButton, WaveMark } from './ui';
import { FileList, useLongPress, type FileListActions } from './FileList';

interface Props extends FileListActions {
  navigate: (location: Location) => void;
  assistant: (prompt?: string) => void;
  view: 'list' | 'grid';
  setView: (view: 'list' | 'grid') => void;
}
export const Overview = memo(function Overview({
  navigate,
  assistant,
  view,
  setView,
  ...actions
}: Props) {
  const { files, storage, summary } = useWorkspace();
  const index = useMemo(() => indexFiles(files), [files]);
  const live = index.live;
  const documents = useMemo(() => live.filter((file) => file.kind === 'file'), [live]);
  const distribution = CATEGORY_ORDER.map(
    (category) =>
      summary?.categories.find((item) => item.category === category) ||
      index.categories.find((item) => item.category === category)!,
  );
  const total = distribution.reduce((sum, item) => sum + item.bytes, 0);
  const fileCount = distribution.reduce((sum, item) => sum + item.count, 0);
  const quickFolders = useMemo(() => {
    const pinned = [...index.pinned]
      .sort(
        (a, b) =>
          ['sage', 'sand', 'lavender', 'blue'].indexOf(a.color || 'sage') -
          ['sage', 'sand', 'lavender', 'blue'].indexOf(b.color || 'sage'),
      )
      .slice(0, 4);
    return pinned.length
      ? pinned
      : (index.children.get(storage.rootId) || [])
          .filter((file) => file.kind === 'folder' && !file.trashedAt)
          .slice(0, 4);
  }, [index, storage.rootId]);
  const recent = useMemo(
    () => [...documents].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 5),
    [documents],
  );
  const storageValue = formatBytes(storage.isDemo ? total : storage.used);
  const [amount, unit] = storageValue.split(' ');
  return (
    <div className="overview-content">
      <div className="hero-grid">
        <section className="welcome-card" aria-label="Meet your file assistant">
          <img
            className="hero-image"
            src="/images/findex-hero.png"
            alt="A frosted sage folder holding a few thoughtfully arranged pages"
          />
          <div className="hero-shade" />
          <div className="welcome-copy">
            <div className="eyebrow hero-eyebrow">
              <span className="tiny-dot" /> A LITTLE ORDER. A LOT OF CALM.
            </div>
            <h2>
              Good things,
              <br />
              in their place.
            </h2>
            <p>
              A little help finding, sorting, and
              <br className="desktop-break" /> making space for what’s next.
            </p>
            <button className="hero-button" onClick={() => assistant()}>
              <WaveMark />
              Meet your file assistant
              <ArrowUpRight size={16} />
            </button>
          </div>
        </section>
        <section className="storage-card surface-card">
          <div className="card-topline">
            <h3>{storage.isDemo ? 'Your storage' : 'Device storage'}</h3>
            <IconButton label="Analyze storage" onClick={() => assistant('Analyze my storage')}>
              <MoreHorizontal size={20} />
            </IconButton>
          </div>
          <div className="storage-value">
            {amount}
            <span>{unit}</span>
            <span className="storage-device">
              {storage.isDemo ? 'in your workspace' : `of ${formatBytes(storage.total)}`}
            </span>
          </div>
          <div
            className="storage-meter"
            title="Colored segments describe indexed files across available volumes"
            aria-label={`${fileCount} indexed files using ${formatBytes(storage.indexed)}`}
          >
            {distribution
              .filter((item) => item.bytes > 0)
              .map((item) => (
                <span
                  key={item.category}
                  className={`meter-segment ${item.category}`}
                  style={{ flex: Math.max(item.bytes / (total || 1), 0.035) }}
                  title={`${CATEGORY_LABELS[item.category]}: ${formatBytes(item.bytes)}`}
                />
              ))}
          </div>
          <div className="storage-legend">
            {distribution
              .filter((item) => item.bytes > 0)
              .sort((a, b) => b.bytes - a.bytes)
              .slice(0, 4)
              .map((item) => (
                <div key={item.category}>
                  <span className={`legend-dot ${item.category}`} />
                  <span>{CATEGORY_LABELS[item.category]}</span>
                  <strong>{formatBytes(item.bytes)}</strong>
                </div>
              ))}
          </div>
          <button
            className="storage-link"
            onClick={() => assistant('Review my storage and largest files')}
          >
            <span>Make a little room</span>
            <ArrowUpRight size={15} />
          </button>
        </section>
      </div>
      <section className="category-section" aria-label="Browse by file type">
        <div className="category-grid">
          {distribution.map(({ category, count }) => (
            <button
              key={category}
              className="category-card surface-card"
              onClick={() =>
                navigate({ page: 'category', id: category, title: CATEGORY_LABELS[category] })
              }
            >
              <span className={`category-symbol ${category}`}>
                <CategoryIcon category={category} />
              </span>
              <span className="category-copy">
                <strong>{CATEGORY_LABELS[category]}</strong>
                <span>
                  {count} {count === 1 ? 'file' : 'files'}
                </span>
              </span>
              <ChevronRight className="category-chevron" size={14} />
            </button>
          ))}
        </div>
      </section>
      <section className="quick-access-section">
        <div className="section-heading">
          <div>
            <h2>
              Quick access
              <span className="section-count">
                {quickFolders.length.toString().padStart(2, '0')}
              </span>
            </h2>
          </div>
          <button className="text-button subtle" onClick={() => navigate({ page: 'all' })}>
            All folders
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="folder-grid">
          {quickFolders.map((file) => (
            <QuickFolder
              key={file.id}
              file={file}
              selected={actions.selected.has(file.id)}
              selectionActive={actions.selected.size > 0}
              onOpen={() => actions.onOpen(file)}
              onSelect={() => actions.onSelect(file.id)}
              onMenu={(event) => actions.onMenu(file, event)}
              count={
                summary?.folders?.find((item) => item.id === file.id)?.count ??
                index.directFileCount.get(file.id) ??
                0
              }
              size={
                summary?.folders?.find((item) => item.id === file.id)?.bytes ??
                index.bytes.get(file.id) ??
                0
              }
            />
          ))}
        </div>
      </section>
      <section className="recent-section">
        <div className="section-heading recent-heading">
          <div>
            <h2>Recent files</h2>
            <p>Right where you left them.</p>
          </div>
          <button className="text-button subtle" onClick={() => navigate({ page: 'recent' })}>
            View all files
            <ArrowRight size={15} />
          </button>
        </div>
        <FileList
          files={recent}
          allFiles={files}
          {...actions}
          view={view}
          setView={setView}
          compact
        />
      </section>
      <div className="workspace-footer">
        <span className="status-dot" />
        {storage.isDemo
          ? 'A little preview of a more organized day. Your changes stay in this browser.'
          : 'Your files stay on your device. Exactly where they belong.'}
        <span className="footer-wordmark">made for a little less.</span>
      </div>
    </div>
  );
});
function QuickFolder({
  file,
  selected,
  selectionActive,
  onOpen,
  onSelect,
  onMenu,
  count,
  size,
}: {
  file: FileItem;
  selected: boolean;
  selectionActive: boolean;
  onOpen: () => void;
  onSelect: () => void;
  onMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  count: number;
  size: number;
}) {
  const hold = useLongPress(onSelect);
  return (
    <div className={`quick-folder surface-card ${selected ? 'selected' : ''}`} {...hold.handlers}>
      <button
        className="quick-folder-open file-target"
        aria-label={`Open ${file.name}`}
        onClick={() => {
          if (hold.wasHeld.current) {
            hold.wasHeld.current = false;
            return;
          }
          if (selectionActive) onSelect();
          else onOpen();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onOpen();
          }
          if (event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <div className="quick-folder-top">
          <FolderGlyph color={file.color || 'sage'} />
        </div>
        <div className="quick-folder-name">
          {file.name}
          {selected && <Check size={15} />}
        </div>
        <div className="quick-folder-meta">
          <span>{count} files</span>
          <span>·</span>
          <span>{formatBytes(size)}</span>
        </div>
      </button>
      <IconButton className="quick-folder-menu" label={`Actions for ${file.name}`} onClick={onMenu}>
        <MoreHorizontal size={19} />
      </IconButton>
    </div>
  );
}
