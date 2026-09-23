import { useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, FolderPlus, Info, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
import type { FileItem } from '../lib/types';
import { useWorkspace } from '../lib/workspace';
import { formatBytes, errorMessage } from '../lib/utils';
import { repository } from '../lib/native-repository';
import { FileIcon, Modal, ModalHeader } from './ui';

export function NameDialog({
  file,
  parentId,
  onClose,
}: {
  file?: FileItem;
  parentId: string;
  onClose: () => void;
}) {
  const { run } = useWorkspace();
  const [name, setName] = useState(file?.name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const success = await run(
      file ? 'Renaming your file' : 'Making a little space',
      async () => {
        try {
          if (file) await repository.rename(file.id, name);
          else await repository.createFolder(name, parentId);
        } catch (error) {
          setError(errorMessage(error));
          throw error;
        }
      },
      file ? 'A new name. Same good stuff.' : 'Your new folder is ready.',
    );
    setBusy(false);
    if (success) onClose();
  }
  return (
    <Modal label={file ? 'Rename item' : 'New folder'} onClose={onClose} className="name-modal">
      <ModalHeader
        title={file ? 'A new name.' : 'Room for something new.'}
        subtitle={
          file ? 'Keep it clear. Make it yours.' : 'Give your new folder a little identity.'
        }
        icon={
          <div className="dialog-hero-icon">
            {file ? <Pencil size={25} /> : <FolderPlus size={27} />}
          </div>
        }
        onClose={onClose}
      />
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="folder-name">
          {file ? 'Name' : 'Folder name'}
        </label>
        <input
          id="folder-name"
          className="text-input"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. A new adventure"
          maxLength={240}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Not now
          </button>
          <button className="primary-button" type="submit" disabled={!name.trim() || busy}>
            {busy ? 'One moment…' : file ? 'Save name' : 'Create folder'}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function DeleteDialog({
  items,
  permanent,
  onConfirm,
  onClose,
}: {
  items: FileItem[];
  permanent: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      label={permanent ? 'Permanently delete files' : 'Move files to Trash'}
      onClose={() => {
        if (!busy) onClose();
      }}
      className="confirm-modal"
    >
      <ModalHeader
        title={permanent ? 'Let these go for good?' : 'Time for a little less?'}
        subtitle={
          permanent
            ? 'This is permanent. These files cannot be recovered.'
            : 'Move these items to Trash. You can bring them back anytime.'
        }
        icon={
          <div className="dialog-hero-icon danger">
            <Trash2 size={26} />
          </div>
        }
        onClose={() => {
          if (!busy) onClose();
        }}
      />
      <div className="confirm-files">
        {items.slice(0, 3).map((file) => (
          <div key={file.id}>
            <FileIcon file={file} />
            <span>{file.name}</span>
            <small>{file.kind === 'folder' ? 'Folder & contents' : formatBytes(file.size)}</small>
          </div>
        ))}
        {items.length > 3 && (
          <p>
            And {items.length - 3} more {items.length - 3 === 1 ? 'item' : 'items'}.
          </p>
        )}
      </div>
      <div className="safety-note">
        <ShieldCheck size={16} />
        <span>
          {permanent ? 'No files change until you confirm.' : 'Nothing is permanently deleted.'}
        </span>
      </div>
      <div className="modal-footer">
        <button className="secondary-button" disabled={busy} onClick={onClose}>
          Keep them
        </button>
        <button
          className="danger-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? 'Working…'
            : permanent
              ? 'Delete permanently'
              : `Move ${items.length === 1 ? 'item' : `${items.length} items`} to Trash`}
          <Trash2 size={16} />
        </button>
      </div>
    </Modal>
  );
}
export function InfoDialog({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const { files } = useWorkspace();
  const count = files.filter((item) => item.parentId === file.id && !item.trashedAt).length;
  return (
    <Modal label="File information" onClose={onClose} className="info-modal">
      <ModalHeader
        title="The little details."
        onClose={onClose}
        icon={
          <div className="dialog-hero-icon">
            <Info size={26} />
          </div>
        }
      />
      <div className="info-file">
        <FileIcon file={file} large />
        <h3>{file.name}</h3>
      </div>
      <dl className="detail-list">
        <div>
          <dt>Kind</dt>
          <dd>
            {file.kind === 'folder'
              ? 'Folder'
              : `${file.extension.toUpperCase() || 'Unknown'} file`}
          </dd>
        </div>
        <div>
          <dt>{file.kind === 'folder' ? 'Contents' : 'Size'}</dt>
          <dd>
            {file.kind === 'folder'
              ? `${count} items`
              : `${formatBytes(file.size)} (${file.size.toLocaleString()} bytes)`}
          </dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd className="break-path">{file.path}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{new Date(file.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Modified</dt>
          <dd>{new Date(file.modifiedAt).toLocaleString()}</dd>
        </div>
        {file.width && (
          <div>
            <dt>Dimensions</dt>
            <dd>
              {file.width} × {file.height}
            </dd>
          </div>
        )}
        {file.fingerprint && (
          <div>
            <dt>Integrity</dt>
            <dd>
              SHA-256 verified
              <Check size={13} />
            </dd>
          </div>
        )}
      </dl>
      <div className="modal-footer">
        <button className="primary-button" onClick={onClose}>
          Good to know
          <ArrowUpRight size={16} />
        </button>
      </div>
    </Modal>
  );
}
