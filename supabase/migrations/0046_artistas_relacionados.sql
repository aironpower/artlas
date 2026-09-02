-- ============================================================================
-- Artlas · 0046 — artistas relacionados
--
-- Pedido por Manuel: «relacionarlo con otros autores según país de origen,
-- época, museo o movimiento». Las cuatro relaciones ya existían como columnas;
-- lo que no existía era decidir cuál manda cuando varias coinciden.
--
-- Se resolvió mirando resultados, no de antemano. Con los pesos de abajo:
--
--     Rembrandt → Ostade, Steen, Hals, Cuyp, De Hooch   (Siglo de Oro holandés)
--     Rubens    → Van Dyck, Jordaens, Snyders           (su propio taller)
--     Monet     → Gauguin, Degas, Renoir, Cézanne       (los impresionistas)
--     Daumier   → Corot, Manet, Courbet, Millet         (el realismo francés)
--
-- ## Los pesos, y por qué esos
--
--   país 2 · movimiento 2 · época 1 · museo 1
--
-- País y movimiento pesan doble porque son los que dicen algo: dos pintores del
-- mismo movimiento se parecen. La época sola no —en 1850 pintaba medio mundo— y
-- el museo tampoco: compartir el Louvre no relaciona a nadie con nadie, hay
-- 3.990 obras solo en el Prado. Los dos valen de desempate, que es justo lo que
-- un peso de 1 hace.
--
-- El país se agrupa con la tabla de `0045`, y sin ella esto no funcionaría:
-- Rembrandt («Dutch Republic») y Van Gogh («Kingdom of the Netherlands») no se
-- habrían encontrado nunca.
--
-- ## Por qué se arman antes los candidatos
--
-- La primera versión puntuaba a los 21.619 artistas y comprobaba el museo de
-- cada uno: **15.124 ms para Rembrandt**, cinco veces el corte de 3 s del rol
-- `anon`. El museo es lo caro —28 museos suyos, y en cada uno miles de obras—.
--
-- Al revés cuesta 1.616 ms en frío y 59 en caliente: primero se arma un
-- conjunto pequeño —los del mismo país más los de los mismos movimientos— y el
-- museo solo se mira para esos. El museo deja de ser una forma de encontrar
-- candidatos y pasa a ser lo que de verdad es: un desempate.
--
--     Rembrandt   15.124 ms  →  1.616 ms (frío) · 59 ms (caliente)
--     Monet        2.184 ms  →  1.444 ms (frío) · 72 ms
--     Turner            —    →    899 ms
--
-- ## Devuelve el porqué, no solo los nombres
--
-- Las cuatro banderas salen en la respuesta para que la pantalla pueda decir
-- «mismo país · mismo movimiento» debajo de cada nombre. Una lista de sugeridos
-- que no dice de dónde sale es una caja negra, y aquí las cajas negras se
-- abren: es la misma regla que hizo que la ingesta tenga panel.
-- ============================================================================

set search_path = public, extensions;

create or replace function related_artists(
  p_slug      text,
  p_lang      text default 'es',
  max_results int  default 8
)
returns table (
  slug             text,
  name             text,
  nationality      text,
  nationality_code text,
  birth_year       int,
  death_year       int,
  artwork_count    int,
  same_country     boolean,
  same_period      boolean,
  same_movement    boolean,
  same_museum      boolean
)
language sql stable security definer set search_path = public, extensions as $fn$
  with yo as (
    select a.id, nc.country_code, a.nationality, a.birth_year
      from artists a
      left join nationality_country nc on nc.raw = a.nationality
     where a.slug = p_slug
     order by a.artwork_count desc
     limit 1
  ),
  mis_movimientos as (
    select distinct am.movement_id
      from artworks w
      join artwork_movements am on am.artwork_id = w.id
     where w.artist_id = (select id from yo)
  ),
  /*
   * Solo sus cinco museos principales. Con los 28 de Rembrandt el desempate
   * salía carísimo y no cambiaba el resultado: el museo donde tiene tres obras
   * no dice nada de él.
   */
  mis_museos as (
    select w.institution_id
      from artworks w
     where w.artist_id = (select id from yo) and w.institution_id is not null
     group by w.institution_id
     order by count(*) desc
     limit 5
  ),
  por_pais as (
    select a.id
      from artists a
      left join nationality_country nc on nc.raw = a.nationality
     where a.artwork_count > 0
       and ((select country_code from yo) is not null
             and nc.country_code = (select country_code from yo)
            or a.nationality = (select nationality from yo))
  ),
  por_movimiento as (
    select distinct w.artist_id as id
      from artwork_movements am
      join artworks w on w.id = am.artwork_id
     where am.movement_id in (select movement_id from mis_movimientos)
       and w.artist_id is not null
  ),
  candidatos as (
    select id from por_pais
    union
    select id from por_movimiento
  ),
  puntuados as (
    select a.id,
           a.slug,
           coalesce(t.name, a.name) as nombre,
           a.nationality,
           nc.country_code::text as country_code,
           a.birth_year,
           a.death_year,
           a.artwork_count,
           (c.id in (select id from por_pais))       as p_pais,
           (c.id in (select id from por_movimiento))  as p_movimiento,
           -- La época no relaciona por sí sola, pero afina: 25 años es una
           -- generación, que es lo que se quiere decir con «contemporáneos».
           (a.birth_year is not null
             and (select birth_year from yo) is not null
             and abs(a.birth_year - (select birth_year from yo)) <= 25) as p_epoca,
           exists (select 1 from artworks w
                    where w.artist_id = a.id
                      and w.institution_id in (select institution_id from mis_museos)) as p_museo
      from candidatos c
      join artists a on a.id = c.id
      left join artist_translations t on t.artist_id = a.id and t.lang = p_lang
      left join nationality_country nc on nc.raw = a.nationality
     where a.artwork_count > 0
       and a.id <> (select id from yo)
  )
  select p.slug, p.nombre, p.nationality, p.country_code,
         p.birth_year, p.death_year, p.artwork_count,
         p.p_pais, p.p_epoca, p.p_movimiento, p.p_museo
    from puntuados p
   order by (case when p.p_pais then 2 else 0 end)
          + (case when p.p_movimiento then 2 else 0 end)
          + (case when p.p_epoca then 1 else 0 end)
          + (case when p.p_museo then 1 else 0 end) desc,
            -- A igual puntuación, el que más obra tiene en el catálogo: es al
            -- que se puede llegar y ver algo, no un nombre con una estampa.
            p.artwork_count desc,
            p.id
   limit greatest(1, least(coalesce(max_results, 8), 24));
$fn$;

revoke execute on function related_artists(text, text, int) from public;
grant  execute on function related_artists(text, text, int) to anon, authenticated;

comment on function related_artists(text, text, int) is
  'Artistas parecidos a uno dado por país, movimiento, época y museo, con las banderas de por qué. Pesos: país 2, movimiento 2, época 1, museo 1.';
