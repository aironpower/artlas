'use server';

/**
 * Lo que hacen las pantallas de cuenta.
 *
 * Todo lo que se exporte de aquí es una acción de servidor, porque el
 * `'use server'` de arriba convierte en acción a TODO el módulo. Por eso las
 * ayudas que solo calculan viven en `cuenta.ts` y no aquí.
 *
 * Las cuatro acciones comparten una regla, que es la que faltaba y dejó los
 * enlaces sin funcionar en silencio: **un fallo del usuario se cuenta en
 * genérico, un fallo nuestro se dice**. Ver `deQuienEsElFallo`.
 */

import { redirect } from 'next/navigation';
import { supabaseServer } from './auth';
import { deQuienEsElFallo, origenPublico } from './cuenta';
import { isLang, DEFAULT_LANG, type Lang } from './i18n';
import { path } from './routes';

const idiomaDe = (formData: FormData): Lang => {
  const v = String(formData.get('lang') ?? '');
  return isLang(v) ? v : DEFAULT_LANG;
};

const texto = (formData: FormData, campo: string) => String(formData.get(campo) ?? '').trim();

/** Longitud mínima. Seis es lo que exige Supabase y es una cifra de 2010. */
const MINIMO = 10;

/** A dónde vuelve el enlace del correo, ya con el idioma y el destino puestos. */
async function vueltaDelCorreo(idioma: Lang, destino: string): Promise<string> {
  const origen = await origenPublico();
  return `${origen}/api/auth/callback?next=${encodeURIComponent(destino)}`;
}

// ---------------------------------------------------------------------------

/** Entrar con correo y contraseña. */
export async function entrar(formData: FormData): Promise<void> {
  const idioma = idiomaDe(formData);
  const base = path(idioma, 'login');

  const email = texto(formData, 'email');
  const password = String(formData.get('password') ?? '');
  const volver = texto(formData, 'volver');

  if (!email || !password) redirect(`${base}?error=1`);

  const db = await supabaseServer();
  const { error } = await db.auth.signInWithPassword({ email, password });

  /*
   * Un solo mensaje para «no existe» y «contraseña mal». Dos mensajes
   * distintos convierten esta pantalla en un comprobador de qué correos
   * tienen cuenta, y eso se prueba con un script en diez minutos.
   */
  if (error) redirect(`${base}?error=1`);

  redirect(volver || `/${idioma}`);
}

/** Crear una cuenta con correo y contraseña. */
export async function registrarse(formData: FormData): Promise<void> {
  const idioma = idiomaDe(formData);
  const base = `${path(idioma, 'login')}/registro`;

  const email = texto(formData, 'email');
  const password = String(formData.get('password') ?? '');

  if (!email) redirect(`${base}?error=1`);
  if (password.length < MINIMO) redirect(`${base}?error=corta`);

  const db = await supabaseServer();
  const { error } = await db.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: await vueltaDelCorreo(idioma, `/${idioma}`) },
  });

  if (error) {
    /*
     * Aquí NO se disimula, y es lo contrario de lo que hacía la pantalla vieja.
     * Si el registro está cerrado o el correo no sale, la persona no puede
     * hacer nada al respecto y decirle «revisa tu bandeja» la deja esperando
     * un correo que no existe.
     */
    const culpa = deQuienEsElFallo(error);
    if (culpa === 'registro-cerrado') redirect(`${base}?error=cerrado`);
    if (culpa === 'correo-invalido') redirect(`${base}?error=direccion`);
    if (culpa === 'correo') redirect(`${base}?error=correo`);
    redirect(`${base}?error=1`);
  }

  /*
   * Con confirmación por correo activada, Supabase devuelve éxito tanto si la
   * cuenta es nueva como si ese correo ya la tenía, y manda el aviso adecuado
   * en cada caso. Así que un solo mensaje aquí no es disimulo nuestro: es que
   * de verdad no sabemos cuál de los dos ha pasado, y está bien que no lo
   * sepamos.
   */
  redirect(`${base}?hecho=1`);
}

/** Pedir el enlace para poner una contraseña nueva. */
export async function recuperar(formData: FormData): Promise<void> {
  const idioma = idiomaDe(formData);
  const base = `${path(idioma, 'login')}/recuperar`;

  const email = texto(formData, 'email');
  if (!email) redirect(`${base}?error=1`);

  const db = await supabaseServer();
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: await vueltaDelCorreo(idioma, `${path(idioma, 'login')}/clave`),
  });

  if (error) {
    const culpa = deQuienEsElFallo(error);
    // Una dirección mal escrita sí hay que devolvérsela; que ese correo tenga
    // cuenta o no, no, porque eso es información de su dueño y no de quien
    // rellena el formulario.
    if (culpa === 'correo-invalido') redirect(`${base}?error=direccion`);
    if (culpa === 'usuario') redirect(`${base}?enviado=1`);
    redirect(`${base}?error=correo`);
  }

  redirect(`${base}?enviado=1`);
}

/** Entrar con Google o con GitHub. */
export async function conProveedor(formData: FormData): Promise<void> {
  const idioma = idiomaDe(formData);
  const base = path(idioma, 'login');

  const proveedor = texto(formData, 'proveedor');
  if (proveedor !== 'google' && proveedor !== 'github') redirect(`${base}?error=1`);

  const volver = texto(formData, 'volver') || `/${idioma}`;

  const db = await supabaseServer();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: proveedor,
    options: {
      redirectTo: await vueltaDelCorreo(idioma, volver),
      // Sin esto, supabase-js intentaría navegar él mismo, y aquí no hay
      // navegador: estamos en el servidor y lo que queremos es la URL.
      skipBrowserRedirect: true,
    },
  });

  /*
   * El proveedor apagado en Supabase da error aquí mismo, antes de salir de
   * nuestra web. Merece su propio aviso: «no se pudo entrar con Google» manda
   * a la persona a revisar su cuenta de Google, cuando lo que pasa es que
   * falta configurarlo de nuestro lado.
   */
  if (error || !data?.url) redirect(`${base}?error=proveedor`);

  redirect(data.url);
}
