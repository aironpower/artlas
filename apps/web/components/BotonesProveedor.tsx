import { t, type Lang } from '@/lib/i18n';
import { conProveedor } from '@/lib/cuenta-acciones';

/**
 * Entrar con Google o con GitHub.
 *
 * Van arriba del todo y no debajo del formulario: quien tiene cuenta de Google
 * entra de un clic, y ponerlo después del correo obliga a leer un formulario
 * que no va a rellenar.
 *
 * Cada botón es su propio formulario porque son acciones de servidor y un
 * `<form>` solo tiene una. Se ven como una lista de botones porque el CSS los
 * apila; el marcado no se nota.
 *
 * Las marcas van dibujadas aquí y no como imagen: son dos SVG de 400 bytes y
 * traerlos de fuera sería una petición más y una dependencia de un dominio
 * ajeno en la pantalla de entrar, que es la peor donde tener eso.
 */

function LogoGoogle() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.3z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.2 15.5 46 24 46z" />
      <path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.7-.7-4.3s.3-3 .7-4.3v-5.7H4.5C2.9 17.1 2 20.4 2 24s.9 6.9 2.5 10l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.5 2 8.1 6.8 4.5 13.9l7.3 5.7c1.7-5.1 6.5-8.8 12.2-8.8z" />
    </svg>
  );
}

function LogoGithub() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function BotonesProveedor({ idioma, volver }: { idioma: Lang; volver?: string }) {
  return (
    <div className="proveedores">
      <form action={conProveedor}>
        <input type="hidden" name="lang" value={idioma} />
        <input type="hidden" name="proveedor" value="google" />
        <input type="hidden" name="volver" value={volver ?? ''} />
        <button className="btn btn-proveedor" type="submit">
          <LogoGoogle />
          {t(idioma, 'continueWithGoogle')}
        </button>
      </form>

      <form action={conProveedor}>
        <input type="hidden" name="lang" value={idioma} />
        <input type="hidden" name="proveedor" value="github" />
        <input type="hidden" name="volver" value={volver ?? ''} />
        <button className="btn btn-proveedor" type="submit">
          <LogoGithub />
          {t(idioma, 'continueWithGithub')}
        </button>
      </form>
    </div>
  );
}
