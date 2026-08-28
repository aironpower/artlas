-- ============================================================================
-- Artlas · 0021 — el administrador ve también lo que espera
--
-- Separada de 0020 por una razón operativa: `create policy` sobre `artworks`
-- toma un bloqueo exclusivo sobre la tabla, y con una ingesta escribiendo en
-- ella eso puede hacer fallar un lote y tumbar el museo que estuviera en curso.
-- 0020 no toca `artworks`, así que pudo aplicarse en caliente; esto espera a
-- que no haya ninguna ingesta.
--
-- Qué añade: el administrador ve el catálogo COMPLETO, no solo lo publicado.
-- Es justo lo que necesita la bandeja de revisión, cuyo trabajo son las ~59.000
-- obras que esperan datos.
--
-- La política de 0008 (`status = 'published'`) sigue en pie para todos los
-- demás; esta se suma. En RLS varias políticas de SELECT se combinan con OR,
-- así que un administrador ve la unión: todo.
-- ============================================================================

set search_path = public, extensions;

create policy "los administradores ven todo el catalogo" on artworks
  for select using (is_admin());
