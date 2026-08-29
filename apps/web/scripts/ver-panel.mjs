/*
 * Abre el panel en un navegador de verdad, con la sesión de un administrador.
 *
 * El panel entra por enlace mágico, así que no hay forma de pulsar «entrar» sin
 * un correo. Aquí se emite el mismo token que emitiría ese correo, se canjea
 * por una sesión, y se escribe la cookie con el mismo código de @supabase/ssr
 * que la escribiría el navegador. Es el camino del usuario, no un atajo por
 * detrás: la página sigue leyendo con la sesión y sujeta a las políticas.
 */
import { createClient } from '@supabase/supabase-js';
import { createChunks, stringToBase64URL } from '@supabase/ssr/dist/main/utils/index.js';
import { chromium } from 'playwright';

process.loadEnvFile('C:/projects/artlas/.env');

const URL_SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = 'manuel@softie.dev';
const BASE = 'http://localhost:3111';

const admin = createClient(URL_SUPA, SERVICE, { auth: { persistSession: false } });
const { data: link, error: e1 } = await admin.auth.admin.generateLink({
  type: 'magiclink', email: EMAIL,
});
if (e1) throw e1;

const anon = createClient(URL_SUPA, ANON, { auth: { persistSession: false } });
const { data: sesion, error: e2 } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token, type: 'email',
});
if (e2) throw e2;

const ref = new URL(URL_SUPA).hostname.split('.')[0];
const nombre = `sb-${ref}-auth-token`;
const valor = 'base64-' + stringToBase64URL(JSON.stringify(sesion.session));

const cookies = createChunks(nombre, valor).map(({ name, value }) => ({
  name, value, domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax',
}));

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1100, height: 1400 } });
await ctx.addCookies(cookies);
const page = await ctx.newPage();

const errores = [];
page.on('console', (m) => m.type() === 'error' && errores.push(m.text()));

const destino = process.argv[2] ?? '/es/admin/ingesta';
const res = await page.goto(BASE + destino, { waitUntil: 'networkidle' });
console.log(destino, '→', res.status());

await page.screenshot({ path: process.argv[3] ?? 'panel.png', fullPage: true });
console.log('título:', await page.title());
console.log('texto:', (await page.locator('body').innerText()).slice(0, 1400));
if (errores.length) console.log('errores de consola:', errores);

await navegador.close();
