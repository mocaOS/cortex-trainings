'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Dict } from '@/lib/i18n';

interface Meta {
  collections: Array<{ id: string; name: string }>;
  topics: Array<{ id: string; name: string; description: string }>;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          audience,
          language,
          duration,
          material: material || undefined,
          collectionId: collectionId || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { project } = await res.json();
      router.push(`/projects/${project.id}`);
    } catch {
      setError(dict['error.generic']);
      setBusy(false);
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
        {dict['briefing.submit']}
      </button>
    </form>
  );
}
