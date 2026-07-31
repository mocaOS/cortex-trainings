import Link from 'next/link';
import { shortTitle } from '@cortex-trainings/shared';
import { getDict } from '@/lib/i18n';
import { listProjects } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const dict = getDict();
  const projects = await listProjects();

  return (
    <div className="stack" style={{ maxWidth: 'none' }}>
      <p className="muted">{dict['app.tagline']}</p>
      {projects.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {dict['dashboard.empty']}
          </p>
        </div>
      ) : (
        <div className="grid project-list">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="card project-card">
              <h3>{shortTitle(p.briefing.topic)}</h3>
              <p className="topic-clamp">{p.briefing.topic}</p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                {p.briefing.audience} · {p.briefing.language} · {p.briefing.duration}
              </p>
              <span className={`badge ${p.status}`}>
                {dict[`dashboard.status.${p.status}`] ?? p.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
