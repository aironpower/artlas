import { Suspense, type ReactNode } from 'react';
import { Montserrat } from 'next/font/google';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, LANGS } from '@/lib/i18n';
import { path } from '@/lib/routes';
import SearchBox from '@/components/SearchBox';
import { LanguagePicker, LanguagePickerSinFiltros } from '@/components/LanguagePicker';
import { Cuenta } from '@/components/Cuenta';
import { SesionProvider } from '@/components/Sesion';
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
        <SesionProvider>
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
            {/*
              * Las etiquetas cortas —«Museos», no «Todos los museos»—. Con cuatro
              * secciones, las largas se salían de un teléfono de 390 px y
              * «Buscar» quedaba cortado contra el borde. En una barra de
              * navegación el sustantivo basta: el «todos» ya lo dice el estar
              * ahí. Las largas siguen sirviendo de título dentro de cada página.
              */}
            <Link href={path(lang, 'museums')}>{t(lang, 'museums')}</Link>
            <Link href={path(lang, 'artists')}>{t(lang, 'artists')}</Link>
            <Link href={path(lang, 'movements')}>{t(lang, 'movements')}</Link>
            {/*
              * «Buscador» y no «Buscar»: en una fila de sustantivos —Museos,
              * Artistas, Movimientos— un verbo se lee como un botón, y esto es
              * un sitio al que se va. La caja de arriba sigue siendo «Buscar»,
              * que ahí sí es la acción.
              */}
            <Link href={path(lang, 'search')}>{t(lang, 'searchSection')}</Link>

            <span className="grow" />

            {/*
              * Lo de la cuenta lo pregunta el navegador, no el servidor, y ese
              * cambio es el que devuelve la caché al sitio entero.
              *
              * Aquí estuvo el agujero: `Cuenta` leía la cookie de sesión al
              * pintarse y vive en el `layout`, así que volvía dinámica TODA
              * página de Artlas. El `<Suspense>` que lo envolvía prometía acotar
              * lo dinámico a este componente y no lo hacía: sin PPR, `Suspense`
              * hace streaming de un render dinámico, no salva la caché de la
              * ruta. Ver `components/Cuenta.tsx`.
              */}
            <Cuenta lang={lang} />
          </nav>

          <main className="shell">{children}</main>

          <footer className="shell small muted">{t(lang, 'sourceNote')}</footer>
        </SesionProvider>
      </body>
    </html>
  );
}
