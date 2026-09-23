import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Eye,
  HardDrive,
  Info,
  LoaderCircle,
  Menu,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Scissors,
  Search,
  ShieldCheck,
  Star,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Overview } from './components/Overview';
import { FileList } from './components/FileList';
import { DeleteDialog, InfoDialog, NameDialog } from './components/Dialogs';
import { Settings } from './components/Settings';
import { Assistant } from './components/Assistant';
import { Viewer } from './components/Viewer';
import { EmptyState, FileIcon, IconButton, Logo } from './components/ui';
import { repository, FindexNative } from './lib/native-repository';
import { useWorkspace } from './lib/workspace';
import { useNativeListing } from './lib/use-native-listing';
import { indexFiles } from './lib/file-index';
import { errorMessage } from './lib/utils';
import type { Category, Clipboard, FileItem, Location, FileSort } from './lib/types';

export default function App() {
  const {
    files: workspaceFiles,
    revision,
    summary,
    storage,
    preferences,
    permission,
    loading,
    error,
    progress,
    toast,
    run,
    refresh,
    notify,
    clearToast,
  } = useWorkspace();
  const [location, setLocation] = useState<Location>({
    page: repository.native ? 'all' : 'overview',
  });
  const [search, setSearch] = useState('');
  const [searchIds, setSearchIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [filePage, setFilePage] = useState(0);
  const [fileSort, setFileSort] = useState<FileSort>('name');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assistantState, setAssistantState] = useState<{ prompt?: string } | null>(null);
  const [nameDialog, setNameDialog] = useState<{ file?: FileItem } | null>(null);
  const [deleteItems, setDeleteItems] = useState<FileItem[] | null>(null);
  const [infoFile, setInfoFile] = useState<FileItem | null>(null);
  const [viewerFile, setViewerFile] = useState<FileItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{ file: FileItem; x: number; y: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchWorker = useRef<Worker | null>(null);
  const searchSequence = useRef(0);
  const nativePage = useNativeListing(
    {
      section: location.page,
      id: location.id,
      search,
      sort: fileSort,
      page: filePage,
      pageSize: 80,
      showHidden: preferences.showHidden,
    },
    repository.native && !loading && permission && location.page !== 'overview',
    revision,
  );
  const files = useMemo(
    () =>
      repository.native
        ? [
            ...new Map(
              [...workspaceFiles, ...nativePage.ancestors, ...nativePage.files].map((file) => [
                file.id,
                file,
              ]),
            ).values(),
          ]
        : workspaceFiles,
    [workspaceFiles, nativePage.ancestors, nativePage.files],
  );
  const fileIndex = useMemo(() => indexFiles(files), [files]);
  const currentFolder = location.page === 'folder' ? location.id! : storage.rootId;
  const toastElement = useRef<HTMLDivElement>(null);
  const progressElement = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const update = () => {
      const toastHeight = toastElement.current?.offsetHeight || 0;
      const progressHeight = progressElement.current?.offsetHeight || 0;
      document.documentElement.style.setProperty('--toast-height', `${toastHeight}px`);
      document.documentElement.style.setProperty(
        '--feedback-clearance',
        `${toastHeight + progressHeight + (toastHeight && progressHeight ? 52 : 40)}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (toastElement.current) observer.observe(toastElement.current);
    if (progressElement.current) observer.observe(progressElement.current);
    return () => observer.disconnect();
  }, [toast?.id, progress]);

  useEffect(() => {
    if (repository.native) return;
    const worker = new Worker(new URL('./lib/indexer.worker.ts', import.meta.url), {
      type: 'module',
    });
    searchWorker.current = worker;
    worker.onmessage = (event) => {
      if (event.data.id === searchSequence.current && Array.isArray(event.data.result))
        setSearchIds(event.data.result);
    };
    return () => {
      worker.terminate();
      searchWorker.current = null;
    };
  }, []);
  useEffect(() => {
    searchWorker.current?.postMessage({ id: -1, type: 'index', files });
  }, [files]);
  useEffect(() => {
    const id = ++searchSequence.current;
    const timer = setTimeout(
      () => searchWorker.current?.postMessage({ id, type: 'search', filter: { text: search } }),
      130,
    );
    return () => clearTimeout(timer);
  }, [search, files]);

  const live = useMemo(
    () =>
      fileIndex.live.filter(
        (file) =>
          preferences.showHidden || !file.path.split('/').some((part) => part.startsWith('.')),
      ),
    [fileIndex, preferences.showHidden],
  );
  const visible = useMemo(() => {
    if (repository.native && location.page !== 'overview') return nativePage.files;
    switch (location.page) {
      case 'all':
        return live.filter((file) => file.parentId === storage.rootId);
      case 'folder':
        return live.filter((file) => file.parentId === location.id);
      case 'recent':
        return live.filter((file) => file.kind === 'file');
      case 'favorites':
        return live.filter((file) => file.favorite);
      case 'trash':
        return fileIndex.trashRoots;
      case 'category':
        return live.filter(
          (file) => file.kind === 'file' && file.category === (location.id as Category),
        );
      case 'search': {
        const ids = new Set(searchIds);
        return live.filter((file) => ids.has(file.id));
      }
      default:
        return [...live]
          .filter((file) => file.kind === 'file')
          .sort((a, b) => b.modifiedAt - a.modifiedAt)
          .slice(0, 5);
    }
  }, [location, live, files, fileIndex, storage.rootId, searchIds, nativePage.files]);
  const navigate = useCallback((next: Location) => {
    setLocation(next);
    setFilePage(0);
    if (repository.native && (next.page === 'recent' || next.page === 'trash'))
      setFileSort('modified');
    setSelected(new Set());
    setSearch('');
    setContextMenu(null);
    setMobileOpen(false);
  }, []);
  const select = useCallback(
    (id: string) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const selectAll = useCallback(
    () =>
      setSelected((previous) =>
        visible.every((file) => previous.has(file.id))
          ? new Set()
          : new Set(visible.map((file) => file.id)),
      ),
    [visible],
  );
  const openFile = useCallback(
    (file: FileItem) => {
      if (file.trashedAt) {
        select(file.id);
        return;
      }
      if (file.kind === 'folder') navigate({ page: 'folder', id: file.id, title: file.name });
      else if (repository.native)
        repository.openNative(file).catch((error) => notify(errorMessage(error), 'error'));
      else setViewerFile(file);
    },
    [navigate, notify, select],
  );
  const menu = useCallback((file: FileItem, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      file,
      x: Math.max(
        12,
        Math.min(
          window.innerWidth - 296,
          event.type === 'contextmenu' ? event.clientX : rect.right - 280,
        ),
      ),
      y: Math.max(
        12,
        Math.min(
          window.innerHeight - 140,
          event.type === 'contextmenu' ? event.clientY : rect.bottom + 5,
        ),
      ),
    });
  }, []);
  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      if (!(event.target as HTMLElement).closest('.context-menu')) setContextMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
    };
  }, [contextMenu]);
  useEffect(() => {
    setSelected((previous) => {
      const ids = new Set([...previous].filter((id) => fileIndex.byId.has(id)));
      return ids.size === previous.size ? previous : ids;
    });
  }, [fileIndex]);

  function putClipboard(action: Clipboard['action'], ids = [...selected]) {
    const available = ids.filter((id) => live.some((file) => file.id === id));
    if (!available.length) return;
    setClipboard({ action, ids: available });
    setContextMenu(null);
    notify(
      `${available.length} ${available.length === 1 ? 'item' : 'items'} ready to ${action === 'move' ? 'move' : 'copy'}. Open a folder and paste.`,
      'info',
    );
  }
  async function paste() {
    if (!clipboard || location.page === 'trash') return;
    const success = await run(
      clipboard.action === 'copy' ? 'Copying your files' : 'Moving your files',
      (progress) =>
        repository.operate(
          { action: clipboard.action, ids: clipboard.ids, destination: currentFolder },
          progress,
        ),
      clipboard.action === 'copy'
        ? 'Copied, with a little care.'
        : 'Your files are in their new home.',
    );
    if (success) {
      if (clipboard.action === 'move') setClipboard(null);
      setSelected(new Set());
    }
  }
  function requestDelete(ids = [...selected]) {
    const targets = files.filter((file) => ids.includes(file.id));
    if (targets.length) {
      setDeleteItems(targets);
      setContextMenu(null);
    }
  }
  async function confirmDelete() {
    if (!deleteItems) return;
    const permanent = deleteItems.every((file) => file.trashedAt);
    const ids = deleteItems.map((file) => file.id);
    let undoIds = ids;
    const success = await run(
      permanent ? 'Letting these files go' : 'Moving your files to Trash',
      async (progress) => {
        const result = await repository.operate(
          { action: permanent ? 'delete' : 'trash', ids },
          progress,
        );
        if (result?.ids.length) undoIds = result.ids;
      },
    );
    if (success) {
      setDeleteItems(null);
      setSelected(new Set());
      if (permanent) notify('Permanently deleted. A little more space.');
      else
        notify('Moved to Trash. There’s still time to change your mind.', 'success', {
          label: 'Undo',
          run: () => {
            void run(
              'Bringing your files back',
              (progress) => repository.operate({ action: 'restore', ids: undoIds }, progress),
              'Right back where they belong.',
            );
          },
        });
    }
  }
  async function restore(ids = [...selected]) {
    const success = await run(
      'Bringing your files back',
      (progress) => repository.operate({ action: 'restore', ids }, progress),
      'Right back where they belong.',
    );
    if (success) {
      setSelected(new Set());
      setContextMenu(null);
    }
  }
  async function importFiles(incoming: File[]) {
    if (!incoming.length && !repository.native) return;
    await run(
      'Making room for your files',
      (progress) => repository.importFiles(incoming, currentFolder, progress),
      'New arrivals, all settled in.',
    );
  }
  const startImport = () => {
    if (repository.native) void importFiles([]);
    else uploadInput.current?.click();
  };
  const assistant = useCallback((prompt?: string) => setAssistantState({ prompt }), []);
  const showSettings = useCallback(() => setSettingsOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const toggleTheme = async () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      await repository.savePreferences({ ...preferences, theme });
      await refresh();
    } catch (error) {
      notify(errorMessage(error), 'error');
    }
  };

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInput.current?.focus();
        return;
      }
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))
        return;
      if (event.key === 'Escape') {
        setSelected(new Set());
        setContextMenu(null);
        setMobileOpen(false);
      }
      if (command && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
      }
      if (command && event.key.toLowerCase() === 'c' && selected.size) {
        event.preventDefault();
        putClipboard('copy');
      }
      if (command && event.key.toLowerCase() === 'x' && selected.size) {
        event.preventDefault();
        putClipboard('move');
      }
      if (command && event.key.toLowerCase() === 'v' && clipboard) {
        event.preventDefault();
        void paste();
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected.size) {
        event.preventDefault();
        requestDelete();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  });

  useEffect(() => {
    if (!repository.native) return;
    const back = () => {
      if (viewerFile) setViewerFile(null);
      else if (settingsOpen) setSettingsOpen(false);
      else if (assistantState) setAssistantState(null);
      else if (infoFile) setInfoFile(null);
      else if (nameDialog) setNameDialog(null);
      else if (deleteItems) setDeleteItems(null);
      else if (contextMenu) setContextMenu(null);
      else if (mobileOpen) setMobileOpen(false);
      else if (selected.size) setSelected(new Set());
      else if (location.page === 'folder') {
        const folder = files.find((file) => file.id === location.id);
        const parent = files.find((file) => file.id === folder?.parentId);
        navigate(parent ? { page: 'folder', id: parent.id, title: parent.name } : { page: 'all' });
      } else if (location.page !== 'overview') navigate({ page: 'overview' });
      else void FindexNative.exitApp();
    };
    window.addEventListener('findex-back', back);
    return () => window.removeEventListener('findex-back', back);
  }, [
    viewerFile,
    settingsOpen,
    assistantState,
    infoFile,
    nameDialog,
    deleteItems,
    contextMenu,
    mobileOpen,
    selected,
    location,
    files,
    navigate,
  ]);

  const pageTitle =
    location.page === 'overview'
      ? 'A home for everything.'
      : location.page === 'all'
        ? 'All your files.'
        : location.page === 'recent'
          ? 'The latest little things.'
          : location.page === 'favorites'
            ? 'The things you keep close.'
            : location.page === 'trash'
              ? 'A little less.'
              : location.page === 'search'
                ? search
                  ? `Looking for “${search}”`
                  : 'Find your next thing.'
                : location.title || 'Your files.';
  const pageName =
    location.page === 'overview'
      ? 'Overview'
      : location.page === 'all'
        ? 'All files'
        : location.page === 'recent'
          ? 'Recents'
          : location.page === 'favorites'
            ? 'Favorites'
            : location.page === 'trash'
              ? 'Trash'
              : location.page === 'search'
                ? 'Search'
                : location.title;
  const description =
    location.page === 'overview'
      ? 'Less searching. More of what matters.'
      : location.page === 'all'
        ? 'Big ideas, small details. All in one place.'
        : location.page === 'recent'
          ? 'Pick up right where you left off.'
          : location.page === 'favorites'
            ? 'Your favorites, never far away.'
            : location.page === 'trash'
              ? 'Not gone for good. Restore a file, or let it go.'
              : location.page === 'search'
                ? `${visible.length} ${visible.length === 1 ? 'match' : 'matches'} across your local workspace.`
                : 'A little space for the things that belong together.';
  const mediaSiblings = useMemo(
    () =>
      repository.native
        ? []
        : [...live]
            .filter((file) => file.kind === 'file')
            .sort((a, b) => b.modifiedAt - a.modifiedAt),
    [live],
  );
  const viewerIndex = viewerFile
    ? mediaSiblings.findIndex((file) => file.id === viewerFile.id)
    : -1;
  const parentFolder = location.page === 'folder' ? fileIndex.byId.get(location.id || '') : null;
  const actions = useMemo(
    () => ({ selected, onSelect: select, onOpen: openFile, onMenu: menu }),
    [selected, select, openFile, menu],
  );
  const changePage = useCallback((page: number) => {
    setFilePage(page);
    setSelected(new Set());
  }, []);
  const changeSort = useCallback((sort: FileSort) => {
    setFileSort(sort);
    setFilePage(0);
  }, []);
  if (loading && !repository.native)
    return (
      <div className="boot-screen">
        <Logo />
        <div className="boot-progress" />
        <p>Making a little room for you.</p>
      </div>
    );
  if (error)
    return (
      <div className="boot-screen">
        <Logo />
        <EmptyState
          title="Let’s try that again."
          description={error}
          action={
            <button className="primary-button" onClick={() => window.location.reload()}>
              Reload workspace
              <RotateCcw size={16} />
            </button>
          }
        />
      </div>
    );
  return (
    <div className="app-shell">
      <Sidebar
        location={location}
        navigate={navigate}
        assistant={assistant}
        settings={showSettings}
        mobileOpen={mobileOpen}
        closeMobile={closeMobile}
      />
      <main
        inert={mobileOpen ? true : undefined}
        className="main-shell"
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            dragDepth.current++;
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current--;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void importFiles([...event.dataTransfer.files]);
        }}
      >
        <header className="topbar">
          <div className="topbar-left">
            <IconButton
              label="Open navigation"
              className="mobile-menu-button"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </IconButton>
            <div className="breadcrumbs">
              <button onClick={() => navigate({ page: 'overview' })}>Workspace</button>
              <ChevronRight size={12} />
              {location.page === 'folder' && (
                <>
                  <button className="parent-breadcrumb" onClick={() => navigate({ page: 'all' })}>
                    Files
                  </button>
                  <ChevronRight className="parent-breadcrumb" size={12} />
                </>
              )}
              <span>{pageName}</span>
            </div>
          </div>
          <div className="topbar-right">
            <div className={`global-search ${search ? 'has-value' : ''}`}>
              <Search size={17} />
              <input
                ref={searchInput}
                aria-label="Search files"
                placeholder="Search your files"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setFilePage(0);
                  setSelected(new Set());
                  setLocation(
                    event.target.value
                      ? { page: 'search' }
                      : { page: repository.native ? 'all' : 'overview' },
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    navigate({ page: 'overview' });
                    searchInput.current?.blur();
                  }
                }}
              />
              {search ? (
                <IconButton label="Clear search" onClick={() => navigate({ page: 'overview' })}>
                  <X size={14} />
                </IconButton>
              ) : (
                <kbd>
                  <span>⌘</span> K
                </kbd>
              )}
            </div>
            <IconButton
              className="theme-toggle"
              label={
                document.documentElement.dataset.theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              onClick={toggleTheme}
            >
              {document.documentElement.dataset.theme === 'dark' ? (
                <Moon size={19} strokeWidth={1.7} />
              ) : (
                <Sun size={19} strokeWidth={1.7} />
              )}
            </IconButton>
            <button
              className="topbar-avatar"
              aria-label="Open preferences"
              title="Your preferences"
              onClick={() => setSettingsOpen(true)}
            >
              <span>a.</span>
            </button>
          </div>
        </header>
        <div
          className="main-scroll"
          key={location.page === 'search' ? 'search' : `${location.page}-${location.id || ''}`}
        >
          <div className="page-content">
            <div className="page-heading">
              <div className="page-heading-copy">
                <div className="eyebrow page-eyebrow">
                  {location.page === 'overview'
                    ? 'YOUR SPACE, SIMPLIFIED'
                    : 'A PLACE FOR EVERYTHING'}
                  {location.page === 'overview' && (
                    <>
                      <span className="eyebrow-divider" />
                      <span className="heading-date">
                        {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </>
                  )}
                </div>
                <div className="title-line">
                  {location.page === 'folder' && (
                    <IconButton
                      label="Go to parent folder"
                      className="back-button"
                      onClick={() => {
                        const parent = files.find((file) => file.id === parentFolder?.parentId);
                        navigate(
                          parent
                            ? { page: 'folder', id: parent.id, title: parent.name }
                            : { page: 'all' },
                        );
                      }}
                    >
                      <ArrowLeft size={22} />
                    </IconButton>
                  )}
                  <h1 title={pageTitle}>{pageTitle}</h1>
                </div>
                <p>{description}</p>
              </div>
              <div className="page-actions">
                {clipboard && location.page !== 'trash' && (
                  <IconButton
                    label={`Paste ${clipboard.ids.length} items`}
                    className="header-paste"
                    onClick={paste}
                    disabled={!!progress}
                  >
                    <ClipboardPaste size={19} />
                    <span className="clipboard-count">{clipboard.ids.length}</span>
                  </IconButton>
                )}
                {location.page === 'trash' ? (
                  <button
                    className="secondary-button"
                    disabled={!visible.length || !!progress}
                    onClick={() => requestDelete(visible.map((file) => file.id))}
                  >
                    <Trash2 size={17} />
                    {repository.native && nativePage.total > visible.length
                      ? 'Empty this page'
                      : 'Empty Trash'}
                  </button>
                ) : (
                  <>
                    <button
                      className="secondary-button new-folder-button"
                      onClick={() => setNameDialog({})}
                      disabled={loading || !permission}
                    >
                      <Plus size={17} />
                      <span>New folder</span>
                    </button>
                    <button
                      className="primary-button upload-button"
                      onClick={startImport}
                      disabled={loading || !permission}
                    >
                      <Upload size={16} />
                      <span>Add files</span>
                    </button>
                  </>
                )}
              </div>
            </div>
            {loading ? (
              <div className="listing-loading" role="status">
                <LoaderCircle className="spin" size={18} />
                <span>Opening local storage…</span>
              </div>
            ) : !permission ? (
              <div className="permission-card surface-card">
                <span className="permission-icon">
                  <HardDrive size={36} strokeWidth={1.2} />
                </span>
                <h2>Your files are just one step away.</h2>
                <p>
                  Give Findex access to shared storage so it can find, organize, and make room for
                  what matters. Your private app data stays private.
                </p>
                <button
                  className="primary-button"
                  onClick={() =>
                    repository
                      .requestPermission()
                      .catch((error) => notify(errorMessage(error), 'error'))
                  }
                >
                  Allow file access
                  <ArrowUpRight size={17} />
                </button>
                <span className="permission-note">
                  <ShieldCheck size={14} />
                  No account. No uploads. Just your files.
                </span>
              </div>
            ) : location.page === 'overview' ? (
              <Overview
                navigate={navigate}
                assistant={assistant}
                {...actions}
                view={view}
                setView={setView}
              />
            ) : (
              <div className="browse-content">
                {repository.native && nativePage.error ? (
                  <EmptyState
                    title="This folder could not be opened."
                    description={nativePage.error}
                    action={
                      <button className="secondary-button" onClick={() => nativePage.reload()}>
                        Try again
                      </button>
                    }
                  />
                ) : repository.native && nativePage.loading && !nativePage.files.length ? (
                  <div className="listing-loading" role="status">
                    <LoaderCircle className="spin" size={18} />
                    <span>Reading this folder…</span>
                  </div>
                ) : (
                  <FileList
                    key={`${location.page}-${location.id || ''}`}
                    files={visible}
                    allFiles={files}
                    {...actions}
                    view={view}
                    setView={setView}
                    isTrash={location.page === 'trash'}
                    pagination={
                      repository.native
                        ? {
                            page: filePage,
                            pageSize: 80,
                            total: nativePage.total,
                            onPage: changePage,
                            sort: fileSort,
                            onSort: changeSort,
                            loading: nativePage.loading,
                          }
                        : undefined
                    }
                  />
                )}
                {repository.native &&
                  summary?.indexing &&
                  !['all', 'folder'].includes(location.page) && (
                    <p className="index-note" role="status">
                      The local index is updating in the background. You can keep browsing folders.
                    </p>
                  )}
                {location.page === 'all' && (
                  <div className="browse-tip">
                    <span className="status-dot" />
                    <span>A long press selects a file. A little space keeps things simple.</span>
                    <button className="text-button" onClick={() => assistant()}>
                      Need a hand?
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {dragging && (
          <div className="drop-overlay glass">
            <div>
              <Upload size={43} strokeWidth={1.4} />
              <h2>Drop something good.</h2>
              <p>Your files will land in {parentFolder?.name || 'Internal storage'}.</p>
            </div>
          </div>
        )}
        <input
          className="sr-only"
          ref={uploadInput}
          type="file"
          multiple
          tabIndex={-1}
          aria-label="Import files"
          onChange={(event) => {
            void importFiles([...(event.target.files || [])]);
            event.target.value = '';
          }}
        />
      </main>
      {selected.size > 0 && (
        <div className="selection-bar glass" role="toolbar" aria-label="Selected file actions">
          <div className="selection-count">
            <span>{selected.size}</span>
            <span>selected</span>
          </div>
          <IconButton label="Clear selection" onClick={() => setSelected(new Set())}>
            <X size={16} />
          </IconButton>
          <span className="control-divider" />
          <IconButton
            label={
              repository.native && nativePage.total > visible.length
                ? 'Select this page'
                : 'Select all'
            }
            onClick={selectAll}
            disabled={!!progress}
          >
            <CheckCheck size={21} />
          </IconButton>
          {location.page === 'trash' ? (
            <IconButton
              label="Restore selected files"
              onClick={() => restore()}
              disabled={!!progress}
            >
              <RotateCcw size={20} />
            </IconButton>
          ) : (
            <>
              <IconButton
                label="Cut selected files"
                onClick={() => putClipboard('move')}
                disabled={!!progress}
              >
                <Scissors size={20} />
              </IconButton>
              <IconButton
                label="Copy selected files"
                onClick={() => putClipboard('copy')}
                disabled={!!progress}
              >
                <Copy size={20} />
              </IconButton>
              {clipboard && (
                <IconButton label="Paste files" onClick={paste} disabled={!!progress}>
                  <ClipboardPaste size={20} />
                </IconButton>
              )}
            </>
          )}
          <span className="control-divider" />
          <IconButton
            label={
              location.page === 'trash'
                ? 'Permanently delete selected files'
                : 'Move selected files to Trash'
            }
            className="danger-text"
            onClick={() => requestDelete()}
            disabled={!!progress}
          >
            <Trash2 size={20} />
          </IconButton>
        </div>
      )}
      {contextMenu && (
        <div
          className="context-menu glass"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="dialog"
          aria-label={`Actions for ${contextMenu.file.name}`}
        >
          <div className="context-menu-heading">
            <FileIcon file={contextMenu.file} />
            <span>{contextMenu.file.name}</span>
          </div>
          <div className="context-menu-actions" role="toolbar" aria-label="File actions">
            {contextMenu.file.trashedAt ? (
              <>
                <IconButton label="Restore file" onClick={() => restore([contextMenu.file.id])}>
                  <RotateCcw size={18} />
                </IconButton>
                <IconButton
                  label="Delete permanently"
                  className="danger-text"
                  onClick={() => requestDelete([contextMenu.file.id])}
                >
                  <Trash2 size={18} />
                </IconButton>
              </>
            ) : (
              <>
                <IconButton
                  label="Open file"
                  onClick={() => {
                    openFile(contextMenu.file);
                    setContextMenu(null);
                  }}
                >
                  <Eye size={18} />
                </IconButton>
                <IconButton
                  label="Rename"
                  onClick={() => {
                    setNameDialog({ file: contextMenu.file });
                    setContextMenu(null);
                  }}
                >
                  <Pencil size={17} />
                </IconButton>
                <IconButton
                  label={contextMenu.file.favorite ? 'Remove from favorites' : 'Add to favorites'}
                  className={contextMenu.file.favorite ? 'favorite-color' : ''}
                  onClick={() => {
                    const file = contextMenu.file;
                    setContextMenu(null);
                    void run(
                      'Updating your favorites',
                      () => repository.setFavorite(file.id, !file.favorite),
                      file.favorite
                        ? 'Removed from favorites.'
                        : 'A good thing, kept a little closer.',
                    );
                  }}
                >
                  <Star size={18} fill={contextMenu.file.favorite ? 'currentColor' : 'none'} />
                </IconButton>
                <IconButton label="Cut" onClick={() => putClipboard('move', [contextMenu.file.id])}>
                  <Scissors size={18} />
                </IconButton>
                <IconButton
                  label="Copy"
                  onClick={() => putClipboard('copy', [contextMenu.file.id])}
                >
                  <Copy size={18} />
                </IconButton>
                <IconButton
                  label="Move to Trash"
                  className="danger-text"
                  onClick={() => requestDelete([contextMenu.file.id])}
                >
                  <Trash2 size={18} />
                </IconButton>
              </>
            )}
            <IconButton
              label="File details"
              onClick={() => {
                setInfoFile(contextMenu.file);
                setContextMenu(null);
              }}
            >
              <Info size={18} />
            </IconButton>
          </div>
        </div>
      )}
      {progress && (
        <div ref={progressElement} className="operation-progress glass" role="status">
          <LoaderCircle size={19} className="spin" />
          <div>
            <strong>{progress.label}</strong>
            <div className="operation-meter">
              <span
                style={{
                  width: `${progress.total ? (progress.completed / progress.total) * 100 : 22}%`,
                }}
              />
            </div>
          </div>
          {progress.total > 0 && (
            <span>
              {progress.completed}/{progress.total}
            </span>
          )}
          {progress.cancellable && (
            <IconButton label="Cancel file operation" onClick={() => repository.cancelOperation()}>
              <X size={16} />
            </IconButton>
          )}
        </div>
      )}
      {toast && (
        <div
          ref={toastElement}
          className={`toast glass ${toast.tone}`}
          style={{
            bottom: `calc(${progress ? 188 : selected.size ? 100 : 24}px + var(--safe-bottom))`,
          }}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          <span className="toast-icon">
            {toast.tone === 'success' ? <Check size={16} /> : <Info size={16} />}
          </span>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                clearToast();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <IconButton label="Dismiss notification" onClick={clearToast}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {nameDialog && (
        <NameDialog
          file={nameDialog.file}
          parentId={currentFolder}
          onClose={() => setNameDialog(null)}
        />
      )}
      {deleteItems && (
        <DeleteDialog
          items={deleteItems}
          permanent={deleteItems.every((file) => !!file.trashedAt)}
          onClose={() => setDeleteItems(null)}
          onConfirm={confirmDelete}
        />
      )}
      {infoFile && <InfoDialog file={infoFile} onClose={() => setInfoFile(null)} />}
      {assistantState && (
        <Assistant
          initialPrompt={assistantState.prompt}
          onClose={() => setAssistantState(null)}
          openSettings={() => {
            setAssistantState(null);
            setSettingsOpen(true);
          }}
          onOpenFile={(file) => {
            setAssistantState(null);
            openFile(file);
          }}
        />
      )}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {viewerFile && (
        <Viewer
          key={viewerFile.id}
          file={viewerFile}
          onClose={() => setViewerFile(null)}
          onNavigate={(direction) => {
            const next = mediaSiblings[viewerIndex + direction];
            if (next) setViewerFile(next);
          }}
          canPrevious={viewerIndex > 0}
          canNext={viewerIndex < mediaSiblings.length - 1}
        />
      )}
    </div>
  );
}
