'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { LANGS, LANG_NAMES, type Lang } from '@/lib/i18n';
import { translatePath } from '@/lib/routes';

/**
 * Cambia de idioma **sin moverte de página**.
 *
 * Antes llevaba a la portada, y eso es perder el sitio: mirando el Guernica en
 * español y queriendo leerlo en inglés, te devolvía al mapa del mundo. El
 * enlace decía `/${lang}` a secas aunque el comentario de al lado prometiera
 * que conservaba la ruta.
 *
 * Siguen siendo enlaces normales y no un `<select>` con JavaScript, para que un
 * buscador los indexe y para que funcionen con el botón de atrás. Son de
 * cliente solo porque la ruta actual no llega a un `layout` de servidor:
 * `headers()` la daría, pero volvería dinámicas todas las páginas y hoy se
 * sirven con `revalidate = 3600`. Cambiar el cacheado de la web entera para
 * pintar tres enlaces sería pagar demasiado.
 */
function Enlaces(
  { current, pathname, consulta }: { current: Lang; pathname: string; consulta: string },
) {
  return (
    <nav aria-label="idioma" style={{ display: 'flex', gap: 10 }}>
      {LANGS.map((lang) => {
        const destino = translatePath(pathname, lang);

        return (
          <Link
            key={lang}
            href={consulta ? `${destino}?${consulta}` : destino}
            hrefLang={lang}
            title={LANG_NAMES[lang]}
            /* Es la misma página en otra lengua, no otra página distinta. */
            rel="alternate"
            className="small"
            style={{
              color: lang === current ? 'var(--accent)' : 'var(--muted)',
              fontWeight: lang === current ? 700 : 400,
              textTransform: 'uppercase',
            }}
          >
            {lang}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * El de verdad: conserva también la cadena de consulta, porque en el buscador
 * ES la página. `?q=goya&pais=ES` no es un adorno, es lo que estás mirando. Sus
 * claves son las mismas en los tres idiomas, así que pasa tal cual.
 */
export function LanguagePicker({ current }: { current: Lang }) {
  return <Enlaces current={current} pathname={usePathname()} consulta={useSearchParams().toString()} />;
}

/**
 * El respaldo mientras suspende el de arriba.
 *
 * `useSearchParams` obliga a un límite de suspense para que el resto de la
 * página se siga generando estática; `usePathname` no. Así que este conserva la
 * ruta y pierde solo los filtros — que sigue siendo muchísimo mejor que el
 * «vuelve a la portada» de antes— y no suspende nunca, que es lo que un
 * respaldo tiene que garantizar.
 */
export function LanguagePickerSinFiltros({ current }: { current: Lang }) {
  return <Enlaces current={current} pathname={usePathname()} consulta="" />;
}
