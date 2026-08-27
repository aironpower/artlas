import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Artlas',
  description: 'Mapa mundial de obras de arte',
};

/** El <html lang> real lo pone el layout de [lang]; aquí solo el esqueleto. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
