import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, LANGS, LANG_NAMES } from '@/lib/i18n';
import SearchBox from '@/components/SearchBox';
import '../globals.css';

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export default async function LangLayout(
  { children, params }: { children: ReactNode; params: Promise<{ lang: string }> },
) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  return (
    <html lang={lang}>
      <body>
        <header className="topbar">
          <Link href={`/${lang}`} className="brand">art<span>las</span></Link>
          <SearchBox lang={lang} />
          <div className="grow" />
          <LanguagePicker current={lang} />
        </header>

        <main className="shell">{children}</main>

        <footer className="shell small muted">{t(lang, 'sourceNote')}</footer>
      </body>
    </html>
  );
}

/**
 * Cambia de idioma conservando la ruta. Son enlaces normales y no un <select>
 * con JavaScript para que funcionen sin hidratar y los indexe un buscador.
 */
function LanguagePicker({ current }: { current: string }) {
  return (
    <nav aria-label="idioma" style={{ display: 'flex', gap: 10 }}>
      {LANGS.map((lang) => (
        <Link
          key={lang}
          href={`/${lang}`}
          hrefLang={lang}
          title={LANG_NAMES[lang]}
          className="small"
          style={{
            color: lang === current ? 'var(--accent)' : 'var(--muted)',
            fontWeight: lang === current ? 700 : 400,
            textTransform: 'uppercase',
          }}
        >
          {lang}
        </Link>
      ))}
    </nav>
  );
}
