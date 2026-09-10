# Artlas en un servidor propio (Hetzner)

Sustituye a Vercel. El porqué está en [HISTORIAL.md](HISTORIAL.md), pero en una
línea: **Vercel pausó la cuenta entera por pasarse el plan gratuito**, y aunque
la caché ya está arreglada, las Edge Requests —1,9M contra un tope de 1M— no las
baja ningún arreglo, porque una página servida desde la caché sigue contando.
El escalón siguiente eran 20 $/mes. Un VPS son ~4 €, y encima aquí `next start`
corre nativo: el ISR es la implementación de referencia, no un adaptador.

Lo que se paga en cambio: **el tiempo de servicio es tuyo.** Si esto se cae a
las tres de la mañana, no hay nadie más.

Los ficheros de este manual están en [despliegue/](despliegue/).

---

## Antes de empezar

Ten a mano el `.env` de tu máquina: los valores se copian tal cual, salvo uno.

---

## 1. Crear la máquina

En [console.hetzner.com](https://console.hetzner.com), **Add Server**:

| | |
|---|---|
| Región | **Falkenstein** o **Núremberg** (Alemania) |
| Imagen | **Debian 13** |
| Tipo | **CX22** — 2 vCPU, 4 GB, 40 GB SSD |
| Redes | IPv4 **e** IPv6 |
| SSH Key | la tuya, pegada aquí |

**CX22 y no el más pequeño:** lo que manda no es servir la web —eso es casi
nada— sino `next build`, que es lo más pesado que va a correr esta máquina. Con
2 GB el build muere por memoria y lo hace con un «Killed» a secas que no explica
nada.

**Pon la clave SSH ahora.** Si dejas que Hetzner mande la contraseña por correo,
la máquina pasa sus primeros minutos aceptando contraseñas por el puerto 22, y
ahí fuera hay quien lo prueba en cuanto la IP existe.

Apunta la IPv4 que te dé. Aquí se llama `LA_IP`.

---

## 2. Prepararla

Desde tu ordenador, en la raíz del repositorio:

```bash
ssh root@LA_IP 'bash -s' < despliegue/preparar-servidor.sh
```

Instala Node 22, Caddy, el cortafuegos, 2 GB de swap, los parches automáticos y
el usuario `artlas`, que es quien correrá todo — nada de esto va como root.

---

## 3. Dejar que el servidor lea el repositorio

El repositorio es privado, así que hace falta una **clave de despliegue**. En el
servidor:

```bash
ssh root@LA_IP
su - artlas
ssh-keygen -t ed25519 -C "artlas-vps" -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

Copia lo que salga y pégalo en GitHub: repositorio `aironpower/artlas` →
**Settings → Deploy keys → Add deploy key**. Nombre: `VPS Hetzner`.

**NO marques «Allow write access».** El servidor solo tiene que leer. Una clave
de solo lectura que se filtre es un disgusto; una con escritura es un desastre.

Comprueba que funciona y clona:

```bash
ssh -T git@github.com          # dirá "successfully authenticated", sin shell
git clone git@github.com:aironpower/artlas.git /opt/artlas
```

---

## 4. Las credenciales

Sigue como usuario `artlas`:

```bash
nano /opt/artlas/.env
```

Copia el `.env` de tu máquina entero, **con un cambio**:

```
NEXT_PUBLIC_SITE_URL=https://artlas.softie.dev
```

Y cierra el fichero:

```bash
chmod 600 /opt/artlas/.env
```

**Lo que hay que saber de este fichero.** Lleva la `SUPABASE_SERVICE_ROLE_KEY` y
la `DATABASE_URL`, que son de administrador. En Vercel las mantuviste
deliberadamente fuera —allí la web solo tenía las tres públicas—; aquí la web y
el trabajador comparten `.env`, igual que en tu portátil, así que **el proceso
de la web tiene la service_role en su entorno**.

No llega al navegador: Next solo mete en el paquete las `NEXT_PUBLIC_*`. Pero es
una diferencia real y conviene no descubrirla dentro de seis meses. Separarlas
exige tocar `next.config.ts`, que carga el `.env` de la raíz para el build; es
un rato de trabajo y está apuntado en NOTAS.md.

---

## 5. Servicios y proxy

Como root:

```bash
cp /opt/artlas/despliegue/artlas-web.service        /etc/systemd/system/
cp /opt/artlas/despliegue/artlas-trabajador.service /etc/systemd/system/
cp /opt/artlas/despliegue/Caddyfile                 /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable artlas-web artlas-trabajador
```

`enable` y no `start` todavía: primero hay que construir.

---

## 6. El primer build, antes de tocar el DNS

Como usuario `artlas`:

```bash
cd /opt/artlas
npm ci
cd apps/web
NEXT_DIST_DIR=.next-build /opt/artlas/node_modules/.bin/next build
mv .next-build .next
sudo systemctl start artlas-web
curl -sI http://localhost:3111/es | head -1     # tiene que decir 200
```

**Este orden importa.** Se comprueba que la web responde en la propia máquina
ANTES de mover el DNS. Si algo falla —una variable mal copiada, Supabase que no
contesta— te enteras aquí, con el dominio todavía apuntando a otro sitio.

Arranca también el trabajador:

```bash
sudo systemctl start artlas-trabajador
systemctl status artlas-trabajador --no-pager
```

---

## 7. Mover el dominio

En el DNS de `softie.dev`, **quita el CNAME de Vercel** y pon:

```
A      artlas    LA_IP
AAAA   artlas    LA_IPv6
```

Comprueba desde fuera antes de seguir, que es lo que ahorra el baile de recargar
contra un registro que aún no ha propagado:

```bash
nslookup artlas.softie.dev 8.8.8.8
```

Cuando devuelva tu IP, arranca Caddy:

```bash
systemctl restart caddy
journalctl -u caddy -f
```

Pide el certificado a Let's Encrypt solo y lo renueva solo. En el registro se ve
llegar («certificate obtained successfully»). Si se queda intentándolo, casi
siempre es que el DNS aún no ha propagado o que el puerto 80 está cerrado
—Let's Encrypt valida por ahí—.

---

## 8. Comprobar que quedó bien

```bash
curl -sI https://artlas.softie.dev/es | head -3
curl -s  https://artlas.softie.dev/robots.txt | tail -2
```

1. La portada en los tres idiomas: `/es`, `/en`, `/fr`.
2. **El robots tiene que apuntar a `https://artlas.softie.dev/sitemap/0.xml`.**
   Si dice `localhost:3111`, la `NEXT_PUBLIC_SITE_URL` del `.env` está mal y
   ningún buscador encontrará el sitemap.
3. Una ficha de obra dos veces seguidas: la segunda tiene que venir de la caché.
4. El buscador, que es donde se cae lo que se va a caer (`statement_timeout` de
   3 s en el rol `anon`).
5. Entrar con `manuel@softie.dev` y que el enlace del correo vuelva al dominio.
6. Desde `/es/admin/ingesta`, que la pantalla diga que hay trabajador
   escuchando. **Eso es lo que nunca funcionó en Vercel**: hasta hoy el
   trabajador vivía en tu ordenador.

---

## 9. Supabase

No hay que tocar nada **si el dominio sigue siendo `artlas.softie.dev`**: las
Redirect URLs ya lo tienen dado de alta desde el 28 de agosto. Compruébalo en
**Authentication → URL Configuration** y no toques nada más.

---

## El día a día

**Publicar lo que haya en master:**

```bash
ssh artlas@LA_IP '/opt/artlas/despliegue/desplegar.sh'
```

Trae, instala, construye en `.next-build`, cambia de sitio y reinicia. La web
está caída los dos segundos del reinicio, no los dos minutos del build. El
script no da nada por bueno hasta que la portada responde.

**Después de una ingesta, despliega.** Es la purga de la caché: cada despliegue
estrena `.next`, así que el catálogo sale al día. Está contado en NOTAS.md.

**Ver qué pasa:**

```bash
journalctl -u artlas-web -f            # la web
journalctl -u artlas-trabajador -f     # el trabajador
tail -f /var/log/caddy/artlas.log      # quién entra, rastreadores incluidos
```

Ese último es el que en Vercel no tenías: si algún día vuelves a preguntarte
«¿esto es tráfico o es un rastreador?», la respuesta está ahí y no en un panel.

---

## Lo que ahora es tuyo

- **Copias de la base: no cambian.** Están en Supabase, no aquí. Este servidor
  no guarda nada que no esté en Git o en el `.env` — que sí conviene tener
  copiado en otro sitio.
- **Actualizaciones del sistema:** los parches de seguridad van solos
  (`unattended-upgrades`). Las de versión mayor de Debian, no.
- **Si se llena el disco**, la web deja de escribir la caché del ISR y empieza a
  renderizar todo. `df -h` de vez en cuando. Son 40 GB para una app que ocupa
  menos de dos.
- **No hay CDN.** El público de Artlas es europeo y la máquina está en Alemania,
  así que se nota poco. Si algún día importa, Cloudflare gratis por delante
  —solo como CDN, sin Workers— resuelve eso sin tocar nada de aquí.

## Y en Vercel, cuando esto funcione

Quita `artlas.softie.dev` del proyecto `web` para que no queden dos sitios
reclamando el mismo dominio. La cuenta puede quedarse pausada: no cuesta nada.
