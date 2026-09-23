import { useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  Check,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  LockKeyhole,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { repository } from '../lib/native-repository';
import { useWorkspace } from '../lib/workspace';
import { DEFAULT_MODELS } from '../lib/utils';
import type { Preferences, Provider } from '../lib/types';
import { IconButton, Modal, ModalHeader, WaveMark } from './ui';

export function Settings({ onClose }: { onClose: () => void }) {
  const { preferences, files, storage, permission, run, notify } = useWorkspace();
  const [draft, setDraft] = useState<Preferences>({ ...preferences });
  const [tab, setTab] = useState<'general' | 'intelligence' | 'privacy'>('general');
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const changeProvider = (provider: Provider) => {
    setDraft({ ...draft, provider, model: DEFAULT_MODELS[provider], hasKey: false });
    setKey('');
    setClearKey(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (draft.metadataConsent && !(key.trim() || (draft.hasKey && !clearKey))) {
      notify('Add an API key before enabling connected intelligence.', 'info');
      setTab('intelligence');
      return;
    }
    if (!draft.model.trim()) {
      notify('Please enter a model name.', 'info');
      return;
    }
    setSaving(true);
    const success = await run(
      'Saving your preferences',
      () => repository.savePreferences(draft, key.trim() || (clearKey ? '' : undefined)),
      'A little more you. Preferences saved.',
    );
    setSaving(false);
    if (success) onClose();
  };
  return (
    <Modal label="Settings" onClose={onClose} className="settings-modal">
      <ModalHeader
        title="Make it yours."
        subtitle="A few thoughtful preferences for your everyday."
        onClose={onClose}
      />
      <div className="settings-tabs" role="tablist">
        {(['general', 'intelligence', 'privacy'] as const).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? 'active' : ''}
            onClick={() => setTab(item)}
          >
            {item === 'intelligence' && <WaveMark />}
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      <form onSubmit={save}>
        <div className="settings-body">
          {tab === 'general' && (
            <>
              <section className="settings-section">
                <h3>A different light</h3>
                <p>Set the mood, or follow your device.</p>
                <div className="theme-options">
                  {(
                    [
                      { id: 'light', name: 'Light', icon: Sun },
                      { id: 'dark', name: 'Dark', icon: Moon },
                      { id: 'system', name: 'System', icon: Monitor },
                    ] as const
                  ).map(({ id, name, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className={`theme-option ${draft.theme === id ? 'active' : ''}`}
                      onClick={() => setDraft({ ...draft, theme: id })}
                      aria-pressed={draft.theme === id}
                    >
                      <Icon size={18} />
                      <span>{name}</span>
                      {draft.theme === id && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </section>
              <section className="settings-section">
                <Toggle
                  label="Show hidden files"
                  description="Include files and folders beginning with a dot."
                  checked={draft.showHidden}
                  onChange={(value) => setDraft({ ...draft, showHidden: value })}
                />
              </section>
              <section className="settings-section">
                <div className="settings-row">
                  <div className="settings-row-icon">
                    <Database size={21} />
                  </div>
                  <div>
                    <h3>A quietly up-to-date index</h3>
                    <p>
                      {files.filter((file) => !file.trashedAt).length} items indexed on this device.
                    </p>
                  </div>
                  <IconButton
                    label="Refresh file index"
                    onClick={() =>
                      run(
                        'Refreshing your index',
                        (progress) => repository.reindex(progress),
                        'Your local index is up to date.',
                      )
                    }
                  >
                    <RefreshCw size={18} />
                  </IconButton>
                </div>
                <p className="settings-fineprint">
                  {repository.native
                    ? 'Indexed in the background using WorkManager. Android-protected app directories are not accessible.'
                    : 'Search and storage analysis run locally. Refreshing records a baseline for directory growth.'}
                </p>
              </section>
              <div className="settings-notice">
                <HardDrive size={20} />
                <div>
                  <strong>
                    {storage.isDemo
                      ? 'A preview, not your device storage'
                      : permission
                        ? 'Your storage is connected'
                        : 'Storage access is needed'}
                  </strong>
                  <p>
                    {storage.isDemo
                      ? 'Explore with real sample files or import your own. Changes are saved only in this browser. Install the Android app for full device access.'
                      : permission
                        ? 'Findex can manage shared internal storage. Private app data and protected system folders remain inaccessible.'
                        : 'Allow all-files access to browse and manage shared storage.'}
                  </p>
                  {!permission && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        repository
                          .requestPermission()
                          .catch(() => notify('Could not open Android storage settings.', 'error'))
                      }
                    >
                      Allow storage access
                      <ArrowUpRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
          {tab === 'intelligence' && (
            <>
              <div className="intelligence-intro">
                <div className="dialog-hero-icon">
                  <WaveMark />
                </div>
                <div>
                  <h3>Your intelligence. Your choice.</h3>
                  <p>
                    Local search and organization always work without a key. Connect a provider for
                    more flexible requests.
                  </p>
                </div>
              </div>
              <label className="field-label">AI provider</label>
              <div className="provider-options">
                {(['openai', 'anthropic', 'gemini'] as const).map((provider) => (
                  <button
                    type="button"
                    className={draft.provider === provider ? 'active' : ''}
                    key={provider}
                    onClick={() => changeProvider(provider)}
                  >
                    {provider === 'openai'
                      ? 'OpenAI'
                      : provider === 'anthropic'
                        ? 'Anthropic'
                        : 'Gemini'}
                    {draft.provider === provider && <Check size={13} />}
                  </button>
                ))}
              </div>
              <label className="field-label" htmlFor="model-name">
                Model
              </label>
              <input
                id="model-name"
                className="text-input"
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                placeholder={DEFAULT_MODELS[draft.provider]}
                autoComplete="off"
              />
              <label className="field-label" htmlFor="api-key">
                Your API key
                {draft.hasKey && !clearKey && (
                  <span className="key-saved">
                    <Check size={12} />
                    Key saved
                  </span>
                )}
              </label>
              <div className="password-field">
                <KeyRound size={17} />
                <input
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  value={key}
                  onChange={(event) => {
                    setKey(event.target.value);
                    setClearKey(false);
                  }}
                  placeholder={
                    draft.hasKey && !clearKey
                      ? 'Leave blank to keep your saved key'
                      : 'Paste your personal API key'
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <IconButton
                  label={showKey ? 'Hide API key' : 'Show API key'}
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                </IconButton>
              </div>
              <div className="key-help">
                <LockKeyhole size={13} />
                <span>
                  {repository.native
                    ? 'Encrypted with Android Keystore. Never stored in the file index.'
                    : 'Kept in memory for this tab only. Never saved to browser storage.'}
                </span>
              </div>
              {draft.hasKey && !clearKey && (
                <button
                  type="button"
                  className="text-button danger-text remove-key"
                  onClick={() => {
                    setClearKey(true);
                    setKey('');
                    setDraft({ ...draft, hasKey: false, metadataConsent: false });
                  }}
                >
                  Remove saved key
                </button>
              )}
              <section className="settings-section consent-section">
                <Toggle
                  label="Allow metadata sharing"
                  description="Send your request and up to 500 indexed filenames, types, sizes, and dates to your chosen provider. File contents and hashes are not sent. Your key is used only to authenticate with that provider."
                  checked={draft.metadataConsent}
                  onChange={(value) => setDraft({ ...draft, metadataConsent: value })}
                />
              </section>
              <div className="safety-note">
                <ShieldCheck size={16} />
                <span>
                  Every file action is checked locally and reviewed by you. Your provider’s usage
                  charges and data policies apply.
                </span>
              </div>
            </>
          )}
          {tab === 'privacy' && (
            <>
              <div className="privacy-hero">
                <ShieldCheck size={35} strokeWidth={1.4} />
                <h3>Yours stays yours.</h3>
                <p>
                  Your files do not need to leave home
                  <br />
                  to feel a little more organized.
                </p>
              </div>
              <div className="privacy-point">
                <span>01</span>
                <div>
                  <h3>Local by default</h3>
                  <p>
                    Metadata, hashes, and text snippets stay in the local index. No account,
                    tracking, or cloud backup is built in.
                  </p>
                </div>
              </div>
              <div className="privacy-point">
                <span>02</span>
                <div>
                  <h3>Permission, not assumption</h3>
                  <p>
                    Connected AI is opt-in. It receives a limited metadata snapshot only when you
                    send a request. Your provider’s data policies apply.
                  </p>
                </div>
              </div>
              <div className="privacy-point">
                <span>03</span>
                <div>
                  <h3>A chance to reconsider</h3>
                  <p>
                    Cleanup goes to Trash first. Permanent deletion asks again. Copy and move never
                    silently overwrite an existing file.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="settings-footer">
          <span>
            Findex <span className="version-pill">1.0</span>
          </span>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? 'Saving…' : 'Save preferences'}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="setting-toggle">
      <div>
        <h3>{label}</h3>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className={`toggle ${checked ? 'on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}
