import { NOMBRES, type Campo } from './campos';

/**
 * El formulario de una ficha, campo a campo.
 *
 * Lo que hace distinta a esta pantalla de un formulario cualquiera: cada campo
 * dice si está **defendido**, es decir, si alguien lo corrigió a mano y la
 * ingesta ya no puede pisarlo. Sin esa marca, la regla —la persona gana en el
 * campo que tocó, Wikidata en el resto— sería invisible, y una regla invisible
 * se descubre el día que algo no cambia y nadie entiende por qué.
 *
 * Y por eso la casilla de soltar está junto al campo y no en un menú aparte:
 * devolverle el mando a la fuente es una decisión sobre ESE dato.
 */
export default function Ficha({ campos, valores, defendidos }: {
  campos: readonly Campo[];
  valores: Record<string, unknown>;
  /** Los campos que hoy están protegidos de la ingesta. */
  defendidos: string[];
}) {
  return (
    <div className="ficha">
      {campos.map((campo) => {
        const valor = valores[campo.nombre];
        const texto = valor === null || valor === undefined ? '' : String(valor);
        const defendido = defendidos.includes(campo.nombre);

        return (
          <div key={campo.nombre} className={`ficha-campo ancho-${campo.ancho ?? 'medio'}`}>
            <label htmlFor={campo.nombre}>
              {campo.etiqueta}
              {defendido && <span className="defendido" title="Corregido a mano: la ingesta no lo toca">defendido</span>}
            </label>

            {campo.tipo === 'lista' ? (
              <select id={campo.nombre} name={campo.nombre} defaultValue={texto}>
                <option value="">—</option>
                {campo.opciones?.map((o) => (
                  <option key={o} value={o}>{NOMBRES[o] ?? o}</option>
                ))}
              </select>
            ) : campo.tipo === 'largo' ? (
              <textarea id={campo.nombre} name={campo.nombre} rows={2} defaultValue={texto} />
            ) : (
              <input
                id={campo.nombre}
                name={campo.nombre}
                defaultValue={texto}
                type={campo.tipo === 'numero' || campo.tipo === 'decimal' ? 'number' : 'text'}
                step={campo.tipo === 'decimal' ? '0.01' : undefined}
                inputMode={campo.tipo === 'url' ? 'url' : undefined}
              />
            )}

            {campo.pie && <p className="pie">{campo.pie}</p>}

            {defendido && (
              <label className="soltar">
                <input type="checkbox" name="soltar" value={campo.nombre} />
                dejar que Wikidata vuelva a mandar en este campo
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
