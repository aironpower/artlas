-- ============================================================================
-- Artlas · 0037 — poner a funcionar los favoritos
--
-- **La tabla ya existía**, desde `0001_init`, con la forma correcta: par
-- (user_id, artwork_id) como clave primaria, RLS activa y una política `for
-- all` contra `auth.uid()`. Llevaba desde el principio ahí y con cero filas,
-- porque no había ninguna pantalla que la usara.
--
-- Así que esto NO crea nada nuevo: añade lo que le faltaba para servir.
--
--   1. Dos índices. El de la clave primaria empieza por `user_id`, así que vale
--      para «¿tiene esta persona esta obra?» y para listar las suyas, pero no
--      para «¿cuántas veces está marcada esta obra?», que recorre por
--      `artwork_id`. Hoy esa pregunta no se hace en ningún sitio, pero es la
--      primera que se hará —«las más guardadas»— y sobre una tabla vacía el
--      índice cuesta nada.
--
--   2. `my_favorites`, para que la lista llegue en una consulta con los textos
--      ya en el idioma de quien mira, en vez de repetir en la app el
--      `coalesce(traducción, canónico)` de título, artista y museo.
--
-- Un favorito es privado y no se edita: se pone o se quita. La política de 0001
-- ya lo garantiza contra `auth.uid()`, así que ni la app ni esta migración
-- tienen que volver a comprobarlo — quien llame a la API de Supabase con su
-- propia sesión tampoco verá los de otro.
-- ============================================================================

set search_path = public, extensions;

create index if not exists favorites_artwork_idx    on favorites (artwork_id);
create index if not exists favorites_recientes_idx  on favorites (user_id, created_at desc);

/**
 * Las obras guardadas por quien llama, ya pintables.
 *
 * `security invoker` —el valor por defecto, y por eso no se escribe `definer`—
 * es aquí una decisión de seguridad: así la política de `favorites` se aplica
 * al `auth.uid()` real. Una función `definer` se saltaría RLS y devolvería los
 * favoritos de cualquiera con solo cambiar un identificador.
 */
create or replace function my_favorites(p_lang text default 'es', p_limit integer default 200)
returns table (
  id               bigint,
  title            text,
  slug             text,
  image_url        text,
  year_start       integer,
  date_display     text,
  artist_name      text,
  artist_slug      text,
  institution_name text,
  institution_slug text,
  rights_status    text,
  saved_at         timestamptz
)
language sql stable set search_path = public, extensions as $fn$
  select a.id,
         coalesce(ta.title, a.title),
         a.slug,
         a.image_url,
         a.year_start,
         a.date_display,
         coalesce(tar.name, ar.name),
         ar.slug,
         coalesce(ti.name, i.name),
         i.slug,
         a.rights_status,
         f.created_at
    from favorites f
    join artworks a  on a.id = f.artwork_id
    left join artwork_translations ta   on ta.artwork_id = a.id and ta.lang = p_lang
    left join artists ar                on ar.id = a.artist_id
    left join artist_translations tar   on tar.artist_id = ar.id and tar.lang = p_lang
    left join institutions i            on i.id = a.institution_id
    left join institution_translations ti on ti.institution_id = i.id and ti.lang = p_lang
   where f.user_id = auth.uid()
   order by f.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$fn$;

revoke execute on function my_favorites(text, integer) from public, anon;
grant  execute on function my_favorites(text, integer) to authenticated;

comment on function my_favorites(text, integer) is
  'Las obras guardadas por quien llama, con los textos en su idioma. Invoker a propósito: la RLS de favorites decide de quién son.';
