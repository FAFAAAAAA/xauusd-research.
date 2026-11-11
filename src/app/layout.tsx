import type { Metadata, Viewport } from 'next';
import './globals.css';
import './apple-inspired.css';

export const metadata: Metadata = {
  title: 'XAUUSD Research',
  description: 'Sinyal, jurnal, kalkulator risiko dan backtest strategi emas (XAUUSD).',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'XAU', statusBarStyle: 'black-translucent' },
  icons: { apple: '/apple-touch-icon.png' },
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: '#f2f4f6',
};
// Applies the saved theme (Atur → Tampilan) before the first paint, so there is no flash. Light ("Terang Bersih") is the default.
// 'auto' follows the phone's light/dark setting. Storage may be blocked: then light.
// The installed app always opens on the office ('/'), even when iOS resumes it on another page.
const BOOT_SCRIPT = `try{var p=location.pathname;if(!sessionStorage.getItem('xau_booted')){sessionStorage.setItem('xau_booted','1');if(p!=='/'&&p!=='/login'){document.documentElement.style.visibility='hidden';location.replace('/')}}}catch(e){}`;
const THEME_SCRIPT = `try{var t=localStorage.getItem('xau.theme');if(t==='dark'||t==='auto')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
