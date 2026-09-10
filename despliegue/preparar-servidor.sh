#!/usr/bin/env bash
#
# Deja un Debian 13 recién creado listo para servir Artlas. Se ejecuta UNA vez,
# como root, y es idempotente: repetirlo no rompe nada.
#
#   ssh root@LA_IP 'bash -s' < despliegue/preparar-servidor.sh
#
# Lo que NO hace, porque necesita decisiones o secretos:
#   - clonar el repositorio (hace falta una clave de despliegue en GitHub)
#   - escribir el .env (son credenciales)
#   - apuntar el DNS
# Esos tres pasos están en DESPLIEGUE-VPS.md, en orden.

set -euo pipefail

echo "==> Paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl git ufw ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

# Parches de seguridad solos. En Vercel esto lo hacía otro; aquí es tuyo, y es
# la clase de tarea que no se hace si hay que acordarse.
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Espacio de intercambio (2 GB)"
# `next build` es lo más pesado que va a correr esta máquina. En 4 GB entra,
# pero sin margen: si el build muere por falta de memoria lo hace con un
# «Killed» a secas que no explica nada. Dos gigas de swap son el seguro barato.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Que use la swap solo cuando de verdad haga falta, no por costumbre.
  sysctl -w vm.swappiness=10 >/dev/null
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-artlas.conf
fi

echo "==> Node 22"
# El repositorio de NodeSource y no el de Debian: Debian 13 trae Node 20 y el
# proyecto pide >= 22 en su package.json.
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node --version

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
fi

echo "==> Usuario artlas"
# La web y el trabajador NO corren como root. Si algún día una dependencia
# tiene un agujero, que lo tenga dentro de /opt/artlas y no en la máquina.
if ! id artlas >/dev/null 2>&1; then
  adduser --system --group --home /opt/artlas --shell /bin/bash artlas
fi
mkdir -p /opt/artlas /var/log/caddy
chown artlas:artlas /opt/artlas
chown caddy:caddy /var/log/caddy

# La misma clave con la que entras como root, para el usuario artlas. Sin esto
# `ssh artlas@LA_IP` pide contraseña —que no tiene— y desplegar sería imposible
# sin entrar de root cada vez, que es justo lo que se quiere evitar.
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -m 700 -o artlas -g artlas /opt/artlas/.ssh
  install -m 600 -o artlas -g artlas /root/.ssh/authorized_keys /opt/artlas/.ssh/authorized_keys
  echo "    clave SSH copiada a artlas"
else
  echo "    AVISO: root no tiene authorized_keys. Creaste la máquina con"
  echo "    contraseña en vez de con clave SSH. Añade tu clave a"
  echo "    /opt/artlas/.ssh/authorized_keys antes de seguir."
fi

echo "==> Cortafuegos"
ufw allow 22/tcp   >/dev/null
ufw allow 80/tcp   >/dev/null
ufw allow 443/tcp  >/dev/null
ufw --force enable >/dev/null
ufw status numbered

echo "==> Permiso para que 'artlas' reinicie sus propios servicios"
# Sin esto, desplegar exigiría root. Con esto, el usuario artlas puede tocar
# EXACTAMENTE estos dos servicios y nada más.
cat > /etc/sudoers.d/artlas <<'SUDO'
artlas ALL=(root) NOPASSWD: /usr/bin/systemctl start artlas-web, /usr/bin/systemctl stop artlas-web, /usr/bin/systemctl restart artlas-web, /usr/bin/systemctl restart artlas-trabajador
SUDO
chmod 440 /etc/sudoers.d/artlas
visudo -c -f /etc/sudoers.d/artlas

echo
echo "Servidor preparado. Sigue en DESPLIEGUE-VPS.md por el paso 3 (la clave de despliegue)."
