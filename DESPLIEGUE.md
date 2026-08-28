# Publicar Artlas en artlas.softie.dev

El sitio se sirve desde **Vercel**, conectado al repositorio privado
`aironpower/artlas`. Cada `git push` a `master` publica.

**Por qué Vercel y no GitHub Pages**, que fue lo primero que se intentó: Pages
solo sirve ficheros estáticos, y Artlas necesita servidor —el buscador, «obras
cerca de mí», el panel de administración con sesión por cookie y la
revalidación cada hora—. Y aunque se exportara estático, el catálogo son
232.491 páginas (62.245 obras + 15.204 artistas + 48 museos, por 3 idiomas):
entre 5 y 10 GB contra el límite de 1 GB de Pages. Además, Pages desde un repo
privado exige plan de pago.

---

## La primera vez

### 1. Importar el proyecto

En vercel.com: **Add New > Project**, dar acceso al repo privado
`aironpower/artlas` e importarlo.

**Root Directory: `apps/web`.** Es un monorepo y sin esto Vercel compila la
raíz, que no es la app. Deja marcado incluir ficheros de fuera de esa carpeta:
`apps/web` no es autónoma, comparte el `package-lock.json` de la raíz.

El resto lo detecta solo (Next.js, `next build`).

### 2. Las tres variables

En **Settings > Environment Variables**, para Production y Preview:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | el mismo del `.env` local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | el mismo del `.env` local |
| `NEXT_PUBLIC_SITE_URL` | `https://artlas.softie.dev` |

Son las tres únicas que usa la web, y las tres son públicas por diseño: van
dentro del JavaScript que descarga el navegador. **La `SUPABASE_SERVICE_ROLE_KEY`
y la `DATABASE_URL` no se ponen en Vercel**: son de la ingesta y de las
migraciones, que corren desde tu máquina. Quien tenga la `anon` solo puede leer
lo que dejan ver las políticas RLS.

`NEXT_PUBLIC_SITE_URL` importa más de lo que parece: es a donde vuelve el enlace
mágico del panel ([entrar/page.tsx](apps/web/app/[lang]/admin/entrar/page.tsx)).
Si se queda en `localhost:3111`, el correo de acceso te manda a tu portátil.

### 3. El dominio

En **Settings > Domains**, añadir `artlas.softie.dev`. Vercel pedirá un registro
en el DNS de `softie.dev`:

```
CNAME   artlas   cname.vercel-dns.com
```

El certificado lo emite Vercel solo, en cuanto el DNS propague.

### 4. Avisar a Supabase del dominio nuevo

En el panel de Supabase, **Authentication > URL Configuration**:

- Site URL: `https://artlas.softie.dev`
- Redirect URLs: añadir `https://artlas.softie.dev/api/auth/callback`

Sin esto el enlace mágico llega al correo pero Supabase rechaza la vuelta, y el
panel no deja entrar a nadie. Dejar también la de `localhost:3111` para seguir
trabajando en local.

---

## Comprobar que quedó bien

1. La portada en los tres idiomas: `/es`, `/en`, `/fr`.
2. El buscador (usa las RPC con la clave `anon`, que sí tiene
   `statement_timeout` de 3 s — si algo va a caerse, se cae aquí).
3. «Obras cerca de mí», que es la única ruta de API pública.
4. Entrar al panel con `manuel@softie.dev` y que el enlace del correo devuelva
   a `artlas.softie.dev` y no a `localhost`.

---

## Cosas que conviene saber

- **El plan Hobby de Vercel es para uso no comercial.** Mientras Artlas no
  venda nada ni lleve publicidad, está dentro. Si algún día cobra, hay que pasar
  al plan de pago.
- **La base de datos sigue siendo el límite**, no el alojamiento: el plan
  gratuito de Supabase son 500 MB y el catálogo ocupa 180.
- **La ingesta no vive en Vercel.** Corre en tu máquina contra la misma base.
  Publicar la web no cambia nada de eso.
