'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectRefs, RefKind } from '@cortex-trainings/shared';
import { MAX_REF_IMAGES } from '@cortex-trainings/shared';
import type { Dict } from '@/lib/i18n';

/**
 * Shows and manages the project's uploaded character/style reference images.
 * Uploads run the vision analysis server-side, so the button stays busy for a few seconds.
 */
export function RefImages({
  dict,
  projectId,
  locked,
}: {
  dict: Dict;
  projectId: string;
  locked: boolean;
}) {
  const [refs, setRefs] = useState<ProjectRefs | null>(null);
  const [busy, setBusy] = useState<RefKind | null>(null);
  const [error, setError] = useState('');
  // Bump to bust the browser cache after a replace — the file names are stable.
  const [rev, setRev] = useState(0);
  const inputs = { character: useRef<HTMLInputElement>(null), style: useRef<HTMLInputElement>(null) };

  const reload = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/refs`);
    if (res.ok) setRefs((await res.json()).refs);
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function upload(kind: RefKind, files: FileList | null) {
    if (!files || files.length === 0) return;
    if (files.length > MAX_REF_IMAGES) {
      setError(dict['briefing.refsTooMany']);
      return;
    }
    setBusy(kind);
    setError('');
    try {
      const form = new FormData();
      form.set('kind', kind);
      for (const file of Array.from(files)) form.append('images', file);
      const res = await fetch(`/api/projects/${projectId}/refs`, { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? dict['error.generic']);
      setRefs(json.refs);
      setRev((r) => r + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict['error.generic']);
    } finally {
      setBusy(null);
    }
  }

  async function remove(kind: RefKind) {
    setBusy(kind);
    setError('');
    try {
      const res = await fetch(`/api/projects/${projectId}/refs?kind=${kind}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? dict['error.generic']);
      setRefs(json.refs);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict['error.generic']);
    } finally {
      setBusy(null);
    }
  }

  if (!refs) return null;
  const kinds: RefKind[] = ['character', 'style'];
  // Nothing uploaded and nothing uploadable — don't render an empty panel.
  if (locked && !refs.character && !refs.style) return null;

  return (
    <div className="card" style={{ marginTop: '1.25rem' }}>
      <h3 style={{ marginTop: 0 }}>{dict['refs.title']}</h3>
      <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
        {locked ? dict['refs.locked'] : dict['refs.hint']}
      </p>
      {kinds.map((kind) => {
        const entry = refs[kind];
        return (
          <div key={kind} className="ref-group">
            <div className="ref-group-head">
              <strong>{dict[`refs.${kind}`]}</strong>
              {!locked && (
                <span className="ref-group-actions">
                  <input
                    ref={inputs[kind]}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    hidden
                    onChange={(e) => {
                      upload(kind, e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    className="btn"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => inputs[kind].current?.click()}
                  >
                    {busy === kind
                      ? dict['briefing.refsUploading']
                      : entry
                        ? dict['refs.replace']
                        : dict['refs.upload']}
                  </button>
                  {entry && (
                    <button
                      className="btn"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => remove(kind)}
                    >
                      {dict['refs.remove']}
                    </button>
                  )}
                </span>
              )}
            </div>
            {entry ? (
              <>
                <div className="ref-thumbs">
                  {entry.files.map((rel) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={rel}
                      src={`/api/projects/${projectId}/asset?p=${encodeURIComponent(rel)}&v=${rev}`}
                      alt={`${kind} reference`}
                    />
                  ))}
                </div>
                <details className="ref-analysis">
                  <summary>{dict['refs.analysis']}</summary>
                  <p className="muted">{entry.description}</p>
                </details>
              </>
            ) : (
              <p className="muted" style={{ fontSize: '0.82rem', margin: '0.25rem 0 0' }}>
                {dict['refs.empty']}
              </p>
            )}
          </div>
        );
      })}
      {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}
    </div>
  );
}
