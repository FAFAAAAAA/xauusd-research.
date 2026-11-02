import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'XAUUSD Research',
  description: 'Sinyal, jurnal, kalkulator risiko dan backtest strategi emas (XAUUSD).',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'XAU', statusBarStyle: 'black' },
  icons: { apple: '/apple-touch-icon.png' },
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: '#0b0c0e',
};
// Applies the saved theme (Atur → Tampilan) before the first paint, so there is no flash. Dark is the default.
// 'auto' follows the phone's light/dark setting. Storage may be blocked: then dark.
const THEME_SCRIPT = `try{var t=localStorage.getItem('xau.theme');if(t==='light'||t==='auto')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
