-- ============================================================================
-- Artlas · catálogo multilingüe
--
-- El esquema 0001 guardaba un idioma incrustado por columna, y encima no se
-- sabía cuál: `artworks.title` venía del label service de Wikidata, que
-- devuelve español SI EXISTE y si no cae a inglés. Medido sobre las primeras
-- 957 obras ingeridas: el 61% de los títulos estaban en inglés.
--
-- Aquí se separan los datos neutros (año, medidas, imagen, coordenadas) de los
-- textos, que pasan a tablas de traducción con una fila por idioma.
--
-- Por qué tablas y no un JSONB con todos los idiomas dentro: la búsqueda.
-- Postgres necesita un diccionario distinto por lengua para que "pinturas"
-- encuentre "pintura" — y el diccionario 'english' no sabe hacer eso en
-- español. Con una fila por idioma, cada una lleva su tsvector construido con
-- SU diccionario. Con JSONB harían falta N columnas generadas y N índices.
-- ============================================================================

set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- Idiomas soportados
--
-- `ts_config` es lo importante: mapea el código ISO al diccionario de Postgres.
-- Añadir un idioma es insertar una fila aquí, no migrar el esquema.
-- ----------------------------------------------------------------------------
create table languages (
  code       text primary key,           -- ISO 639-1: 'es'
  name       text not null,              -- 'Español'
  ts_config  regconfig not null,         -- diccionario de Postgres: 'spanish'
  sort_order int not null default 100
);

insert into languages (code, name, ts_config, sort_order) values
  ('es', 'Español',    'spanish',    1),
  ('en', 'English',    'english',    2),
  ('fr', 'Français',   'french',     3),
  ('it', 'Italiano',   'italian',    4),
  ('de', 'Deutsch',    'german',     5),
  ('pt', 'Português',  'portuguese', 6),
  ('nl', 'Nederlands', 'dutch',      7);

-- ----------------------------------------------------------------------------
-- Traducciones de obras
-- ----------------------------------------------------------------------------
create table artwork_translations (
  artwork_id    bigint not null references artworks(id) on delete cascade,
  lang          text   not null references languages(code) on delete cascade,

  title         text not null,
  description   text,
  medium        text,          -- 'Óleo sobre lienzo' / 'Oil on canvas'
  genre         text,          -- 'retrato' / 'portrait'

  search_vector tsvector,

  primary key (artwork_id, lang)
);

create index artwork_translations_lang_idx   on artwork_translations (lang);
create index artwork_translations_search_idx on artwork_translations using gin (search_vector);
create index artwork_translations_title_trgm on artwork_translations
  using gin (public.immutable_unaccent(title) gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Traducciones de artistas, museos y movimientos
--
-- Los nombres propios TAMBIÉN se traducen, y no es un detalle menor:
--   Albrecht Dürer  -> Alberto Durero (es) / Albert Dürer (fr)
--   Museo del Louvre -> Louvre Museum (en) / Musée du Louvre (fr)
--   posimpresionismo -> Post-Impressionism (en) / postimpressionnisme (fr)
-- ----------------------------------------------------------------------------
create table artist_translations (
  artist_id   bigint not null references artists(id) on delete cascade,
  lang        text   not null references languages(code) on delete cascade,
  name        text not null,
  description text,
  primary key (artist_id, lang)
);

create index artist_translations_lang_idx on artist_translations (lang);
create index artist_translations_name_trgm on artist_translations
  using gin (public.immutable_unaccent(name) gin_trgm_ops);

create table institution_translations (
  institution_id bigint not null references institutions(id) on delete cascade,
  lang           text   not null references languages(code) on delete cascade,
  name           text not null,
  description    text,
  city           text,          -- 'Londres' / 'London'
  country        text,          -- 'Reino Unido' / 'United Kingdom'
  primary key (institution_id, lang)
);

create index institution_translations_lang_idx on institution_translations (lang);
create index institution_translations_name_trgm on institution_translations
  using gin (public.immutable_unaccent(name) gin_trgm_ops);

create table movement_translations (
  movement_id bigint not null references movements(id) on delete cascade,
  lang        text   not null references languages(code) on delete cascade,
  name        text not null,
  description text,
  primary key (movement_id, lang)
);

create index movement_translations_lang_idx on movement_translations (lang);

-- ----------------------------------------------------------------------------
-- Vector de búsqueda con el diccionario del idioma de la fila
-- ----------------------------------------------------------------------------
create or replace function artwork_translations_search_trigger() returns trigger
language plpgsql set search_path = public, extensions as $fn$
declare cfg regconfig;
begin
  select ts_config into cfg from languages where code = new.lang;
  -- Si el idioma no estuviera registrado, 'simple' no lematiza pero tampoco
  -- rompe la inserción.
  cfg := coalesce(cfg, 'simple'::regconfig);

  new.search_vector :=
      setweight(to_tsvector(cfg, public.immutable_unaccent(coalesce(new.title, ''))), 'A')
   || setweight(to_tsvector(cfg, public.immutable_unaccent(coalesce(new.genre, ''))), 'C')
   || setweight(to_tsvector(cfg, public.immutable_unaccent(coalesce(new.medium, ''))), 'C')
   || setweight(to_tsvector(cfg, public.immutable_unaccent(coalesce(new.description, ''))), 'D');

  return new;
end $fn$;

create trigger artwork_translations_search_update
  before insert or update on artwork_translations
  for each row execute function artwork_translations_search_trigger();

-- ----------------------------------------------------------------------------
-- Limpieza del esquema 0001
--
-- Se van las columnas con idioma incrustado. El catálogo entero se regenera
-- con la ingesta, así que no se pierde nada que no sea reproducible.
-- Las tablas de usuario (valoraciones, favoritos) NO se tocan.
-- ----------------------------------------------------------------------------
truncate artwork_movements, artworks, artists, movements, institutions restart identity cascade;

drop trigger if exists artworks_search_update on artworks;
drop function if exists artworks_search_trigger();

alter table artworks
  drop column if exists title_es,
  drop column if exists description,
  drop column if exists genre,
  drop column if exists search_vector;

-- `title` y `medium` se conservan como valor de respaldo neutro: es lo que se
-- muestra si una obra no tiene traducción en NINGUNO de los idiomas pedidos,
-- y lo que da estabilidad al slug de la URL. Se rellenan con el inglés.
comment on column artworks.title is
  'Respaldo neutro (inglés). El texto que se muestra sale de artwork_translations.';
comment on column artworks.medium is
  'Respaldo neutro (inglés). Ver artwork_translations.medium.';

alter table artists     drop column if exists description;
alter table movements   drop column if exists description, drop column if exists name_es;
alter table institutions drop column if exists description;

comment on column artists.name is
  'Respaldo neutro. El nombre localizado sale de artist_translations.';
comment on column institutions.name is
  'Respaldo neutro. El nombre localizado sale de institution_translations.';

-- ----------------------------------------------------------------------------
-- Resolución de idioma con cadena de respaldo
--
-- No toda obra tiene título en los 7 idiomas. La regla es siempre la misma:
-- idioma pedido -> inglés -> cualquiera que exista -> respaldo neutro.
-- Está centralizada aquí para que la app no la reimplemente en cada consulta.
-- ----------------------------------------------------------------------------
create or replace function artwork_title(p_artwork_id bigint, p_lang text)
returns text language sql stable set search_path = public, extensions as $fn$
  select coalesce(
    (select t.title from artwork_translations t
      where t.artwork_id = p_artwork_id and t.lang = p_lang),
    (select t.title from artwork_translations t
      where t.artwork_id = p_artwork_id and t.lang = 'en'),
    (select t.title from artwork_translations t
      where t.artwork_id = p_artwork_id
      order by (select sort_order from languages where code = t.lang) limit 1),
    (select a.title from artworks a where a.id = p_artwork_id)
  )
$fn$;

-- ----------------------------------------------------------------------------
-- Consultas que la app usa constantemente, ahora localizadas
-- ----------------------------------------------------------------------------

drop function if exists artworks_near(double precision, double precision, int, text, int);

/**
 * "¿Qué hay cerca de mí?" — obras dentro de un radio, en el idioma pedido.
 *
 * Los LEFT JOIN LATERAL con la cadena de respaldo por COALESCE resuelven el
 * idioma sin descartar obras: una obra sin traducción al neerlandés sigue
 * apareciendo, con su título en inglés.
 */
create or replace function artworks_near(
  lat           double precision,
  lng           double precision,
  p_lang        text default 'es',
  radius_m      int  default 5000,
  movement_slug text default null,
  max_results   int  default 100
)
returns table (
  id bigint, title text, slug text, image_url text, year_start int, date_display text,
  artist_name text, institution_name text, institution_slug text,
  distance_m double precision
)
language sql stable set search_path = public, extensions as $fn$
  select a.id,
         coalesce(tw.title, tw_en.title, a.title),
         a.slug, a.image_url, a.year_start, a.date_display,
         coalesce(ta.name, ar.name),
         coalesce(ti.name, i.name),
         i.slug,
         st_distance(a.location, st_makepoint(lng, lat)::geography)
    from artworks a
    left join artists ar     on ar.id = a.artist_id
    left join institutions i on i.id  = a.institution_id
    left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
    left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
    left join artist_translations ta     on ta.artist_id = ar.id and ta.lang = p_lang
    left join institution_translations ti on ti.institution_id = i.id and ti.lang = p_lang
   where a.image_url is not null
     and st_dwithin(a.location, st_makepoint(lng, lat)::geography, radius_m)
     and (movement_slug is null or exists (
           select 1 from artwork_movements am
             join movements m on m.id = am.movement_id
            where am.artwork_id = a.id and m.slug = movement_slug))
   order by a.notability desc,
            st_distance(a.location, st_makepoint(lng, lat)::geography) asc
   limit max_results
$fn$;

drop function if exists institutions_in_bbox(double precision, double precision, double precision, double precision);

create or replace function institutions_in_bbox(
  west double precision, south double precision,
  east double precision, north double precision,
  p_lang text default 'es'
)
returns table (
  id bigint, name text, slug text, city text, country text,
  lat double precision, lng double precision,
  artwork_count int, rating_avg numeric
)
language sql stable set search_path = public, extensions as $fn$
  select i.id,
         coalesce(ti.name, i.name),
         i.slug,
         coalesce(ti.city, i.city),
         coalesce(ti.country, i.country),
         st_y(i.location::geometry), st_x(i.location::geometry),
         i.artwork_count, i.rating_avg
    from institutions i
    left join institution_translations ti
      on ti.institution_id = i.id and ti.lang = p_lang
   where i.artwork_count > 0
     and st_intersects(i.location,
           st_makeenvelope(west, south, east, north, 4326)::geography)
   order by i.artwork_count desc
$fn$;

/**
 * Buscador principal del catálogo.
 *
 * Busca en el idioma pedido usando SU diccionario, y ordena por relevancia
 * combinada con notoriedad: entre dos coincidencias igual de buenas, gana la
 * obra más conocida, que es lo que el usuario espera ver primero.
 */
create or replace function search_artworks(
  p_query       text,
  p_lang        text default 'es',
  p_movement    text default null,
  p_artist      text default null,
  p_country     text default null,
  p_year_from   int  default null,
  p_year_to     int  default null,
  p_category    text default null,
  max_results   int  default 50
)
returns table (
  id bigint, title text, slug text, image_url text,
  year_start int, date_display text, category text,
  artist_name text, artist_slug text,
  institution_name text, institution_slug text, city text, country text,
  notability int, rank real
)
language sql stable set search_path = public, extensions as $fn$
  with cfg as (
    select coalesce(
      (select ts_config from languages where code = p_lang), 'simple'::regconfig
    ) as ts
  ),
  q as (
    select case
      when p_query is null or btrim(p_query) = '' then null
      else websearch_to_tsquery((select ts from cfg), public.immutable_unaccent(p_query))
    end as tsq
  )
  select a.id,
         coalesce(tw.title, tw_en.title, a.title),
         a.slug, a.image_url, a.year_start, a.date_display, a.category,
         coalesce(ta.name, ar.name), ar.slug,
         coalesce(ti.name, i.name), i.slug,
         coalesce(ti.city, i.city), coalesce(ti.country, i.country),
         a.notability,
         case when (select tsq from q) is null then 0::real
              else ts_rank(tw.search_vector, (select tsq from q)) end
    from artworks a
    left join artists ar     on ar.id = a.artist_id
    left join institutions i on i.id  = a.institution_id
    left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
    left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
    left join artist_translations ta     on ta.artist_id = ar.id and ta.lang = p_lang
    left join institution_translations ti on ti.institution_id = i.id and ti.lang = p_lang
   where ((select tsq from q) is null or tw.search_vector @@ (select tsq from q))
     and (p_movement is null or exists (
           select 1 from artwork_movements am join movements m on m.id = am.movement_id
            where am.artwork_id = a.id and m.slug = p_movement))
     and (p_artist    is null or ar.slug = p_artist)
     and (p_country   is null or i.country_code = upper(p_country))
     and (p_year_from is null or a.year_start >= p_year_from)
     and (p_year_to   is null or a.year_start <= p_year_to)
     and (p_category  is null or a.category = p_category)
   order by
     case when (select tsq from q) is null then 0::real
          else ts_rank(tw.search_vector, (select tsq from q)) end desc,
     a.notability desc
   limit max_results
$fn$;

-- ----------------------------------------------------------------------------
-- Seguridad: las traducciones son catálogo, es decir, públicas de lectura.
-- ----------------------------------------------------------------------------
alter table languages                enable row level security;
alter table artwork_translations     enable row level security;
alter table artist_translations      enable row level security;
alter table institution_translations enable row level security;
alter table movement_translations    enable row level security;

create policy "catalogo publico" on languages                for select using (true);
create policy "catalogo publico" on artwork_translations     for select using (true);
create policy "catalogo publico" on artist_translations      for select using (true);
create policy "catalogo publico" on institution_translations for select using (true);
create policy "catalogo publico" on movement_translations    for select using (true);
