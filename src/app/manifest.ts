import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'XAUUSD Research',
    short_name: 'XAUUSD',
    description: 'Workspace riset, backtest strategi, dan analytics XAUUSD.',
    lang: 'id',
    start_url: '/',
    display: 'standalone',
    background_color: '#0c0d0f',
    theme_color: '#0c0d0f',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
