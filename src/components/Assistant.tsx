import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Files,
  FolderInput,
  FolderTree,
  HardDrive,
  LoaderCircle,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { repository } from '../lib/native-repository';
import { useWorkspace } from '../lib/workspace';
import { filesForPlan, organizePlan, planLocally, validateDestination } from '../lib/agent';
import { errorMessage, formatBytes, relativeDate } from '../lib/utils';
import type { AgentPlan, Analysis, FileItem } from '../lib/types';
import { EmptyState, FileIcon, IconButton, Modal, WaveMark } from './ui';

interface Props {
  initialPrompt?: string;
  onClose: () => void;
  openSettings: () => void;
  onOpenFile: (file: FileItem) => void;
}
export function Assistant({ initialPrompt, onClose, openSettings, onOpenFile }: Props) {
  const { files, preferences, storage, run, notify } = useWorkspace();
  const [query, setQuery] = useState('');
  const [sentQuery, setSentQuery] = useState('');
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cloud, setCloud] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState(false);
  const [working, setWorking] = useState(false);
  const initialRan = useRef(false);
  const snapshot = useRef<FileItem[]>([]);
  const [planFiles, setPlanFiles] = useState<FileItem[]>(files);
  const [reviewPage, setReviewPage] = useState(0);
  const [nativeResults, setNativeResults] = useState<FileItem[] | null>(null);
  const [matchTotal, setMatchTotal] = useState(0);
  const indexedById = useMemo(() => new Map(planFiles.map((file) => [file.id, file])), [planFiles]);
  const results = useMemo(
    () =>
      plan && (plan.kind === 'search' || plan.kind === 'move')
        ? (nativeResults ?? filesForPlan(plan, planFiles))
        : [],
    [plan, planFiles, nativeResults],
  );
  const moves = useMemo(
    () => (plan?.kind === 'organize' ? organizePlan(plan.sourceFolder!, planFiles) : []),
    [plan, planFiles],
  );
  const cleanup = useMemo(
    () =>
      analysis
        ? [
            ...analysis.cleanup,
            ...analysis.emptyFolders.filter((file) => !file.pinned && !file.favorite),
          ]
        : [],
    [analysis],
  );

  const reviewFiles = useMemo(
    () =>
      plan?.kind === 'organize'
        ? moves
            .map((move) => indexedById.get(move.id))
            .filter((file): file is FileItem => Boolean(file))
        : plan?.kind === 'move'
          ? results
          : cleanup,
    [plan, moves, indexedById, results, cleanup],
  );
  const moveById = useMemo(() => new Map(moves.map((move) => [move.id, move])), [moves]);

  async function ask(value: string) {
    if (!value.trim() || loading || working) return;
    setSentQuery(value);
    setQuery('');
    setLoading(true);
    setError('');
    setPlan(null);
    setAnalysis(null);
    setCompleted(false);
    setReviewPage(0);
    setNativeResults(null);
    setMatchTotal(0);
    try {
      const context = repository.planningContext
        ? await repository.planningContext()
        : (await repository.load()).files;
      const next = cloud ? await repository.askAgent(value, context) : planLocally(value, context);
      let reviewed = context;
      let matches: FileItem[] | null = null;
      let report: Analysis | null = null;
      if (next.kind === 'analyze' || next.kind === 'cleanup') {
        report = await repository.analyze();
        reviewed = repository.native
          ? [...report.cleanup, ...report.emptyFolders]
          : (await repository.load()).files;
        setMatchTotal(report.candidateCount || reviewed.length);
      } else if (repository.listFiles) {
        const page = await repository.listFiles(
          next.kind === 'organize'
            ? {
                section: 'folder',
                id: next.sourceFolder,
                filesOnly: true,
                pageSize: 500,
                sort: 'name',
                showHidden: true,
              }
            : {
                section: 'plan',
                filter: next.filter,
                pageSize: 500,
                sort: 'modified',
                showHidden: true,
              },
        );
        reviewed = [...context.filter((file) => file.id === next.sourceFolder), ...page.files];
        matches = page.files;
        setNativeResults(matches);
        setMatchTotal(page.total);
      }
      snapshot.current = reviewed;
      setPlanFiles(reviewed);
      setPlan(next);
      setAnalysis(report);
      if (next.kind === 'organize')
        setPicked(new Set(organizePlan(next.sourceFolder!, reviewed).map((move) => move.id)));
      if (next.kind === 'move')
        setPicked(new Set((matches || filesForPlan(next, reviewed)).map((file) => file.id)));
      if (next.kind === 'cleanup' && report)
        setPicked(
          new Set(
            [
              ...report.cleanup.filter((file) => !file.favorite),
              ...report.emptyFolders.filter((file) => !file.pinned && !file.favorite),
            ].map((file) => file.id),
          ),
        );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (initialPrompt && !initialRan.current) {
      initialRan.current = true;
      void ask(initialPrompt);
    }
  }, []); // Intentionally only run the opening prompt once.
  function toggle(id: string) {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function ensurePath(path: string, rootId: string) {
    if (repository.ensureFolderPath)
      return repository.ensureFolderPath(validateDestination(path), rootId);
    const segments = validateDestination(path).split('/');
    let parentId = rootId;
    for (const name of segments) {
      const latest = await repository.load();
      const found = latest.files.find(
        (file) => file.parentId === parentId && file.name === name && !file.trashedAt,
      );
      if (found && found.kind !== 'folder')
        throw new Error(`“${name}” is a file, not a folder. Choose another destination.`);
      parentId = found?.id || (await repository.createFolder(name, parentId));
    }
    return parentId;
  }
  async function confirm() {
    if (!plan || !picked.size || working) return;
    setWorking(true);
    const success = await run(
      'Putting your plan into motion',
      async (onProgress) => {
        const currentFiles = repository.inspectFiles
          ? await repository.inspectFiles([...picked])
          : (await repository.load()).files;
        const currentById = new Map(currentFiles.map((file) => [file.id, file]));
        for (const id of picked) {
          const before = indexedById.get(id);
          const current = currentById.get(id);
          if (
            !before ||
            !current ||
            current.trashedAt ||
            before.size !== current.size ||
            before.modifiedAt !== current.modifiedAt ||
            before.path !== current.path
          )
            throw new Error(
              'Some files changed since this review. Please run the request again before continuing.',
            );
        }
        if (plan.kind === 'cleanup')
          await repository.operate({ action: 'trash', ids: [...picked] }, onProgress);
        if (plan.kind === 'move') {
          const destination = await ensurePath(plan.destination!, storage.rootId);
          await repository.operate({ action: 'move', ids: [...picked], destination }, onProgress);
        }
        if (plan.kind === 'organize') {
          const groups = new Map<string, string[]>();
          for (const move of moves.filter((move) => picked.has(move.id)))
            groups.set(move.destination, [...(groups.get(move.destination) || []), move.id]);
          let done = 0;
          for (const [folder, ids] of groups) {
            const destination = await ensurePath(folder, plan.sourceFolder!);
            await repository.operate({ action: 'move', ids, destination }, (progress) =>
              onProgress({ ...progress, total: picked.size, completed: done + progress.completed }),
            );
            done += ids.length;
          }
        }
      },
      plan.kind === 'cleanup'
        ? 'A little lighter. Your files are safe in Trash.'
        : 'Everything, a little more in its place.',
    );
    setWorking(false);
    if (success) {
      setCompleted(true);
      setPicked(new Set());
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(query);
  };
  const suggestions = [
    {
      title: 'Find a little faster',
      text: 'Find the CV I edited last month',
      description: 'A filename is only the beginning.',
      icon: Search,
    },
    {
      title: 'Bring a little order',
      text: 'Organize my downloads',
      description: 'Turn a busy folder into a calm one.',
      icon: FolderTree,
    },
    {
      title: 'See the bigger picture',
      text: 'Analyze my storage',
      description: 'Know what is taking up space.',
      icon: HardDrive,
    },
    {
      title: 'Make a little room',
      text: 'Clean up safely',
      description: 'Spot duplicates and old leftovers.',
      icon: Trash2,
    },
  ];
  return (
    <Modal
      label="Findex assistant"
      onClose={() => {
        if (!working) onClose();
      }}
      className="assistant-drawer drawer"
    >
      <div className="assistant-topbar">
        <div className="assistant-brand">
          <span className="assistant-mark">
            <WaveMark />
          </span>
          <strong>Findex assistant</strong>
          <span className="assistant-beta">ON YOUR SIDE</span>
        </div>
        <IconButton label="Close assistant" onClick={onClose} disabled={working}>
          <X size={20} />
        </IconButton>
      </div>
      <div className="assistant-scroll">
        {!sentQuery ? (
          <>
            <div className="assistant-welcome">
              <span className="eyebrow">A LITTLE LESS HEAVY LIFTING</span>
              <h2>
                Your files.
                <br />A little more understood.
              </h2>
              <p>
                Find the hard-to-find. Sort the unsorted.
                <br />
                Make space for the good stuff.
              </p>
            </div>
            <div className="assistant-suggestions">
              {suggestions.map(({ title, text, description, icon: Icon }) => (
                <button key={title} onClick={() => ask(text)}>
                  <span className="suggestion-icon">
                    <Icon size={20} strokeWidth={1.65} />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </span>
                  <ArrowUp size={15} />
                </button>
              ))}
            </div>
            <div className="assistant-example">
              <span>TRY SOMETHING LIKE</span>
              <button onClick={() => ask('Move yesterday’s screenshots to Screenshots/September')}>
                “Move yesterday’s screenshots to
                <br />
                Screenshots/September”
                <ArrowUpRightIcon />
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              className="text-button assistant-back"
              onClick={() => {
                if (!working) {
                  setSentQuery('');
                  setPlan(null);
                  setError('');
                  setCompleted(false);
                }
              }}
            >
              <ChevronLeft size={14} />A fresh thought
            </button>
            <div className="query-bubble">{sentQuery}</div>
            {loading && (
              <div className="assistant-thinking">
                <WaveMark className="wave-pulse" />
                <span>
                  {cloud
                    ? 'Thinking with your chosen provider…'
                    : 'Taking a thoughtful look at your files…'}
                </span>
              </div>
            )}
            {error && (
              <div className="assistant-error" role="alert">
                <p>{error}</p>
                {cloud && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setCloud(false);
                      setSentQuery('');
                      setError('');
                    }}
                  >
                    Use on-device tools
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            )}
            {plan && (
              <div className="assistant-answer">
                <div className="answer-icon">
                  <WaveMark />
                </div>
                <h3>{completed ? 'A little more in its place.' : plan.title}</h3>
                {repository.native && matchTotal > 500 && (
                  <p className="index-note">
                    Showing up to 500 candidates from {matchTotal.toLocaleString()} matches. Only
                    the files in this review can be changed; repeat the request for the rest.
                  </p>
                )}
                <p className="answer-explanation">
                  {completed
                    ? 'Your plan is complete. You’re free to get back to the good stuff.'
                    : plan.explanation}
                </p>
                {completed ? (
                  <div className="plan-complete">
                    <Check size={30} />
                    <span>All taken care of.</span>
                  </div>
                ) : (
                  <>
                    {plan.kind === 'search' && (
                      <>
                        <div className="result-summary">
                          <Search size={14} />
                          {results.length} {results.length === 1 ? 'match' : 'matches'} in your
                          local index
                        </div>
                        {results.length ? (
                          <div className="assistant-file-results">
                            {results.slice(0, 50).map((file) => (
                              <button key={file.id} onClick={() => onOpenFile(file)}>
                                <FileIcon file={file} />
                                <span>
                                  <strong>{file.name}</strong>
                                  <small>
                                    {relativeDate(file.modifiedAt)}
                                    <span>·</span>
                                    {formatBytes(file.size)}
                                  </small>
                                </span>
                                <ArrowRight size={15} />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <EmptyState
                            title="Nothing quite like that."
                            description="Try a shorter filename, another file type, or a different date range."
                          />
                        )}
                        {results.length > 50 && (
                          <p className="settings-fineprint">
                            Showing the first 50 matches. Narrow your request to see more specific
                            results.
                          </p>
                        )}
                      </>
                    )}
                    {plan.kind === 'analyze' && analysis && (
                      <>
                        <div className="analysis-stats">
                          <div>
                            <HardDrive size={17} />
                            <strong>{formatBytes(analysis.totalBytes)}</strong>
                            <span>indexed storage</span>
                          </div>
                          <div>
                            <Files size={17} />
                            <strong>{analysis.totalFiles}</strong>
                            <span>files, accounted for</span>
                          </div>
                        </div>
                        <div className="analysis-subheading">
                          <h4>The bigger things</h4>
                          <span>Largest first</span>
                        </div>
                        <div className="large-files">
                          {analysis.largeFiles.slice(0, 5).map((file) => (
                            <button key={file.id} onClick={() => onOpenFile(file)}>
                              <FileIcon file={file} />
                              <span>
                                <strong>{file.name}</strong>
                                <span className="large-file-meter">
                                  <i
                                    style={{
                                      width: `${Math.max(3, (file.size / (analysis.largeFiles[0]?.size || 1)) * 100)}%`,
                                    }}
                                  />
                                </span>
                              </span>
                              <small>{formatBytes(file.size)}</small>
                            </button>
                          ))}
                        </div>
                        <button className="analysis-cleanup" onClick={() => ask('Clean up safely')}>
                          <Trash2 size={20} />
                          <span>
                            <strong>
                              {analysis.duplicates.reduce(
                                (sum, group) => sum + group.length - 1,
                                0,
                              )}{' '}
                              verified duplicate files
                            </strong>
                            <small>Review what you could let go.</small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                        <div className="analysis-subheading">
                          <h4>A little perspective</h4>
                          <span>Folder growth</span>
                        </div>
                        <div className="growth-list">
                          {analysis.growth.slice(0, 5).map((folder) => (
                            <div key={folder.name}>
                              <span>{folder.name}</span>
                              <strong>
                                {folder.previousBytes === null
                                  ? 'First scan'
                                  : `${folder.bytes >= folder.previousBytes ? '+' : '−'}${formatBytes(Math.abs(folder.bytes - folder.previousBytes))}`}
                              </strong>
                            </div>
                          ))}
                        </div>
                        <button
                          className="text-button baseline-button"
                          onClick={() =>
                            run(
                              'Recording a storage baseline',
                              (progress) => repository.reindex(progress),
                              'Baseline recorded. Future scans can show folder growth.',
                            )
                          }
                        >
                          <ArrowDownToLine size={14} />
                          Record a new baseline
                        </button>
                      </>
                    )}
                    {(plan.kind === 'organize' ||
                      plan.kind === 'move' ||
                      plan.kind === 'cleanup') && (
                      <>
                        <div className="plan-review-label">
                          <ShieldCheck size={15} />
                          <span>YOUR REVIEW. YOUR CALL.</span>
                        </div>
                        <div className="plan-items">
                          {reviewFiles
                            .slice(reviewPage * 60, (reviewPage + 1) * 60)
                            .map((file) => ({
                              file,
                              destination:
                                plan.kind === 'organize'
                                  ? moveById.get(file.id)?.destination
                                  : plan.kind === 'move'
                                    ? plan.destination
                                    : file.kind === 'folder'
                                      ? 'Empty folder'
                                      : file.cleanupReason === 'duplicate' ||
                                          analysis?.duplicates.some((group) =>
                                            group.slice(1).some((item) => item.id === file.id),
                                          )
                                        ? 'Verified duplicate'
                                        : 'Older than 30 days',
                            }))
                            .map(({ file, destination }) => (
                              <label
                                className={`plan-item ${picked.has(file.id) ? 'checked' : ''}`}
                                key={file.id}
                              >
                                <input
                                  type="checkbox"
                                  checked={picked.has(file.id)}
                                  onChange={() => toggle(file.id)}
                                />
                                <span className="plan-checkbox">
                                  {picked.has(file.id) && <Check size={12} />}
                                </span>
                                <FileIcon file={file} />
                                <span>
                                  <strong>{file.name}</strong>
                                  <small>
                                    {plan.kind !== 'cleanup' && <FolderInput size={11} />}{' '}
                                    {destination}
                                  </small>
                                </span>
                              </label>
                            ))}
                        </div>
                        {!picked.size && (
                          <p className="plan-empty">
                            {(plan.kind === 'cleanup'
                              ? cleanup
                              : plan.kind === 'organize'
                                ? moves
                                : results
                            ).length
                              ? 'Choose the files you would like to include.'
                              : 'Nothing to change here. Everything is already in good shape.'}
                          </p>
                        )}
                        {reviewFiles.length > 60 && (
                          <div className="review-pagination">
                            <span>
                              {reviewPage * 60 + 1}–
                              {Math.min((reviewPage + 1) * 60, reviewFiles.length)} of{' '}
                              {reviewFiles.length} files
                            </span>
                            <IconButton
                              label="Previous review page"
                              disabled={reviewPage === 0}
                              onClick={() => setReviewPage((page) => page - 1)}
                            >
                              <ChevronLeft size={17} />
                            </IconButton>
                            <IconButton
                              label="Next review page"
                              disabled={(reviewPage + 1) * 60 >= reviewFiles.length}
                              onClick={() => setReviewPage((page) => page + 1)}
                            >
                              <ChevronRight size={17} />
                            </IconButton>
                          </div>
                        )}
                        <div className="plan-safety">
                          <ShieldCheck size={15} />
                          <p>
                            {plan.kind === 'cleanup'
                              ? 'Files go to Trash. You can restore them anytime.'
                              : 'No overwrites. No deletes. Just a more organized day.'}
                          </p>
                        </div>
                        <button
                          className="primary-button plan-confirm"
                          disabled={!picked.size || working}
                          onClick={confirm}
                        >
                          {working ? (
                            <LoaderCircle className="spin" size={17} />
                          ) : plan.kind === 'cleanup' ? (
                            <Trash2 size={17} />
                          ) : (
                            <FolderTree size={17} />
                          )}{' '}
                          {working
                            ? 'Taking care of it…'
                            : plan.kind === 'cleanup'
                              ? `Move ${picked.size} items to Trash`
                              : `${plan.kind === 'move' ? 'Move' : 'Organize'} ${picked.size} files`}
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="assistant-compose">
        <div className="assistant-mode">
          <button
            className={cloud ? 'connected' : ''}
            onClick={() => {
              if (!preferences.hasKey || !preferences.metadataConsent) {
                notify('Connect a provider in Settings to use cloud intelligence.', 'info');
                openSettings();
              } else setCloud(!cloud);
            }}
          >
            <span className="status-dot" />
            {cloud ? 'Connected AI' : 'On-device tools'}
            <ChevronLeft size={12} />
          </button>
          <IconButton label="Assistant settings" onClick={openSettings}>
            <Settings2 size={15} />
          </IconButton>
        </div>
        <form onSubmit={submit}>
          <input
            aria-label="Ask your file assistant"
            placeholder="A little help with your files…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={loading || working}
            maxLength={1000}
          />
          <IconButton
            label="Send request"
            className="send-button"
            type="submit"
            disabled={!query.trim() || loading || working}
          >
            {loading ? <LoaderCircle className="spin" size={18} /> : <ArrowUp size={19} />}
          </IconButton>
        </form>
        <p>
          <ShieldCheck size={12} />
          {cloud
            ? 'Limited metadata shared. You approve every action.'
            : 'Local tools. Private files. You’re always in control.'}
        </p>
      </div>
    </Modal>
  );
}
function ArrowUpRightIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M5 15 15 5M5 5h10v10" />
    </svg>
  );
}
