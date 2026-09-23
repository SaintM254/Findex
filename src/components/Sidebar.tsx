import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Clock3,
  FolderClosed,
  HardDrive,
  LayoutGrid,
  PanelLeftClose,
  Settings2,
  ShieldCheck,
  Star,
  Trash2,
} from 'lucide-react';
import type { Location } from '../lib/types';
import { useWorkspace } from '../lib/workspace';
import { IconButton, Logo, WaveMark } from './ui';

interface Props {
  location: Location;
  navigate: (location: Location) => void;
  assistant: () => void;
  settings: () => void;
  mobileOpen: boolean;
  closeMobile: () => void;
}
export function Sidebar({
  location,
  navigate,
  assistant,
  settings,
  mobileOpen,
  closeMobile,
}: Props) {
  const { files, storage } = useWorkspace();
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const aside = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!compact) {
      if (mobileOpen) closeMobile();
      return;
    }
    if (mobileOpen) {
      returnFocus.current = document.activeElement as HTMLElement;
      aside.current?.querySelector<HTMLButtonElement>('.sidebar-close')?.focus();
    } else {
      returnFocus.current?.focus();
      returnFocus.current = null;
    }
  }, [compact, mobileOpen]);
  const trashCount = files.filter(
    (file) =>
      file.trashedAt && !files.some((parent) => parent.id === file.parentId && parent.trashedAt),
  ).length;
  const nav = [
    { page: 'overview', name: 'Overview', icon: LayoutGrid },
    { page: 'all', name: 'All files', icon: FolderClosed },
    { page: 'recent', name: 'Recents', icon: Clock3 },
    { page: 'favorites', name: 'Favorites', icon: Star },
    { page: 'trash', name: 'Trash', icon: Trash2 },
  ] as const;
  const go = (next: Location) => {
    navigate(next);
    closeMobile();
  };
  return (
    <>
      {mobileOpen && (
        <button className="sidebar-scrim" aria-label="Close navigation" onClick={closeMobile} />
      )}
      <aside
        ref={aside}
        inert={compact && !mobileOpen ? true : undefined}
        className={`sidebar ${mobileOpen ? 'is-open' : ''}`}
      >
        <div className="sidebar-brand">
          <button
            className="brand-button"
            aria-label="Findex overview"
            onClick={() => go({ page: 'overview' })}
          >
            <Logo />
          </button>
          <IconButton className="sidebar-close" label="Close navigation" onClick={closeMobile}>
            <PanelLeftClose size={20} />
          </IconButton>
        </div>
        <div className="sidebar-scroll">
          <div className="nav-section-label">WORKSPACE</div>
          <nav aria-label="Workspace navigation" className="primary-nav">
            {nav.map(({ page, name, icon: Icon }) => (
              <button
                key={page}
                aria-label={name}
                className={`nav-item ${location.page === page ? 'active' : ''}`}
                onClick={() => go({ page })}
                aria-current={location.page === page ? 'page' : undefined}
              >
                <Icon size={19} strokeWidth={1.7} />
                <span>{name}</span>
                {page === 'trash' && trashCount > 0 && (
                  <span className="nav-count">{trashCount}</span>
                )}
                {page === 'overview' && <span className="active-dot" />}
              </button>
            ))}
          </nav>
          <button
            className="nav-item assistant-nav"
            onClick={() => {
              assistant();
              closeMobile();
            }}
          >
            <WaveMark />
            <span>Findex assistant</span>
            <ArrowUpRight size={15} />
          </button>
          <div className="nav-section-label collections-label">COLLECTIONS</div>
          <nav aria-label="Collections" className="collection-nav">
            {files
              .filter((file) => file.kind === 'folder' && file.pinned && !file.trashedAt)
              .sort(
                (a, b) =>
                  ['sage', 'sand', 'lavender', 'blue'].indexOf(a.color || 'sage') -
                  ['sage', 'sand', 'lavender', 'blue'].indexOf(b.color || 'sage'),
              )
              .slice(0, 4)
              .map((file) => (
                <button
                  key={file.id}
                  className={`nav-item ${location.page === 'folder' && location.id === file.id ? 'active' : ''}`}
                  onClick={() => go({ page: 'folder', id: file.id, title: file.name })}
                >
                  <span className={`collection-dot ${file.color || 'sage'}`} />
                  <span>{file.name}</span>
                </button>
              ))}
            {!files.some((file) => file.pinned) && (
              <span className="sidebar-note">Favorite a folder to keep it close.</span>
            )}
          </nav>
          <div className="nav-section-label locations-label">ON THIS DEVICE</div>
          <button
            className={`nav-item location-nav ${location.page === 'all' ? 'location-active' : ''}`}
            onClick={() => go({ page: 'all' })}
          >
            <HardDrive size={19} strokeWidth={1.6} />
            <span>{storage.isDemo ? 'Internal storage' : 'Device storage'}</span>
            <span className="device-status" />
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-assistant-card">
            <div className="mini-wave">
              <WaveMark />
              <span>A little breathing room.</span>
            </div>
            <p>
              Less clutter.
              <br />
              More of what matters.
            </p>
            <button onClick={assistant}>
              Let’s tidy up <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="workspace-status">
            <ShieldCheck size={14} />
            <span>{storage.isDemo ? 'Preview workspace' : 'Local. Private. Yours.'}</span>
            <span className="status-dot" />
          </div>
          <div className="sidebar-profile">
            <div className="profile-avatar">
              <span>f.</span>
            </div>
            <div>
              <strong>Your workspace</strong>
              <span>Make yourself at home</span>
            </div>
            <IconButton label="Open settings" onClick={settings}>
              <Settings2 size={18} />
            </IconButton>
          </div>
        </div>
      </aside>
    </>
  );
}
