import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  ArrowDownWideNarrow,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  List,
  MoreHorizontal,
  Search,
  Star,
} from 'lucide-react';
import { indexFiles } from '../lib/file-index';
import type { FileItem, FileSort } from '../lib/types';
import { formatBytes, relativeDate } from '../lib/utils';
import { EmptyState, FileIcon, IconButton } from './ui';

export interface FileListActions {
  selected: Set<string>;
  onSelect: (id: string) => void;
  onOpen: (file: FileItem) => void;
  onMenu: (file: FileItem, event: MouseEvent<HTMLElement>) => void;
}
interface Props extends FileListActions {
  files: FileItem[];
  allFiles: FileItem[];
  view: 'list' | 'grid';
  setView: (view: 'list' | 'grid') => void;
  compact?: boolean;
  isTrash?: boolean;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPage: (page: number) => void;
    sort: FileSort;
    onSort: (sort: FileSort) => void;
    loading?: boolean;
  };
}
export function useLongPress(onHold: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef({ x: 0, y: 0 });
  const wasHeld = useRef(false);
  const clear = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    wasHeld,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        wasHeld.current = false;
        const button = (event.target as HTMLElement).closest('button');
        if (event.button !== 0 || (button && !button.classList.contains('file-target'))) return;
        start.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(() => {
          wasHeld.current = true;
          onHold();
          if ('vibrate' in navigator) navigator.vibrate(18);
        }, 460);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 8)
          clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
    },
  };
}
export const FileList = memo(function FileList({
  files,
  allFiles,
  view,
  setView,
  compact = false,
  isTrash = false,
  pagination,
  ...actions
}: Props) {
  const [localSort, setLocalSort] = useState<FileSort>('modified');
  const sort = pagination?.sort || localSort;
  const setSort = pagination?.onSort || setLocalSort;
  const allIndex = useMemo(() => indexFiles(allFiles), [allFiles]);
  const [limit, setLimit] = useState(80);
  const sorted = useMemo(
    () =>
      pagination
        ? files
        : [...files].sort((a, b) => {
            if (!compact && a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
            if (sort === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true });
            if (sort === 'size') return b.size - a.size;
            return isTrash ? b.trashedAt! - a.trashedAt! : b.modifiedAt - a.modifiedAt;
          }),
    [files, sort, compact, isTrash, pagination],
  );
  if (!files.length)
    return (
      <EmptyState
        icon={isTrash ? undefined : <Search size={27} strokeWidth={1.4} />}
        title={isTrash ? 'A fresh start.' : 'A little room for something new.'}
        description={
          isTrash
            ? 'Your Trash is empty. Removed files will wait here until you are ready to let them go.'
            : 'No files here just yet. Try another search, create a folder, or add a few files.'
        }
      />
    );
  return (
    <div className={`file-browser ${compact ? 'compact' : ''}`}>
      {!compact && (
        <div className="file-toolbar">
          <span className="file-count">
            {pagination?.total ?? files.length}{' '}
            {(pagination?.total ?? files.length) === 1 ? 'item' : 'items'}
            <span className="file-count-dot">·</span>
            {formatBytes(
              files
                .filter((file) => file.kind === 'file')
                .reduce((sum, file) => sum + file.size, 0),
            )}
          </span>
          <div className="file-toolbar-actions">
            <label className="sort-select">
              <ArrowDownWideNarrow size={15} />
              <select
                aria-label="Sort files"
                value={sort}
                onChange={(event) => setSort(event.target.value as FileSort)}
              >
                <option value="modified">{isTrash ? 'Removed date' : 'Last modified'}</option>
                <option value="name">Name</option>
                <option value="size">File size</option>
              </select>
            </label>
            <div className="view-switch" role="group" aria-label="File view">
              <IconButton
                label="List view"
                className={view === 'list' ? 'is-active' : ''}
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                <List size={18} />
              </IconButton>
              <IconButton
                label="Grid view"
                className={view === 'grid' ? 'is-active' : ''}
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
              >
                <Grid2X2 size={17} />
              </IconButton>
            </div>
          </div>
        </div>
      )}
      {view === 'grid' && !compact ? (
        <div className="files-grid">
          {sorted.slice(0, limit).map((file) => (
            <FileCard key={file.id} file={file} {...actions} />
          ))}
        </div>
      ) : (
        <div className="file-table" role="table" aria-label={compact ? 'Recent files' : 'Files'}>
          <div className="file-table-head" role="row">
            <span role="columnheader" className="name-heading">
              Name
            </span>
            <span role="columnheader" className="location-column">
              Location
            </span>
            <span role="columnheader" className="modified-column">
              {isTrash ? 'Removed' : 'Last modified'}
              <span className="sort-down">↓</span>
            </span>
            <span role="columnheader" className="size-column">
              Size
            </span>
            <span />
          </div>
          <div role="rowgroup">
            {sorted.slice(0, limit).map((file) => (
              <FileRow
                key={file.id}
                file={file}
                parentName={
                  allIndex.byId.get(file.parentId || '')?.name ||
                  file.path.slice(0, file.path.lastIndexOf('/')).split('/').pop() ||
                  'Internal storage'
                }
                isTrash={isTrash}
                {...actions}
              />
            ))}
          </div>
        </div>
      )}
      {pagination && pagination.total > pagination.pageSize && (
        <nav className="file-pagination" aria-label="File pages">
          <span>
            {pagination.page * pagination.pageSize + 1}–
            {Math.min((pagination.page + 1) * pagination.pageSize, pagination.total)} of{' '}
            {pagination.total}
          </span>
          <IconButton
            label="Previous files"
            disabled={pagination.page === 0 || pagination.loading}
            onClick={() => pagination.onPage(pagination.page - 1)}
          >
            <ChevronLeft size={19} />
          </IconButton>
          <IconButton
            label="Next files"
            disabled={
              (pagination.page + 1) * pagination.pageSize >= pagination.total || pagination.loading
            }
            onClick={() => pagination.onPage(pagination.page + 1)}
          >
            <ChevronRight size={19} />
          </IconButton>
        </nav>
      )}
      {!pagination && files.length > limit && (
        <button
          className="load-more secondary-button"
          onClick={() => setLimit((value) => value + 80)}
        >
          Show more ({files.length - limit} remaining)
        </button>
      )}
    </div>
  );
});
function FileRow({
  file,
  parentName,
  isTrash,
  ...actions
}: FileListActions & { file: FileItem; parentName: string; isTrash: boolean }) {
  const selected = actions.selected.has(file.id);
  const hold = useLongPress(() => actions.onSelect(file.id));
  return (
    <div
      role="row"
      className={`file-row ${selected ? 'selected' : ''}`}
      {...hold.handlers}
      onContextMenu={(event) => {
        event.preventDefault();
        actions.onMenu(file, event);
      }}
    >
      <div role="cell" className="file-name-cell">
        <button
          className={`file-select ${selected ? 'is-selected' : ''}`}
          aria-label={`${selected ? 'Deselect' : 'Select'} ${file.name}`}
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            actions.onSelect(file.id);
          }}
        >
          {selected ? <Check size={12} strokeWidth={2.5} /> : <span />}
        </button>
        <div
          className="file-open-area"
          role="button"
          tabIndex={0}
          aria-label={`${isTrash ? 'Select' : 'Open'} ${file.name}`}
          onClick={() => {
            if (hold.wasHeld.current) {
              hold.wasHeld.current = false;
              return;
            }
            if (isTrash || actions.selected.size) actions.onSelect(file.id);
            else actions.onOpen(file);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (isTrash) actions.onSelect(file.id);
              else actions.onOpen(file);
            }
            if (event.key === ' ') {
              event.preventDefault();
              actions.onSelect(file.id);
            }
          }}
        >
          <FileIcon file={file} />
          <div className="file-name-copy">
            <span className="file-name">
              {file.name}
              {file.favorite && <Star className="inline-favorite" size={11} fill="currentColor" />}
            </span>
            <span className="mobile-file-meta">
              {file.kind === 'folder' ? 'Folder' : formatBytes(file.size)}
              <span>·</span>
              {relativeDate(isTrash ? file.trashedAt! : file.modifiedAt)}
            </span>
          </div>
        </div>
      </div>
      <div role="cell" className="location-column">
        <span className="location-pill">{parentName}</span>
      </div>
      <div role="cell" className="modified-column">
        {relativeDate(isTrash ? file.trashedAt! : file.modifiedAt)}
      </div>
      <div role="cell" className="size-column">
        {file.kind === 'folder' ? '—' : formatBytes(file.size)}
      </div>
      <div role="cell" className="file-more-cell">
        <IconButton
          label={`Actions for ${file.name}`}
          onClick={(event) => {
            event.stopPropagation();
            actions.onMenu(file, event);
          }}
        >
          <MoreHorizontal size={19} />
        </IconButton>
      </div>
    </div>
  );
}
function FileCard({ file, ...actions }: FileListActions & { file: FileItem }) {
  const selected = actions.selected.has(file.id);
  const hold = useLongPress(() => actions.onSelect(file.id));
  return (
    <div
      className={`file-grid-card surface-card ${selected ? 'selected' : ''}`}
      {...hold.handlers}
      onContextMenu={(event) => {
        event.preventDefault();
        actions.onMenu(file, event);
      }}
    >
      <div
        className={`file-card-preview ${file.category}`}
        role="button"
        tabIndex={0}
        aria-label={`Open ${file.name}`}
        onClick={() => {
          if (hold.wasHeld.current) {
            hold.wasHeld.current = false;
            return;
          }
          if (actions.selected.size || file.trashedAt) actions.onSelect(file.id);
          else actions.onOpen(file);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') actions.onOpen(file);
          if (event.key === ' ') {
            event.preventDefault();
            actions.onSelect(file.id);
          }
        }}
      >
        {file.category === 'images' && file.previewUrl ? (
          <img src={file.previewUrl} alt={file.name} loading="lazy" decoding="async" />
        ) : (
          <FileIcon file={file} large />
        )}
      </div>
      <IconButton
        className={`grid-select ${selected ? 'is-selected' : ''}`}
        label={`${selected ? 'Deselect' : 'Select'} ${file.name}`}
        onClick={() => actions.onSelect(file.id)}
      >
        {selected ? <Check size={16} /> : <CheckCheck size={16} />}
      </IconButton>
      <div className="file-card-bottom">
        <div>
          <strong title={file.name}>{file.name}</strong>
          <span>
            {file.kind === 'folder' ? 'Folder' : formatBytes(file.size)}
            <span>·</span>
            {relativeDate(file.modifiedAt)}
          </span>
        </div>
        <IconButton
          label={`Actions for ${file.name}`}
          onClick={(event) => actions.onMenu(file, event)}
        >
          <MoreHorizontal size={19} />
        </IconButton>
      </div>
    </div>
  );
}
