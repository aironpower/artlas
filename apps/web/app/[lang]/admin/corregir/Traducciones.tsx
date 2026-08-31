import { LANGS, LANG_NAMES } from '@/lib/i18n';
import { campoTraducido, type Campo, type Traduccion } from './campos';

/**
 * Los textos de una ficha, un bloque por idioma.
 *
 * Por qué existe esta pantalla, que es la pregunta importante: la app pública
 * NO enseña el campo canónico, enseña `coalesce(traducción, canónico)`. Así que
 * mientras solo se pudiera corregir lo canónico, un administrador podía
 * escribir «El Bosco» en el nombre del artista, guardar, ir a la ficha pública
 * y seguir viendo «Jerónimo Bosch» —que es el nombre que Wikidata da en
 * español— sin una sola pista de por qué. Corregir sin efecto visible es peor
 * que no poder corregir.
 *
 * Cada campo dice si está defendido, igual que en `Ficha`, y por el mismo
 * motivo: la regla —la persona gana en el campo que tocó, la fuente en el
 * resto— tiene que verse, o se descubre el día que algo no cambia y nadie
 * entiende por qué.
 *
 * Los idiomas son los ACTIVOS de la interfaz. Hay filas guardadas en los cuatro
 * retirados (it, de, pt, nl) y no se pintan: editar a mano un idioma que no se
 * sirve es trabajo que no se ve.
 */
export default function Traducciones({ campos, filas }: {
  campos: readonly Campo[];
  filas: Traduccion[];
}) {
  return (
    <section style={{ paddingTop: 30 }}>
      <h2>Los textos, idioma a idioma</h2>
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        Esto es lo que ve el visitante. Un idioma sin fila se crea al guardarlo.
      </p>

      {LANGS.map((lang) => {
        const fila = filas.find((t) => t.lang === lang);
        const defendidos = (fila?.locked_fields as string[] | null) ?? [];

        return (
          <div key={lang} className="idioma">
            <h3>
              {LANG_NAMES[lang]}
              {!fila && <span className="muted small" style={{ fontWeight: 400 }}> · sin traducción todavía</span>}
            </h3>

            <div className="ficha">
              {campos.map((campo) => {
                const valor = fila?.[campo.nombre];
                const texto = valor === null || valor === undefined ? '' : String(valor);
                const defendido = defendidos.includes(campo.nombre);
                const id = campoTraducido(lang, campo.nombre);

                return (
                  <div key={id} className={`ficha-campo ancho-${campo.ancho ?? 'medio'}`}>
                    <label htmlFor={id}>
                      {campo.etiqueta}
                      {defendido && (
                        <span className="defendido" title="Corregido a mano: la ingesta no lo toca">
                          defendido
                        </span>
                      )}
                    </label>

                    {campo.tipo === 'largo' ? (
                      <textarea id={id} name={id} rows={2} defaultValue={texto} />
                    ) : (
                      <input id={id} name={id} defaultValue={texto} type="text" />
                    )}

                    {defendido && (
                      <label className="soltar">
                        <input type="checkbox" name={`soltar.${lang}`} value={campo.nombre} />
                        dejar que Wikidata vuelva a mandar en este campo
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
