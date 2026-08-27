-- ============================================================================
-- Artlas · esquema inicial
-- Postgres 15 + PostGIS. Catálogo de obras de arte geolocalizadas.
--
-- Modelo: una OBRA la hizo un ARTISTA, pertenece a uno o varios MOVIMIENTOS
-- y hoy se expone en una INSTITUCIÓN, que está en un punto del mapa.
-- Los usuarios puntúan obras e instituciones y marcan visitas.
-- ============================================================================

/*
 * Supabase instala las extensiones en el esquema `extensions`, no en `public`.
 * Por eso todo lo que las usa (tipos geography, operadores gin_trgm_ops,
 * unaccent) necesita `extensions` en el search_path, tanto al aplicar esta
 * migración como al ejecutar las funciones después.
 */
create schema if not exists extensions;
set search_path = public, extensions;

create extension if not exists postgis  with schema extensions;
create extension if not exists pg_trgm  with schema extensions;  -- búsqueda difusa
create extension if not exists unaccent with schema extensions;  -- "Dalí" == "Dali"

-- unaccent es STABLE, no IMMUTABLE, así que no se puede usar en un índice.
-- Este envoltorio lo declara IMMUTABLE, que es correcto siempre que no se
-- cambie el diccionario de unaccent (no lo hacemos).
create or replace function public.immutable_unaccent(text)
returns text language sql immutable strict parallel safe
set search_path = public, extensions as
$fn$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $fn$;

-- Slug estable para URLs: "Las Meninas" -> "las-meninas"
create or replace function public.slugify(text)
returns text language sql immutable strict parallel safe
set search_path = public, extensions as $fn$
  select trim(both '-' from regexp_replace(
           lower(public.immutable_unaccent($1)), '[^a-z0-9]+', '-', 'g'))
$fn$;

-- ----------------------------------------------------------------------------
-- Instituciones (museos, galerías, colecciones) — los pines del mapa
-- ----------------------------------------------------------------------------
create table institutions (
  id            bigint generated always as identity primary key,
  wikidata_qid  text unique,                       -- 'Q19675'
  name          text not null,
  slug          text not null,
  kind          text not null default 'museum'
                check (kind in ('museum','gallery','church','palace','public_space','private','other')),

  city          text,
  region        text,
  country       text,
  country_code  char(2),                           -- ISO-3166-1 alpha-2
  address       text,

  -- El corazón geográfico. geography(4326) => distancias reales en metros.
  location      geography(Point, 4326),

  website       text,
  image_url     text,
  visitors_year int,                               -- P1174, para ordenar por relevancia
  description   text,

  -- Denormalizado: lo lee cada tarjeta del mapa, no compensa un COUNT por pin.
  artwork_count int not null default 0,
  rating_avg    numeric(3,2),
  rating_count  int not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index institutions_slug_idx     on institutions (slug);
create index institutions_location_idx on institutions using gist (location);
create index institutions_country_idx  on institutions (country_code);
create index institutions_name_trgm    on institutions using gin (public.immutable_unaccent(name) gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Artistas
-- ----------------------------------------------------------------------------
create table artists (
  id             bigint generated always as identity primary key,
  wikidata_qid   text unique,
  name           text not null,
  -- Tampoco único: dos entidades distintas de Wikidata comparten nombre a
  -- menudo ("Maestro de...", homónimos). La identidad la da wikidata_qid.
  slug           text not null,
  sort_name      text,                             -- 'Picasso, Pablo'
  birth_year     int,
  death_year     int,
  nationality    text,
  country_code   char(2),
  image_url      text,
  description    text,
  artwork_count  int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index artists_slug_idx  on artists (slug);
create index artists_name_trgm on artists using gin (public.immutable_unaccent(name) gin_trgm_ops);
create index artists_years_idx on artists (birth_year, death_year);

-- ----------------------------------------------------------------------------
-- Movimientos pictóricos (Impresionismo, Cubismo…)
-- ----------------------------------------------------------------------------
create table movements (
  id            bigint generated always as identity primary key,
  wikidata_qid  text unique,
  name          text not null,
  slug          text not null,
  name_es       text,
  start_year    int,
  end_year      int,
  description   text,
  artwork_count int not null default 0
);

create index movements_slug_idx on movements (slug);

-- ----------------------------------------------------------------------------
-- Obras
-- ----------------------------------------------------------------------------
create table artworks (
  id             bigint generated always as identity primary key,
  wikidata_qid   text unique,

  title          text not null,
  title_es       text,
  slug           text not null,
  artist_id      bigint references artists(id) on delete set null,
  institution_id bigint references institutions(id) on delete set null,

  -- Rango, no año único: "c. 1503-1519" es lo normal en arte.
  year_start     int,
  year_end       int,
  date_display   text,                             -- 'c. 1503–1519'

  category       text not null default 'painting'
                 check (category in ('painting','sculpture','drawing','print',
                                     'photograph','installation','decorative','other')),
  medium         text,                             -- 'Óleo sobre lienzo'
  genre          text,                             -- retrato, paisaje, bodegón…
  height_cm      numeric(8,2),
  width_cm       numeric(8,2),

  -- Imágenes: preferimos IIIF (permite zoom y recortes sin servir el original).
  image_url      text,
  iiif_base      text,                             -- 'https://www.artic.edu/iiif/2/<id>'
  image_license  text,

  -- Procedencia del dato, para poder re-sincronizar y auditar.
  source         text not null
                 check (source in ('wikidata','aic','met','harvard','europeana','manual')),
  source_id      text,
  source_url     text,

  -- Proxy de "obra importante": nº de wikipedias que la enlazan.
  -- Es lo que ordena resultados y decide qué entra en el catálogo curado.
  notability     int not null default 0,

  description    text,
  rating_avg     numeric(3,2),
  rating_count   int not null default 0,

  -- Copia de la geometría del museo. Duplicado a propósito: el mapa consulta
  -- el catálogo entero por bbox y no queremos un join a institutions por tile.
  location       geography(Point, 4326),

  search_vector  tsvector,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (source, source_id)
);

create index artworks_artist_idx      on artworks (artist_id);
create index artworks_institution_idx on artworks (institution_id);
create index artworks_year_idx        on artworks (year_start);
create index artworks_category_idx    on artworks (category);
create index artworks_notability_idx  on artworks (notability desc);
create index artworks_search_idx      on artworks using gin (search_vector);
create index artworks_title_trgm      on artworks using gin (public.immutable_unaccent(title) gin_trgm_ops);
/*
 * El slug NO es único, y es deliberado: Monet tiene 38 pinturas tituladas
 * "Water Lilies" y otras 36 "Water-Lilies". Un índice único sobre
 * (slug, artist_id) rechazaría 37 de cada 38 a mitad de ingesta.
 * Las URLs llevan el id delante: /obra/1234-water-lilies
 */
create index artworks_slug_idx on artworks (slug);

-- Índice del caso de uso estrella: "obras cerca de aquí" siempre con imagen.
create index artworks_map_idx on artworks using gist (location)
  where image_url is not null;

-- Mantiene el vector de búsqueda al día sin tocar el código de ingesta.
create or replace function artworks_search_trigger() returns trigger
language plpgsql set search_path = public, extensions as $fn$
begin
  new.search_vector :=
      setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(new.title, ''))), 'A')
   || setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(new.title_es, ''))), 'A')
   || setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(new.medium, ''))), 'C')
   || setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(new.description, ''))), 'D');
  new.updated_at := now();
  return new;
end $fn$;

create trigger artworks_search_update
  before insert or update on artworks
  for each row execute function artworks_search_trigger();

-- ----------------------------------------------------------------------------
-- Obra <-> movimiento (una obra puede ser cubista Y surrealista)
-- ----------------------------------------------------------------------------
create table artwork_movements (
  artwork_id  bigint not null references artworks(id) on delete cascade,
  movement_id bigint not null references movements(id) on delete cascade,
  primary key (artwork_id, movement_id)
);
create index artwork_movements_movement_idx on artwork_movements (movement_id);

-- ----------------------------------------------------------------------------
-- Capa de usuarios: notas, favoritos, museos visitados
-- ----------------------------------------------------------------------------
create table artwork_ratings (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  artwork_id bigint not null references artworks(id) on delete cascade,
  score      smallint not null check (score between 1 and 10),
  review     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, artwork_id)
);
create index artwork_ratings_artwork_idx on artwork_ratings (artwork_id);

create table institution_ratings (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  institution_id bigint not null references institutions(id) on delete cascade,
  score          smallint not null check (score between 1 and 10),
  review         text,
  visited_on     date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, institution_id)
);
create index institution_ratings_inst_idx on institution_ratings (institution_id);

create table favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  artwork_id bigint not null references artworks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, artwork_id)
);

-- ----------------------------------------------------------------------------
-- Recalcular medias al votar. Evita un AVG() en cada lectura de ficha.
-- ----------------------------------------------------------------------------
create or replace function refresh_artwork_rating() returns trigger
language plpgsql as $fn$
declare target bigint := coalesce(new.artwork_id, old.artwork_id);
begin
  update artworks a
     set rating_avg = s.avg_score, rating_count = s.n
    from (select avg(score)::numeric(3,2) avg_score, count(*) n
            from artwork_ratings where artwork_id = target) s
   where a.id = target;
  return null;
end $fn$;

create trigger artwork_ratings_refresh
  after insert or update or delete on artwork_ratings
  for each row execute function refresh_artwork_rating();

create or replace function refresh_institution_rating() returns trigger
language plpgsql as $fn$
declare target bigint := coalesce(new.institution_id, old.institution_id);
begin
  update institutions i
     set rating_avg = s.avg_score, rating_count = s.n
    from (select avg(score)::numeric(3,2) avg_score, count(*) n
            from institution_ratings where institution_id = target) s
   where i.id = target;
  return null;
end $fn$;

create trigger institution_ratings_refresh
  after insert or update or delete on institution_ratings
  for each row execute function refresh_institution_rating();

-- ----------------------------------------------------------------------------
-- Consultas que la app usa constantemente, encapsuladas como RPC.
-- ----------------------------------------------------------------------------

-- "¿Qué hay cerca de mí?" — obras dentro de un radio, ordenadas por relevancia.
create or replace function artworks_near(
  lat double precision,
  lng double precision,
  radius_m int default 5000,
  movement_slug text default null,
  max_results int default 100
)
returns table (
  id bigint, title text, slug text, image_url text, year_start int,
  artist_name text, institution_name text, institution_slug text,
  distance_m double precision
)
language sql stable
set search_path = public, extensions as $fn$
  select a.id, a.title, a.slug, a.image_url, a.year_start,
         ar.name, i.name, i.slug,
         st_distance(a.location, st_makepoint(lng, lat)::geography)
    from artworks a
    left join artists ar      on ar.id = a.artist_id
    left join institutions i  on i.id  = a.institution_id
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

-- Pines del mapa: agrega por institución para no mandar 20.000 marcadores.
create or replace function institutions_in_bbox(
  west double precision, south double precision,
  east double precision, north double precision
)
returns table (
  id bigint, name text, slug text, city text, country text,
  lat double precision, lng double precision,
  artwork_count int, rating_avg numeric
)
language sql stable
set search_path = public, extensions as $fn$
  select i.id, i.name, i.slug, i.city, i.country,
         st_y(i.location::geometry), st_x(i.location::geometry),
         i.artwork_count, i.rating_avg
    from institutions i
   where i.artwork_count > 0
     and st_intersects(i.location,
           st_makeenvelope(west, south, east, north, 4326)::geography)
   order by i.artwork_count desc
$fn$;

/**
 * Recalcula los contadores denormalizados de las tres tablas de catálogo.
 *
 * La ingesta la llama UNA vez al terminar, no por obra: son tres UPDATE de
 * tabla completa. Mantenerlos con triggers por fila multiplicaría por tres el
 * coste de insertar 20.000 obras para un dato que solo se lee en listados.
 */
create or replace function refresh_artwork_counters()
returns void language plpgsql as $fn$
begin
  update institutions i set artwork_count = coalesce(c.n, 0)
    from (select institution_id, count(*) n from artworks
           where institution_id is not null group by institution_id) c
   where c.institution_id = i.id;

  update artists a set artwork_count = coalesce(c.n, 0)
    from (select artist_id, count(*) n from artworks
           where artist_id is not null group by artist_id) c
   where c.artist_id = a.id;

  update movements m set artwork_count = coalesce(c.n, 0)
    from (select movement_id, count(*) n from artwork_movements group by movement_id) c
   where c.movement_id = m.id;
end $fn$;

-- ----------------------------------------------------------------------------
-- Seguridad: el catálogo es público, lo que escribe el usuario es suyo.
-- ----------------------------------------------------------------------------
alter table institutions        enable row level security;
alter table artists             enable row level security;
alter table movements           enable row level security;
alter table artworks            enable row level security;
alter table artwork_movements   enable row level security;
alter table artwork_ratings     enable row level security;
alter table institution_ratings enable row level security;
alter table favorites           enable row level security;

create policy "catalogo publico" on institutions      for select using (true);
create policy "catalogo publico" on artists           for select using (true);
create policy "catalogo publico" on movements         for select using (true);
create policy "catalogo publico" on artworks          for select using (true);
create policy "catalogo publico" on artwork_movements for select using (true);

-- Las reseñas se leen públicamente pero solo las edita su autor.
create policy "resenas visibles"   on artwork_ratings for select using (true);
create policy "gestiono mis notas" on artwork_ratings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "resenas visibles"     on institution_ratings for select using (true);
create policy "gestiono mis resenas" on institution_ratings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "mis favoritos" on favorites for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- La ingesta usa la service_role key, que salta RLS por diseño.
