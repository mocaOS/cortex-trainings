'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductionState, StepId } from '@cortex-trainings/shared';
import type { Dict } from '@/lib/i18n';

const STEP_ICON: Record<string, string> = {
  pending: '○',
  running: '◐',
  waiting_input: '✋',
  completed: '●',
  failed: '✕',
};

export function ProductionPanel({ dict, projectId }: { dict: Dict; projectId: string }) {
  const [state, setState] = useState<ProductionState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    esRef.current?.close();
    const es = new EventSource(`/api/projects/${projectId}/production/events`);
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);
        if (event.type === 'state') setState(event.state);
        else if (event.type === 'log') {
          setLogs((l) => [...l.slice(-80), `[${event.step}] ${event.message}`]);
        }
      } catch {
        /* skip */
      }
    };
    esRef.current = es;
  }, [projectId]);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/production`)
      .then((r) => r.json())
      .then((d) => setState(d.state));
    connect();
    return () => esRef.current?.close();
  }, [projectId, connect]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  async function start() {
    await fetch(`/api/projects/${projectId}/production`, { method: 'POST' });
    connect();
  }

  async function sendInput(key: 'ref' | 'video', value: unknown) {
    await fetch(`/api/projects/${projectId}/production/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
  }

  if (!state) {
    return (
      <div className="approve-bar">
        <button className="btn btn-primary" onClick={start}>
          {dict['production.start']}
        </button>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {dict['production.startHint']}
        </span>
      </div>
    );
  }

  const failed = state.status === 'failed';
  const done = state.status === 'done';
  // Idle with work already behind it = a run that was stopped or reset; offer a restart.
  const startable = failed || state.status === 'idle';
  const resumable = state.steps.some((s) => s.status === 'completed');
  const refStep = state.steps.find((s) => s.id === 'refimage');
  const filmStep = state.steps.find((s) => s.id === 'films');

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>{dict['production.title']}</h3>

      <ul className="prod-steps">
        {state.steps.map((s) => (
          <li key={s.id} className={`prod-step ${s.status}`}>
            <span className="icon">{STEP_ICON[s.status]}</span>
            <span className="name">{dict[`production.step.${s.id}`] ?? s.id}</span>
            {s.detail && <span className="detail muted">{s.detail}</span>}
            {s.error && <span className="detail error">{s.error}</span>}
          </li>
        ))}
      </ul>

      {refStep?.status === 'waiting_input' && state.refCandidates && (
        <div style={{ marginTop: '1rem' }}>
          <p style={{ margin: '0 0 0.5rem' }}>{dict['production.pickRef']}</p>
          <div className="ref-pick">
            {state.refCandidates.map((src, i) => (
              <button key={i} className="ref-candidate" onClick={() => sendInput('ref', i)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`candidate ${i + 1}`} />
                <span>{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {refStep?.status === 'completed' && state.refCandidateCount ? (
        <details className="ref-chosen">
          <summary>
            {dict['production.refChosen']}
            {state.chosenRef != null && ` — #${state.chosenRef + 1}`}
          </summary>
          <div className="ref-pick" style={{ marginTop: '0.6rem' }}>
            {Array.from({ length: state.refCandidateCount }, (_, i) => (
              <figure key={i} className={`ref-candidate static ${state.chosenRef === i ? 'chosen' : ''}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/projects/${projectId}/asset?p=ref-candidates/${i}.jpg`}
                  alt={`candidate ${i + 1}`}
                />
                <span>{i + 1}</span>
              </figure>
            ))}
          </div>
        </details>
      ) : null}

      {filmStep?.status === 'waiting_input' && (
        <div className="approve-bar" style={{ marginTop: '1rem' }}>
          <button className="btn btn-primary" onClick={() => sendInput('video', true)}>
            {dict['production.confirmVideo']}
          </button>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {dict['production.confirmVideoHint']}{' '}
            {state.videoQuoteUsd != null && <strong>≈ ${state.videoQuoteUsd.toFixed(2)}</strong>}
          </span>
        </div>
      )}

      {startable && (
        <div className="approve-bar" style={{ marginTop: '1rem' }}>
          <button className="btn btn-primary" onClick={start}>
            {resumable ? dict['production.resume'] : dict['production.start']}
          </button>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {resumable ? dict['production.resumeHint'] : dict['production.startHint']}
          </span>
        </div>
      )}

      {state.qa && (
        <div className="qa-result">
          <span className={state.qa.passed ? 'ok' : 'bad'}>
            {state.qa.passed ? `✓ ${dict['production.qaPassed']}` : '✕'}
          </span>{' '}
          <span className="muted">{state.qa.summary}</span>
          {state.qa.notCovered && (
            <div className="muted" style={{ fontSize: '0.76rem', marginTop: '0.3rem' }}>
              {dict['production.qaNotCovered']}: {state.qa.notCovered}
            </div>
          )}
        </div>
      )}

      {done && state.outputFile && (
        <div className="approve-bar" style={{ marginTop: '1rem' }}>
          <a className="btn btn-primary" href={`/api/projects/${projectId}/download`}>
            {dict['production.download']}
          </a>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {dict['production.downloadHint']}
          </span>
        </div>
      )}

      {logs.length > 0 && (
        <div className="prod-log" ref={logRef}>
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
