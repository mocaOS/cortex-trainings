'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, Project } from '@cortex-trainings/shared';
import { shortTitle } from '@cortex-trainings/shared';
import type { Dict } from '@/lib/i18n';
import { ProductionPanel } from './ProductionPanel';

type FeedItem =
  | { kind: 'user' | 'assistant'; text: string }
  | { kind: 'tool'; text: string }
  | { kind: 'error'; text: string };

interface ProjectData {
  project: Project;
  curriculum: string | null;
  chat: ChatMessage[];
}

export function Workspace({ dict, projectId }: { dict: Dict; projectId: string }) {
  const [data, setData] = useState<ProjectData | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) return;
    const json: ProjectData = await res.json();
    setData(json);
    setFeed(json.chat.map((m) => ({ kind: m.role, text: m.content })));
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [feed]);

  const push = (item: FeedItem) => setFeed((f) => [...f, item]);

  async function run(message?: string) {
    setRunning(true);
    if (message) push({ kind: 'user', text: message });
    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message ? { message } : {}),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          switch (evt.type) {
            case 'tool_call':
              push({ kind: 'tool', text: `→ ${evt.name} ${evt.args ?? ''}` });
              break;
            case 'tool_result':
              push({ kind: 'tool', text: `← ${evt.name}: ${evt.summary ?? ''}` });
              break;
            case 'assistant':
              push({ kind: 'assistant', text: String(evt.text ?? '') });
              break;
            case 'curriculum_saved':
              push({ kind: 'tool', text: `✓ curriculum v${evt.version}` });
              break;
            case 'log':
              push({ kind: 'tool', text: `⚠ ${String(evt.message ?? '')}` });
              break;
            case 'error':
              push({ kind: 'error', text: String(evt.message ?? '') });
              break;
          }
        }
      }
    } catch (err) {
      push({ kind: 'error', text: err instanceof Error ? err.message : dict['error.generic'] });
    } finally {
      setRunning(false);
      reload();
    }
  }

  async function approve() {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    if (res.ok) {
      // Approval and production start are one gesture for the user.
      await fetch(`/api/projects/${projectId}/production`, { method: 'POST' });
      reload();
    }
  }

  if (!data) return <p className="muted">…</p>;
  const { project, curriculum } = data;
  const approved = ['approved', 'producing', 'done'].includes(project.status);
  const hasRun = feed.length > 0 || project.curriculumVersion > 0;

  return (
    <div>
      <h1 style={{ marginTop: 0, marginBottom: '0.35rem' }}>
        {shortTitle(project.briefing.topic)}
      </h1>
      <p className="topic-full">{project.briefing.topic}</p>
      <p className="muted" style={{ marginTop: '0.35rem' }}>
        {project.briefing.audience} · {project.briefing.language} · {project.briefing.duration}{' '}
        · <span className={`badge ${project.status}`}>{dict[`dashboard.status.${project.status}`] ?? project.status}</span>
      </p>

      <div className="workspace">
        <section className="card panel">
          <h3 style={{ marginTop: 0 }}>{dict['project.activity']}</h3>
          <div className="activity" ref={feedRef}>
            {feed.map((item, i) => (
              <div key={i} className={`evt ${item.kind}`}>
                {item.text}
              </div>
            ))}
            {running && (
              <div className="evt tool">
                <span className="pulse" /> {dict['project.researching']}
              </div>
            )}
          </div>

          {!hasRun && !running && (
            <button className="btn btn-primary" style={{ marginTop: '0.75rem', width: '100%' }} onClick={() => run()}>
              {dict['project.startResearch']}
            </button>
          )}

          {hasRun && !approved && (
            <form
              className="chatbox"
              onSubmit={(e) => {
                e.preventDefault();
                if (!input.trim() || running) return;
                const msg = input.trim();
                setInput('');
                run(msg);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={dict['project.chatPlaceholder']}
                disabled={running}
              />
              <button className="btn" type="submit" disabled={running || !input.trim()}>
                {dict['project.send']}
              </button>
            </form>
          )}
        </section>

        <section className="column">
          <div className="card panel">
            <h3 style={{ marginTop: 0 }}>
              {dict['project.curriculum']}
              {project.curriculumVersion > 0 && (
                <span className="badge" style={{ marginLeft: '0.6rem' }}>
                  {dict['project.version']} {project.curriculumVersion}
                </span>
              )}
            </h3>
            {curriculum ? (
              <div className="curriculum">
                <pre>{curriculum}</pre>
              </div>
            ) : (
              <p className="muted">{dict['project.curriculumEmpty']}</p>
            )}
          </div>

          {curriculum && !approved && (
            <div className="approve-bar">
              <button className="btn btn-primary" onClick={approve} disabled={running}>
                {dict['project.approve']}
              </button>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {dict['project.approveHint']}
              </span>
            </div>
          )}
          {approved && <ProductionPanel dict={dict} projectId={projectId} />}
        </section>
      </div>
    </div>
  );
}
