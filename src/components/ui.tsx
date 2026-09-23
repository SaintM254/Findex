import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  AudioLines,
  File,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Image,
  X,
} from 'lucide-react';
import type { Category, FileItem, FolderColor } from '../lib/types';

export function IconButton({
  label,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? 'small' : ''}`}>
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <rect width="40" height="40" rx="12" fill="currentColor" />
        <path d="M10 14a3 3 0 0 1 3-3h6l4 4h7v15H13a3 3 0 0 1-3-3V14Z" fill="#dbeac6" />
        <path d="M16 20h13v3H19v4h-3v-7Z" fill="#2b503b" />
      </svg>
      {!small && (
        <span>
          findex<span className="logo-dot">.</span>
        </span>
      )}
    </div>
  );
}
export function WaveMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`wave-mark ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
    </svg>
  );
}
export function FolderGlyph({ color = 'sage' }: { color?: FolderColor }) {
  return (
    <svg className={`folder-glyph ${color}`} viewBox="0 0 64 52" fill="none" aria-hidden="true">
      <path
        className="folder-back"
        d="M4 10a6 6 0 0 1 6-6h15l7 7h21a6 6 0 0 1 6 6v24a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V10Z"
      />
      <path className="folder-paper" d="M14 15a3 3 0 0 1 3-3h29a3 3 0 0 1 3 3v26H14V15Z" />
      <path
        className="folder-front"
        d="M3 23a6 6 0 0 1 6-6h47a5 5 0 0 1 5 6l-3 20a6 6 0 0 1-6 5H10a6 6 0 0 1-6-5L3 23Z"
      />
      <path
        d="M9 19h46"
        stroke="white"
        strokeOpacity=".3"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
export const categoryIcons = {
  images: Image,
  videos: Film,
  audio: AudioLines,
  documents: FileText,
  archives: Archive,
  other: Folder,
};
export function CategoryIcon({ category, size = 22 }: { category: Category; size?: number }) {
  const Icon = categoryIcons[category];
  return <Icon size={size} strokeWidth={1.65} />;
}
export function FileIcon({ file, large = false }: { file: FileItem; large?: boolean }) {
  if (file.kind === 'folder')
    return (
      <div aria-hidden="true" className={`file-icon folder-icon ${large ? 'large' : ''}`}>
        <FolderGlyph color={file.color || 'sage'} />
      </div>
    );
  if (file.previewUrl && file.category === 'images')
    return (
      <div aria-hidden="true" className={`file-icon image-thumbnail ${large ? 'large' : ''}`}>
        <img src={file.previewUrl} alt="" loading="lazy" />
      </div>
    );
  const Icon =
    file.extension === 'csv' || file.extension === 'xlsx'
      ? FileSpreadsheet
      : file.extension === 'json'
        ? FileCode2
        : file.category === 'other'
          ? File
          : categoryIcons[file.category];
  return (
    <div
      aria-hidden="true"
      className={`file-icon ${file.category} ${large ? 'large' : ''} ${file.extension === 'pdf' ? 'pdf-icon' : ''}`}
    >
      <Icon size={large ? 34 : 21} strokeWidth={1.55} />
      {file.extension === 'pdf' && <span>PDF</span>}
    </div>
  );
}
export function Modal({
  children,
  onClose,
  label,
  className = '',
}: {
  children: ReactNode;
  onClose: () => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    const timer = setTimeout(() => {
      const target = element?.querySelector<HTMLElement>(
        '[autofocus],input,button,select,textarea,[tabindex="0"]',
      );
      target?.focus();
    }, 40);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
      if (event.key === 'Tab' && element) {
        const focusable = [
          ...element.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]',
          ),
          ...document.querySelectorAll<HTMLElement>(
            '.toast button:not([disabled]), .operation-progress button:not([disabled])',
          ),
        ].filter((item) => item.offsetParent !== null);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', keydown, true);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className={`modal-backdrop ${className.includes('drawer') ? 'drawer-backdrop' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`modal glass ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function ModalHeader({
  title,
  subtitle,
  onClose,
  icon,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  icon?: ReactNode;
}) {
  return (
    <div className="modal-header">
      <div>
        {icon}
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <IconButton label="Close" onClick={onClose}>
        <X size={20} />
      </IconButton>
    </div>
  );
}
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon || <Folder size={30} strokeWidth={1.2} />}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
