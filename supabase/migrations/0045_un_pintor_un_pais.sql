-- ============================================================================
-- Artlas · 0045 — un pintor, un país
--
-- Rembrandt es «Dutch Republic» y Van Gogh «Kingdom of the Netherlands», así
-- que hasta hoy no se relacionaban: para el filtro eran dos sitios distintos.
-- Los Países Bajos estaban en cinco cubos —Dutch Republic (532), Habsburg
-- Netherlands (264), Southern Netherlands (155), Kingdom of the Netherlands
-- (145) y Netherlands (102)—, el Reino Unido en tres y China en cinco
-- dinastías. Filtrar por país de origen no servía de gran cosa.
--
-- La causa está en el dato: la ingesta guarda de P27 solo la etiqueta inglesa
-- del ESTADO en que nació la persona, y en Europa eso cambia cada dos siglos.
-- Arreglarlo en origen sería guardar el QID y volver a pasar por los 21.619
-- artistas; esto lo arregla sin tocarlos, con una tabla de equivalencias.
--
-- ## Es una tabla y no una regla, a propósito
--
-- No hay forma de deducir de «Republic of Venice» que hoy es Italia: hace falta
-- saberlo. Así que esto es criterio escrito a mano —como los museos— y vive en
-- una tabla para poder corregirse sin tocar código. Son 200 filas repasadas una
-- a una, y cubren el **96% de los artistas** (9.486 de 9.861).
--
-- De esas 200, 38 las puso la máquina: los nombres que el propio `Intl` del
-- navegador reconoce como países vigentes. Las otras 162 son estados que ya no
-- existen, y ahí hubo que decidir.
--
-- ## Lo que NO se agrupa, y por qué
--
-- Veinte etiquetas se quedan como están, y están escritas en la tabla **con su
-- motivo** en vez de simplemente faltar: una fila ausente parece un olvido; una
-- fila que dice por qué es una decisión. Cada una abarcaba territorio que hoy
-- son varios países, y meterla en uno sería afirmar de una persona algo que no
-- se sabe.
--
-- La mayor con diferencia es **Habsburg Netherlands, con 264 artistas**: las
-- diecisiete provincias, que hoy son Países Bajos y Bélgica. Ahí caen Brueghel
-- y El Bosco, y no son del mismo país actual. Eso no se arregla con una regla
-- mejor: se arregla mirando quién es cada uno, o guardando el QID en la ingesta.
--
-- ## Qué cambia de las funciones
--
--   · `list_nationalities` agrupa por país y devuelve su código; lo que no se
--     agrupa sale con su etiqueta cruda y sin código, como hasta ahora.
--   · `list_artists` acepta en `p_nat` **un código o una etiqueta**. No chocan:
--     ninguna etiqueta de la tabla tiene dos letras.
--   · `get_artist` y `list_artists` devuelven también el código, para que la
--     ficha enlace al grupo y no a la etiqueta suelta.
--
-- El nombre que se lee no sale de aquí: sale de `Intl`, en el idioma de quien
-- mira. Esta tabla solo dice a qué país pertenece cada etiqueta.
-- ============================================================================

set search_path = public, extensions;

create table if not exists nationality_country (
  raw          text primary key,
  country_code char(2),
  -- Por qué se deja sin agrupar. Solo se rellena cuando `country_code` es null:
  -- una fila sin código y sin motivo sería un olvido y no se distinguiría.
  note         text,
  constraint nationality_country_motivo
    check (country_code is not null or note is not null)
);

comment on table nationality_country is
  'Equivalencia entre la etiqueta de nacionalidad de Wikidata y el país de hoy. Repasada a mano; sin código = no se puede decidir, y `note` dice por qué.';

alter table nationality_country enable row level security;

drop policy if exists nationality_country_lectura on nationality_country;
create policy nationality_country_lectura on nationality_country
  for select using (true);

insert into nationality_country (raw, country_code, note) values
  ('Anhalt-Dessau', 'DE', null),
  ('Anhalt-Köthen', 'DE', null),
  ('Archduchy of Austria', 'AT', null),
  ('Ashikaga shogunate', 'JP', null),
  ('Australia', 'AU', null),
  ('Austria', 'AT', null),
  ('Austrian Empire', 'AT', null),
  ('Austrian Netherlands', 'BE', null),
  ('Babylonia', 'IQ', null),
  ('Belgium', 'BE', null),
  ('Bijapur Sultanate', 'IN', null),
  ('Bikaner State', 'IN', null),
  ('Bolivia', 'BO', null),
  ('Bologna', 'IT', null),
  ('Brazil', 'BR', null),
  ('Bremen', 'DE', null),
  ('British North America', 'CA', null),
  ('Burgundian Netherlands', 'BE', null),
  ('Canada', 'CA', null),
  ('Captaincy General of the Philippines', 'PH', null),
  ('Catalan countries', 'ES', null),
  ('Chile', 'CL', null),
  ('China', 'CN', null),
  ('Chinese Empire', 'CN', null),
  ('Classical Athens', 'GR', null),
  ('Cornwall', 'GB', null),
  ('Corona de Castilla', 'ES', null),
  ('County of Burgundy', 'FR', null),
  ('County of Flanders', 'BE', null),
  ('County of Holland', 'NL', null),
  ('Cremona', 'IT', null),
  ('Croatia', 'HR', null),
  ('Crown of Aragon', 'ES', null),
  ('Cuba', 'CU', null),
  ('Dai-Nippon Teikoku', 'JP', null),
  ('Delian League', 'GR', null),
  ('Deutsches Kaiserreich', 'DE', null),
  ('Deutsches Reich', 'DE', null),
  ('Ducato di Milano', 'IT', null),
  ('Duchy of Bavaria', 'DE', null),
  ('Duchy of Brunswick', 'DE', null),
  ('Duchy of Cleves', 'DE', null),
  ('Duchy of Ferrara', 'IT', null),
  ('Duchy of Florence', 'IT', null),
  ('Duchy of Holstein', 'DE', null),
  ('Duchy of Lorraine', 'FR', null),
  ('Duchy of Mantua', 'IT', null),
  ('Duchy of Milan', 'IT', null),
  ('Duchy of Modena and Reggio', 'IT', null),
  ('Duchy of Savoy', 'IT', null),
  ('Duchy of Saxe-Meiningen', 'DE', null),
  ('Duchy of Urbino', 'IT', null),
  ('Duchy of Warsaw', 'PL', null),
  ('Duchy of Württemberg', 'DE', null),
  ('Dutch East Indies', 'ID', null),
  ('Dutch Republic', 'NL', null),
  ('El Salvador', 'SV', null),
  ('Electoral Palatinate', 'DE', null),
  ('Electorate of Bavaria', 'DE', null),
  ('Electorate of Hesse', 'DE', null),
  ('Electorate of Mainz', 'DE', null),
  ('Electorate of Saxony', 'DE', null),
  ('England', 'GB', null),
  ('Estonia', 'EE', null),
  ('Finland', 'FI', null),
  ('Firenze', 'IT', null),
  ('Flanders', 'BE', null),
  ('France', 'FR', null),
  ('Frankfurt am Main', 'DE', null),
  ('Frankfurt', 'DE', null),
  ('Free City of Frankfurt', 'DE', null),
  ('Free City of Kraków', 'PL', null),
  ('French Canada', 'CA', null),
  ('German Confederation', 'DE', null),
  ('German Empire', 'DE', null),
  ('German Reich', 'DE', null),
  ('Germany', 'DE', null),
  ('Goryeo', 'KR', null),
  ('Grand Duchy of Baden', 'DE', null),
  ('Grand Duchy of Finland', 'FI', null),
  ('Grand Duchy of Hesse', 'DE', null),
  ('Grand Duchy of Mecklenburg-Schwerin', 'DE', null),
  ('Grand Duchy of Tuscany', 'IT', null),
  ('Greece', 'GR', null),
  ('Guler State', 'IN', null),
  ('Hamburg', 'DE', null),
  ('Holland', 'NL', null),
  ('Hungary', 'HU', null),
  ('India', 'IN', null),
  ('Iran', 'IR', null),
  ('Ireland', 'IE', null),
  ('Italy', 'IT', null),
  ('Japan', 'JP', null),
  ('Joseon', 'KR', null),
  ('Kaisertum Österreich', 'AT', null),
  ('Kangra-Lambagraon', 'IN', null),
  ('Kingdom of Aragon', 'ES', null),
  ('Kingdom of Bavaria', 'DE', null),
  ('Kingdom of Bohemia', 'CZ', null),
  ('Kingdom of Castile', 'ES', null),
  ('Kingdom of Denmark', 'DK', null),
  ('Kingdom of England', 'GB', null),
  ('Kingdom of France', 'FR', null),
  ('Kingdom of Granada', 'ES', null),
  ('Kingdom of Great Britain', 'GB', null),
  ('Kingdom of Hanover', 'DE', null),
  ('Kingdom of Ireland', 'IE', null),
  ('Kingdom of Italy', 'IT', null),
  ('Kingdom of Lombardy–Venetia', 'IT', null),
  ('Kingdom of Mewar', 'IN', null),
  ('Kingdom of Naples', 'IT', null),
  ('Kingdom of Poland', 'PL', null),
  ('Kingdom of Portugal', 'PT', null),
  ('Kingdom of Prussia', 'DE', null),
  ('Kingdom of Saxony', 'DE', null),
  ('Kingdom of Scotland', 'GB', null),
  ('Kingdom of Sicily', 'IT', null),
  ('Kingdom of Spain', 'ES', null),
  ('Kingdom of Valencia', 'ES', null),
  ('Kingdom of Württemberg', 'DE', null),
  ('Kingdom of the Netherlands', 'NL', null),
  ('Korea', 'KR', null),
  ('Kota State', 'IN', null),
  ('Kurpalz', 'DE', null),
  ('Königreich Hannover', 'DE', null),
  ('Königreich Preußen', 'DE', null),
  ('Königreich Württemberg', 'DE', null),
  ('Landgraviate of Hesse-Kassel', 'DE', null),
  ('Latvia', 'LV', null),
  ('Lombard duchy of Parma', 'IT', null),
  ('Lordship of Bologna', 'IT', null),
  ('Lübeck', 'DE', null),
  ('Malta', 'MT', null),
  ('Mamluk Sultanate of Egypt', 'EG', null),
  ('Mexico', 'MX', null),
  ('Ming dynasty', 'CN', null),
  ('Mughal Empire', 'IN', null),
  ('Nazi Germany', 'DE', null),
  ('Netherlands', 'NL', null),
  ('New Spain', 'MX', null),
  ('Northern Low Countries', 'NL', null),
  ('Norway', 'NO', null),
  ('Nurpur kingdom', 'IN', null),
  ('Papal States', 'IT', null),
  ('People''s Republic of China', 'CN', null),
  ('Peru', 'PE', null),
  ('Philippines', 'PH', null),
  ('Poland', 'PL', null),
  ('Portugal', 'PT', null),
  ('Premier Empire', 'FR', null),
  ('Prince-Bishopric of Fulda', 'DE', null),
  ('Prince-Bishopric of Liège', 'BE', null),
  ('Principality of Reuss-Gera', 'DE', null),
  ('Principality of Waldeck', 'DE', null),
  ('Prussia', 'DE', null),
  ('Qajar Iran', 'IR', null),
  ('Qing dynasty', 'CN', null),
  ('Regno ''e Napule', 'IT', null),
  ('Reino de Portugal', 'PT', null),
  ('Republic of Florence', 'IT', null),
  ('Republic of Geneva', 'CH', null),
  ('Republic of Genoa', 'IT', null),
  ('Republic of Lucca', 'IT', null),
  ('Republic of Pisa', 'IT', null),
  ('Republic of Siena', 'IT', null),
  ('Republic of Venice', 'IT', null),
  ('Rhodes', 'GR', null),
  ('Romania', 'RO', null),
  ('Russian Empire', 'RU', null),
  ('Russian Soviet Federative Socialist Republic', 'RU', null),
  ('Safavid Iran', 'IR', null),
  ('Saxe-Coburg and Gotha', 'DE', null),
  ('Saxe-Weimar-Eisenach', 'DE', null),
  ('Scotland', 'GB', null),
  ('Second Athenian League', 'GR', null),
  ('Second Polish Republic', 'PL', null),
  ('Signoria di Correggio', 'IT', null),
  ('Song dynasty', 'CN', null),
  ('Southern Netherlands', 'BE', null),
  ('Spain', 'ES', null),
  ('Spanish Netherlands', 'BE', null),
  ('Status Pontificius', 'IT', null),
  ('Suomen suuriruhtinaskunta', 'FI', null),
  ('Sweden', 'SE', null),
  ('Switzerland', 'CH', null),
  ('Tang dynasty', 'CN', null),
  ('Thirteen Colonies', 'US', null),
  ('Tokugawa shogunate', 'JP', null),
  ('United Kingdom of Great Britain and Ireland', 'GB', null),
  ('United Kingdom', 'GB', null),
  ('United States', 'US', null),
  ('Uruguay', 'UY', null),
  ('Viceroyalty of Peru', 'PE', null),
  ('Wales', 'GB', null),
  ('Weimar Republic', 'DE', null),
  ('Weimarer Republik', 'DE', null),
  ('Yang Wu', 'CN', null),
  ('Yuan dynasty', 'CN', null),
  ('Zand Iran', 'IR', null),
  ('history of Genoa', 'IT', null),

-- Las que no se agrupan, con su motivo.
  ('Habsburg Netherlands', null, 'las diecisiete provincias: hoy Países Bajos y Bélgica'),
  ('Seventeen Provinces', null, 'lo mismo que Habsburg Netherlands'),
  ('Holy Roman Empire', null, 'de los Países Bajos a Italia'),
  ('Habsburg monarchy', null, 'lo que luego fue Austria-Hungría'),
  ('Austria–Hungary', null, 'AT, HU, CZ, SK, HR y más'),
  ('Cisleithania', null, 'la mitad occidental de Austria-Hungría'),
  ('Soviet Union', null, 'quince repúblicas'),
  ('Polish–Lithuanian Commonwealth', null, 'PL, LT, BY, UA'),
  ('Czechoslovakia', null, 'CZ y SK'),
  ('Ottoman Empire', null, 'de los Balcanes a Egipto'),
  ('Duchy of Brabant', null, 'hoy Bélgica y Países Bajos'),
  ('Low Countries', null, 'NL, BE, LU'),
  ('Duchy of Burgundy', null, 'FR, BE, NL'),
  ('Burgundian State', null, 'FR, BE, NL'),
  ('Swedish Pomerania', null, 'hoy Alemania y Polonia'),
  ('British Empire', null, 'medio mundo'),
  ('British Raj', null, 'IN, PK, BD, MM'),
  ('Kingdom of Pergamon', null, 'Anatolia antigua'),
  ('Pundravardhana', null, 'Bengala antigua: IN y BD'),
  ('Q25934646', null, 'un QID que la ingesta no llegó a resolver')
on conflict (raw) do update
  set country_code = excluded.country_code, note = excluded.note;

-- Se busca por código, no por etiqueta: el índice va donde va el filtro.
create index if not exists nationality_country_code_idx
  on nationality_country (country_code) where country_code is not null;

-- ---------------------------------------------------------------------------
-- Las funciones
-- ---------------------------------------------------------------------------

/**
 * Las nacionalidades que hay, ya agrupadas por país, con su recuento.
 *
 * `value` es lo que viaja en la URL del filtro: el código del país cuando se
 * agrupa, y la etiqueta cruda cuando no. `country_code` viene aparte para que
 * la pantalla sepa si tiene que traducir el nombre o dejarlo como está.
 */
drop function if exists list_nationalities();

create or replace function list_nationalities()
returns table (value text, country_code text, artists bigint)
language sql stable security definer set search_path = public, extensions as $fn$
  select coalesce(nc.country_code, a.nationality) as value,
         nc.country_code::text,
         count(*) as artists
    from artists a
    left join nationality_country nc on nc.raw = a.nationality
   where a.artwork_count > 0 and a.nationality is not null
   group by coalesce(nc.country_code, a.nationality), nc.country_code
   order by count(*) desc, 1;
$fn$;

/*
 * `list_artists` gana el código de país en la salida y lo entiende en `p_nat`.
 *
 * Se tira la de 0036 antes de crearla: aquí no cambian los argumentos sino lo
 * que DEVUELVE, y eso `create or replace` no lo admite —«cannot change return
 * type of existing function»—.
 */
drop function if exists list_artists(text, text, text, text, integer, integer, text, integer, integer);

create or replace function list_artists(
  p_lang   text    default 'es',
  p_q      text    default null,
  p_sort   text    default 'works',
  p_dir    text    default 'desc',
  p_limit  integer default 60,
  p_offset integer default 0,
  p_nat    text    default null,
  p_desde  integer default null,
  p_hasta  integer default null
)
returns table (
  slug             text,
  name             text,
  nationality      text,
  nationality_code text,
  birth_year       integer,
  death_year       integer,
  artwork_count    integer,
  total            bigint
)
language sql stable security definer set search_path = public, extensions as $fn$
  with visibles as (
    select a.id,
           a.slug,
           coalesce(t.name, a.name) as nombre,
           a.nationality,
           nc.country_code::text as country_code,
           a.birth_year,
           a.death_year,
           a.artwork_count
      from artists a
      left join artist_translations t
        on t.artist_id = a.id and t.lang = p_lang
      left join nationality_country nc on nc.raw = a.nationality
     where a.artwork_count > 0
       -- Un código o una etiqueta. No chocan: ninguna etiqueta tiene dos letras.
       and (p_nat is null or a.nationality = p_nat or nc.country_code = p_nat)
       and (p_desde is null or a.birth_year >= p_desde)
       and (p_hasta is null or a.birth_year <= p_hasta)
  ),
  filtrados as (
    select * from visibles
     where coalesce(btrim(p_q), '') = ''
        or immutable_unaccent(nombre) ilike immutable_unaccent('%' || btrim(p_q) || '%')
  )
  select f.slug,
         f.nombre,
         f.nationality,
         f.country_code,
         f.birth_year,
         f.death_year,
         f.artwork_count,
         count(*) over () as total
    from filtrados f
   order by
     -- La lista blanca vive en el propio `order by`: un `p_sort` inventado cae
     -- en el desempate por id en vez de ordenar por algo raro. Interpolar el
     -- nombre de una columna que viene de una URL es regalar una inyección.
     case when p_sort = 'name'  and p_dir = 'asc'  then immutable_unaccent(f.nombre) end asc  nulls last,
     case when p_sort = 'name'  and p_dir = 'desc' then immutable_unaccent(f.nombre) end desc nulls last,
     case when p_sort = 'nat'   and p_dir = 'asc'  then f.nationality   end asc  nulls last,
     case when p_sort = 'nat'   and p_dir = 'desc' then f.nationality   end desc nulls last,
     case when p_sort = 'anios' and p_dir = 'asc'  then f.birth_year    end asc  nulls last,
     case when p_sort = 'anios' and p_dir = 'desc' then f.birth_year    end desc nulls last,
     case when p_sort = 'works' and p_dir = 'asc'  then f.artwork_count end asc  nulls last,
     case when p_sort = 'works' and p_dir = 'desc' then f.artwork_count end desc nulls last,
     f.id
   limit  greatest(1, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;

/* La ficha del artista, con el código de su país para poder enlazar al grupo. */
drop function if exists get_artist(text, text);

create or replace function get_artist(p_slug text, p_lang text default 'es')
returns table (
  id bigint, slug text, name text, description text,
  birth_year int, death_year int, nationality text, nationality_code text,
  image_url text, artwork_count int
)
language sql stable set search_path = public, extensions as $fn$
  select ar.id, ar.slug,
         coalesce(ta.name, ta_en.name, ar.name),
         coalesce(ta.description, ta_en.description),
         ar.birth_year, ar.death_year, ar.nationality, nc.country_code::text,
         ar.image_url, ar.artwork_count
    from artists ar
    left join artist_translations ta    on ta.artist_id = ar.id and ta.lang = p_lang
    left join artist_translations ta_en on ta_en.artist_id = ar.id and ta_en.lang = 'en'
    left join nationality_country nc    on nc.raw = ar.nationality
   where ar.slug = p_slug
   order by ar.artwork_count desc
   limit 1
$fn$;

revoke execute on function list_artists(text, text, text, text, integer, integer, text, integer, integer) from public;
grant  execute on function list_artists(text, text, text, text, integer, integer, text, integer, integer) to anon, authenticated;
revoke execute on function list_nationalities() from public;
grant  execute on function list_nationalities() to anon, authenticated;
grant  execute on function get_artist(text, text) to anon, authenticated;

comment on function list_nationalities() is
  'Países del catálogo con su recuento, ya agrupados. `value` es lo que va en la URL: el código ISO, o la etiqueta cruda si no se pudo agrupar.';
