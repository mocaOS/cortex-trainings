import { getDict, getLang } from '@/lib/i18n';
import { BriefingForm } from '@/components/BriefingForm';
import { env } from '@/lib/env';

export default function NewProjectPage() {
  const dict = getDict();
  return (
    <div className="stack">
      <h1>{dict['briefing.title']}</h1>
      <p className="muted">{dict['briefing.intro']}</p>
      <p className="cortex-source">
        {dict['briefing.cortexSource']} <code>{env.cortexBaseUrl}</code>
      </p>
      <BriefingForm dict={dict} defaultLanguage={getLang()} />
    </div>
  );
}
