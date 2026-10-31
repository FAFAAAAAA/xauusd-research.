/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverComponentsExternalPackages: ['pg'],
    // bundled price files (data/market) are read with fs by these routes
    outputFileTracingIncludes: {
      '/api/backtest/run': ['./data/market/**'],
      '/api/trades/[id]': ['./data/market/**'],
      '/api/markets': ['./data/market/manifest.json'],
    },
  },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};
export default nextConfig;
