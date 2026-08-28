-- ============================================================================
-- Artlas · 0020 — quién es administrador, y qué puede ver
--
-- Hasta ahora `audit_findings` (0006) estaba cerrada del todo: RLS activo y
-- ninguna política, de modo que solo la service_role llegaba. Era lo correcto
-- mientras no hubiera forma de distinguir a un administrador de un visitante.
-- Esta migración crea esa forma.
--
-- La decisión de fondo, tomada al principio: **el rol vive en la base y las
-- políticas lo comprueban**, no la aplicación. Si la comprobación estuviera en
-- el componente de React, cualquiera que llamara a la API de Supabase con su
-- propia sesión se saltaría el panel entero. Así, la base rechaza la lectura
-- aunque el atacante escriba sus propias peticiones.
-- ============================================================================

set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- Perfiles
-- ----------------------------------------------------------------------------
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  display_name text,

  /*
   * `viewer` es el valor por defecto y es deliberado: registrarse no da
   * permisos. A administrador se asciende a mano con un UPDATE, que para el
   * número de personas que van a revisar este catálogo es exactamente la
   * complejidad que hace falta.
   */
  role       text not null default 'viewer' check (role in ('viewer', 'admin')),

  created_at timestamptz not null default now()
);

create index profiles_role_idx on profiles (role) where role = 'admin';

/**
 * ¿Es administrador quien hace esta petición?
 *
 * SECURITY DEFINER a propósito, y aquí el motivo es de corrección, no de
 * rendimiento: la función se usa DENTRO de las políticas de `profiles`, así
 * que si se ejecutara con los permisos del que llama tendría que leer
 * `profiles` pasando por la política que ella misma define — recursión
 * infinita. Postgres la corta con un error, pero el error aparece al usarla,
 * no al crearla.
 */
create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public, extensions as $fn$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  )
$fn$;

-- Cada quien ve y edita su propio perfil; nadie se asciende solo.
alter table profiles enable row level security;

create policy "veo mi perfil" on profiles
  for select using (id = auth.uid() or is_admin());

create policy "edito mi nombre" on profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    -- El rol no se toca desde la app: quien lo intente se queda como estaba.
    and role = (select p.role from profiles p where p.id = auth.uid())
  );

/**
 * Alta automática al registrarse.
 *
 * Sin esto, un usuario existiría en `auth.users` pero no en `profiles`, y toda
 * comprobación de rol devolvería falso para alguien que sí ha iniciado sesión:
 * un fallo confuso de depurar, porque la sesión es válida.
 */
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $fn$
begin
  insert into profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- Lo que un administrador puede ver
--
-- Solo LECTURA por ahora. Las escrituras del panel (marcar un hallazgo como
-- descartado, publicar una obra a mano) llegarán con sus propias políticas
-- cuando existan las pantallas: abrir permisos de escritura antes de tener
-- quien los use es dejar una puerta abierta sin puerta detrás.
--
-- La política que deja al administrador ver TODO el catálogo va aparte, en
-- 0021: `create policy` sobre `artworks` bloquea la tabla un instante, y
-- mientras haya una ingesta escribiendo en ella eso puede tumbarle un museo
-- entero. Esta migración no toca `artworks` y por eso se puede aplicar con la
-- ingesta viva.
-- ----------------------------------------------------------------------------

create policy "los administradores ven los hallazgos" on audit_findings
  for select using (is_admin());

comment on function is_admin() is
  'Comprueba el rol en profiles. La usan las políticas RLS: la garantía está en la base, no en la app.';
