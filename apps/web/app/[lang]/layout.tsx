import { Suspense, type ReactNode } from 'react';
import { Montserrat } from 'next/font/google';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, LANGS } from '@/lib/i18n';
import { path } from '@/lib/routes';
import SearchBox from '@/components/SearchBox';
import { LanguagePicker, LanguagePickerSinFiltros } from '@/components/LanguagePicker';
import '../globals.css';

/*
 * Montserrat servida desde nuestro propio dominio, no desde Google.
 *
 * `next/font` la descarga en tiempo de construcción y la sirve con el resto de
 * la app. Eso ahorra la conexión a `fonts.gstatic.com` en cada visita —y su
 * espera— y, de paso, evita mandarle a Google la IP de cada visitante por el
 * mero hecho de mirar un cuadro.
 *
 * `display: 'swap'` para que el texto se lea con la fuente del sistema desde
 * el primer instante en vez de quedarse invisible esperando: en una web que va
 * de mirar imágenes, un título que tarda en aparecer es peor que un título con
 * otra letra durante 200 ms.
 */
const montserrat = Montserrat({
  subsets: ['latin'],
  display: 'swap',
  variable: '--fuente',
});

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export default async function LangLayout(
  { children, params }: { children: ReactNode; params: Promise<{ lang: string }> },
) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  return (
    <html lang={lang} className={montserrat.variable}>
      <body>
        <header className="topbar">
          <Link href={`/${lang}`} className="brand">art<span>las</span></Link>
          <SearchBox lang={lang} />
          <div className="grow" />
          <Suspense fallback={<LanguagePickerSinFiltros current={lang} />}>
            <LanguagePicker current={lang} />
          </Suspense>
        </header>

        {/*
          * Museos y artistas viven aquí, en una fila propia, y no en la barra
          * de arriba: allí ya se reparten el sitio el logo, el buscador y tres
          * idiomas, y en un teléfono de 390 px al buscador le quedaban 40 px.
          * Meterle dos enlaces más lo dejaría otra vez sin espacio.
          *
          * Van en todas las páginas porque el problema era justamente que a
          * museos y artistas solo se llegaba de rebote.
          */}
        <nav className="shell secciones" aria-label={t(lang, 'explore')}>
          <Link href={path(lang, 'museums')}>{t(lang, 'allMuseums')}</Link>
          <Link href={path(lang, 'artists')}>{t(lang, 'allArtists')}</Link>
          <Link href={path(lang, 'search')}>{t(lang, 'searchAction')}</Link>
        </nav>

        <main className="shell">{children}</main>

        <footer className="shell small muted">{t(lang, 'sourceNote')}</footer>
      </body>
    </html>
  );
}
