/**
 * Piezas compartidas de las pantallas de cuenta.
 *
 * Va aparte de `cuenta-acciones.ts` a propósito: aquel lleva `'use server'` en
 * la primera línea, y eso convierte en acción de servidor a TODO lo que
 * exporte, incluida una función que solo calcula una cadena. Ya pasó una vez
 * con `esFavorita`, y el error que da es de los que no señalan a la causa.
 */

import { headers } from 'next/headers';
import type { AuthError } from '@supabase/supabase-js';

/**
 * A qué dirección tienen que volver los enlaces que se mandan por correo.
 *
 * No se lee de `NEXT_PUBLIC_SITE_URL` a secas, y ese es justamente el fallo que
 * dejó los enlaces sin funcionar: la variable decía `localhost:3111` mientras
 * el servidor de desarrollo estaba en el 3000, así que el enlace del correo
 * llevaba a un puerto donde no había nada. Una variable escrita a mano se
 * desincroniza del puerto real en cuanto alguien levanta el servidor en otro.
 *
 * En local mandan las cabeceras de la propia petición, que no pueden mentir
 * sobre dónde estás. Fuera de local manda la variable, porque detrás de un
 * proxy el `host` es el del proxy y porque el dominio de producción es una
 * decisión, no algo que deducir.
 *
 * Que esto no pueda usarse para colar un destino ajeno lo garantiza Supabase,
 * no nosotros: solo acepta redirigir a las URLs de su lista blanca.
 */
export async function origenPublico(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';

  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    return `http://${host}`;
  }

  const declarado = process.env.NEXT_PUBLIC_SITE_URL;
  if (declarado) return declarado.replace(/\/+$/, '');

  const proto = h.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

/**
 * ¿El fallo es nuestro o suyo?
 *
 * Esta distinción es la lección del fallo del 1 de septiembre de 2026. La
 * pantalla de entrada llamaba a Supabase, **tiraba el error a la basura** y
 * decía «te hemos enviado el enlace» pasara lo que pasara. La intención era
 * buena —dos mensajes distintos para «enviado» y «ese correo no existe»
 * convierten la pantalla en un comprobador de quién tiene cuenta—, pero de
 * paso escondía los fallos de verdad. El registro estaba cerrado en Supabase,
 * cada intento moría con un 422, y por fuera se veía «enlace enviado».
 *
 * Así que se separan los dos casos:
 *
 *   - **Fallo del usuario** (no existe, contraseña mal): un mensaje genérico,
 *     sin decir cuál de los dos. Aquí sí hay que ser discreto.
 *   - **Fallo nuestro** (registro cerrado, límite de correos, SMTP caído): hay
 *     que decirlo, porque el usuario no puede hacer nada y merece saber que no
 *     es cosa suya. Callarlo lo deja esperando un correo que no va a llegar.
 *
 * Se mira el `code` antes que el `status`: Supabase los nombra
 * (`signup_disabled`, `over_email_send_rate_limit`) y esos nombres son más
 * estables que un número.
 */
export type Culpa = 'usuario' | 'correo-invalido' | 'correo' | 'registro-cerrado';

/*
 * Los códigos que son fallo NUESTRO. Lista explícita y no un `includes`.
 *
 * El primer intento buscaba «email» dentro del código, y al probarlo contra
 * Supabase de verdad salió `email_address_invalid` —una dirección mal
 * escrita— clasificada como avería nuestra. Le habría dicho «no es cosa tuya»
 * a alguien que se había equivocado al teclear, que es peor que no decir nada:
 * se queda esperando en vez de mirar lo que ha escrito.
 *
 * Una lista explícita se queda corta cuando Supabase añade un código, y eso es
 * lo correcto aquí: lo que no reconocemos cae en «usuario», que enseña un
 * mensaje genérico y no promete nada.
 */
const NUESTROS = new Set([
  'signup_disabled',            // el registro está cerrado en el proyecto
  'email_provider_disabled',    // el correo apagado como método de entrada
  'over_email_send_rate_limit', // el límite de 2-3 correos/hora del plan gratuito
  'over_request_rate_limit',
  'over_sms_send_rate_limit',
  'mailer_error',
  'unexpected_failure',
]);

/** Direcciones que Supabase rechaza por su forma, no por quién sea su dueño. */
const DEL_USUARIO = new Set([
  'email_address_invalid',
  'email_address_not_authorized',
]);

export function deQuienEsElFallo(error: AuthError): Culpa {
  const codigo = (error as { code?: string }).code ?? '';

  if (codigo === 'signup_disabled') return 'registro-cerrado';
  if (DEL_USUARIO.has(codigo)) return 'correo-invalido';
  if (NUESTROS.has(codigo)) return 'correo';

  /*
   * Sin código reconocible, manda el estado. Un 429 es el límite de envíos y un
   * 5xx es que algo se ha caído: en ninguno de los dos puede hacer nada quien
   * rellena el formulario. Todo lo demás —400, 401, 422 sin código— se trata
   * como fallo suyo y se cuenta en genérico.
   */
  if (error.status === 429) return 'correo';
  if (typeof error.status === 'number' && error.status >= 500) return 'correo';

  return 'usuario';
}
