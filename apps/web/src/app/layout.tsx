import type { Metadata } from 'next';
import Link from 'next/link';
import { getDict, getLang } from '@/lib/i18n';
import { BackToStart } from '@/components/BackToStart';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cortex Trainings',
};

/** ACCENT_COLOR env overrides the design system's single chromatic color. */
function accentOverride(): string | null {
  const v = process.env.ACCENT_COLOR?.trim();
  if (!v || !/^[#a-zA-Z0-9(),.%\s-]+$/.test(v)) return null;
  return `:root, .dark { --accent: ${v}; }`;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const dict = getDict();
  const accent = accentOverride();
  return (
    <html lang={getLang()} className="dark">
      <body>
        {accent && <style>{accent}</style>}
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-orb" aria-hidden />
            {dict['app.title']}
          </Link>
          <nav>
            <BackToStart label={dict['nav.backToStart']} />
            <Link href="/projects/new" className="btn btn-primary">
              {dict['nav.newProject']}
            </Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
