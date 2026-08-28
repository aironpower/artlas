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

## Lo que se atascó la primera vez (28 de agosto de 2026)

Tres cosas, ninguna del código, y las tres volverán a pasar con el siguiente
subdominio:

**Vercel no veía el repositorio.** «Failed to link... You need to add a Login
Connection». La cuenta de Vercel se creó con correo, no con GitHub, así que no
podía leer un repo privado. Se arregla en Account Settings > Authentication,
conectando GitHub y dándole acceso al repo.

**El proyecto no se llamó `artlas`, se llamó `web`.** Al reimportar, Vercel lo
bautizó con el nombre de la carpeta (`apps/web`). Como el dominio se había
añadido al proyecto vacío del primer intento, `artlas.softie.dev` respondía
`DEPLOYMENT_NOT_FOUND`: el dominio llegaba a Vercel, pero al proyecto que no
tenía ningún despliegue. Esa cabecera —`x-vercel-error`— es la que dice si el
problema es el DNS o el proyecto.

**Verificación de propiedad por TXT.** Al mover el dominio al proyecto bueno,
Vercel pidió demostrar que `softie.dev` es nuestro con un TXT en
`_vercel.softie.dev`. El nombre se pone solo como `_vercel`, no entero, o acaba
en `_vercel.softie.dev.softie.dev`.

**Y el que costó más caro: «Deployment was blocked».** Cuatro despliegues
seguidos fallaron sin llegar a compilar. No era el código ni el proyecto: los
commits iban firmados con un correo que no estaba en la cuenta de GitHub. Vercel exige
que el autor del commit sea reconocible y bloquea antes de construir.

Arreglado con una identidad **solo para este repositorio**, para no tocar la
global que se usa en los repos del trabajo:

```bash
git config --local user.email "10366199+aironpower@users.noreply.github.com"
git config --local user.name  "Manuel Giron"
```

Se usa la dirección `noreply` de GitHub y no el correo personal: vale igual y no
deja el correo escrito en cada commit. Los commits ya hechos conservan el autor
viejo —no se reescribe la historia por esto—, así que el primer commit nuevo es
el que desbloquea y publica todo lo anterior de una vez.

Cómo se reconoce: en la pestaña Deployments el despliegue aparece en rojo sin
registro de construcción, y `gh api repos/<usuario>/artlas/deployments` devuelve
`failure` con la descripción. Que GitHub registre un despliegue NO significa que
se haya publicado; hay que mirar su estado.

Y una que NO hizo falta: cambiar el CNAME. Vercel recomienda ahora unos
registros nuevos, pero el `cname.vercel-dns.com` de siempre sigue valiendo.

Comprobar el DNS desde fuera antes de pulsar «Refresh» ahorra el baile de
recargar contra un registro que aún no ha propagado:

```bash
nslookup -type=TXT _vercel.softie.dev 8.8.8.8
curl -sI http://artlas.softie.dev/ | grep -i x-vercel-error
```

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
