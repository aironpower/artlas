#!/usr/bin/env bash
#
# Publica lo que haya en `master`. Se ejecuta EN EL SERVIDOR, como el usuario
# artlas:
#
#   ssh artlas@LA_IP '/opt/artlas/despliegue/desplegar.sh'
#
# Hace lo mismo que hacía un `git push` con Vercel detrás, y a mano: traer,
# instalar, construir y reiniciar.

set -euo pipefail

RAIZ=/opt/artlas
WEB="$RAIZ/apps/web"

cd "$RAIZ"

echo "==> Trayendo master"
git fetch --quiet origin
# `--ff-only` y no `reset --hard`: si alguien ha tocado algo en el servidor,
# quiero que esto FALLE y me lo diga, no que se lo lleve por delante en
# silencio. Un despliegue que borra trabajo sin avisar es peor que uno que no
# despliega.
git pull --ff-only origin master

echo "==> Dependencias"
# `npm ci` y no `npm install`: instala exactamente el package-lock.json, así
# que lo que se construye aquí es lo que se probó. Y con las de desarrollo,
# que `next build` necesita TypeScript y los @types.
npm ci

echo "==> Construyendo"
cd "$WEB"
# ------------------------------------------------------------------------
# Se construye en `.next-build` y NO en `.next`, y esto es lo que evita un
# apagón raro a mitad de despliegue.
#
# El servidor que está sirviendo ahora mismo lee `.next`. Si `next build`
# escribiera ahí, le estaría borrando el suelo a un proceso vivo: la web
# devolvería errores durante todo el build y no solo durante el reinicio. Es
# el mismo tropiezo que ya está contado en `next.config.ts` —«compilar o
# levantar el modo desarrollo BORRA lo que ese servidor está leyendo»— y por
# eso existe ahí la variable NEXT_DIST_DIR. Aquí se usa para lo que se
# inventó.
#
# El cambio de sitio es un `mv` dentro del mismo sistema de ficheros: es
# instantáneo, así que la web está caída los dos segundos del reinicio y no
# los dos minutos del build.
# ------------------------------------------------------------------------
NEXT_DIST_DIR=.next-build "$RAIZ/node_modules/.bin/next" build

echo "==> Cambiando la versión servida"
sudo systemctl stop artlas-web
rm -rf .next
mv .next-build .next
sudo systemctl start artlas-web

# El trabajador también trae código nuevo. No hace falta pararlo antes: si
# está a mitad de una ingesta, systemd lo reinicia y el checkpoint por museo
# hace que reanude por donde iba.
echo "==> Reiniciando el trabajador"
sudo systemctl restart artlas-trabajador

echo "==> Comprobando"
# No se da por bueno hasta que responde. Un despliegue que dice «hecho» sin
# haber preguntado es cómo se descubren las cosas al día siguiente.
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null http://localhost:3111/es; then
    echo "    la portada responde"
    break
  fi
  [ "$i" = "30" ] && { echo "    NO responde. systemctl status artlas-web"; exit 1; }
  sleep 1
done

systemctl is-active artlas-web artlas-trabajador

echo
echo "Desplegado. Ojo: la caché del ISR se ha vaciado con el .next viejo, así"
echo "que las primeras visitas de cada página la regeneran. Es lo correcto"
echo "después de una ingesta, y es la purga de la que habla NOTAS.md."
