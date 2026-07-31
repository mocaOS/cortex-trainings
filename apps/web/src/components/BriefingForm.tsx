'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_VISUAL_STYLE,
  MAX_REF_IMAGES,
  VISUAL_STYLES,
  type RefKind,
  type VisualStyle,
} from '@cortex-trainings/shared';
import type { Dict } from '@/lib/i18n';

const STYLE_KEYS = Object.keys(VISUAL_STYLES) as VisualStyle[];

interface Meta {
  collections: Array<{ id: string; name: string }>;
  topics: Array<{ id: string; name: string; description: string }>;
}

function RefPicker({
  dict,
  kind,
  files,
  onChange,
}: {
  dict: Dict;
  kind: RefKind;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  return (
    <label className="field">
      {dict[`briefing.${kind}Refs`]}
      <span className="hint">{dict[`briefing.${kind}RefsHint`]}</span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(e) => onChange(Array.from(e.target.files ?? []).slice(0, MAX_REF_IMAGES))}
      />
      {previews.length > 0 && (
        <span className="ref-thumbs">
          {previews.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt={`${kind} reference ${i + 1}`} />
          ))}
        </span>
      )}
    </label>
  );
}

export function BriefingForm({ dict, defaultLanguage }: { dict: Dict; defaultLanguage: string }) {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta>({ collections: [], topics: [] });
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('');
  const [language, setLanguage] = useState(defaultLanguage);
  const [duration, setDuration] = useState(dict['briefing.duration.standard']);
  const [material, setMaterial] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(DEFAULT_VISUAL_STYLE);
  const [refFiles, setRefFiles] = useState<Record<RefKind, File[]>>({ character: [], style: [] });
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [error, setError] = useState('');
  // Survives a failed ref upload so a retry doesn't create a second project.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [uploadedKinds, setUploadedKinds] = useState<Set<RefKind>>(new Set());

  useEffect(() => {
    fetch('/api/meta')
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      let id = createdId;
      if (!id) {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            audience,
            language,
            duration,
            visualStyle,
            material: material || undefined,
            collectionId: collectionId || undefined,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        id = ((await res.json()).project as { id: string }).id;
        setCreatedId(id);
      }
      for (const kind of ['character', 'style'] as RefKind[]) {
        if (refFiles[kind].length === 0 || uploadedKinds.has(kind)) continue;
        setBusyText(dict['briefing.refsUploading']);
        const form = new FormData();
        form.set('kind', kind);
        for (const file of refFiles[kind]) form.append('images', file);
        const res = await fetch(`/api/projects/${id}/refs`, { method: 'POST', body: form });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? dict['error.generic']);
        }
        setUploadedKinds((done) => new Set(done).add(kind));
      }
      router.push(`/projects/${id}`);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : dict['error.generic']);
      setBusy(false);
      setBusyText('');
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        {dict['briefing.topic']}
        <span className="hint">{dict['briefing.topicHint']}</span>
        <textarea required rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} />
      </label>

      <label className="field">
        {dict['briefing.audience']}
        <span className="hint">{dict['briefing.audienceHint']}</span>
        <input required value={audience} onChange={(e) => setAudience(e.target.value)} />
      </label>

      <label className="field">
        {dict['briefing.language']}
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </label>

      <label className="field">
        {dict['briefing.duration']}
        <select value={duration} onChange={(e) => setDuration(e.target.value)}>
          <option>{dict['briefing.duration.compact']}</option>
          <option>{dict['briefing.duration.standard']}</option>
          <option>{dict['briefing.duration.full']}</option>
        </select>
      </label>

      <label className="field">
        {dict['briefing.visualStyle']}
        <span className="hint">{dict['briefing.visualStyleHint']}</span>
        <select
          value={visualStyle}
          onChange={(e) => setVisualStyle(e.target.value as VisualStyle)}
        >
          {STYLE_KEYS.map((key) => (
            <option key={key} value={key}>
              {dict[`briefing.visualStyle.${key}`] ?? key}
            </option>
          ))}
        </select>
      </label>

      <RefPicker
        dict={dict}
        kind="character"
        files={refFiles.character}
        onChange={(files) => setRefFiles((r) => ({ ...r, character: files }))}
      />

      <RefPicker
        dict={dict}
        kind="style"
        files={refFiles.style}
        onChange={(files) => setRefFiles((r) => ({ ...r, style: files }))}
      />

      <label className="field">
        {dict['briefing.collection']}
        <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          <option value="">{dict['briefing.collection.all']}</option>
          {meta.collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        {dict['briefing.material']}
        <span className="hint">{dict['briefing.materialHint']}</span>
        <textarea rows={5} value={material} onChange={(e) => setMaterial(e.target.value)} />
      </label>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <button className="btn btn-primary" disabled={busy} type="submit">
        {busy && busyText ? busyText : dict['briefing.submit']}
      </button>
    </form>
  );
}
