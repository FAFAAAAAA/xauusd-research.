import Shell from '@/components/Shell';

// Pages are client components that load their own data, so the shell can be prerendered.
// This makes switching tabs instant (Next.js prefetches and caches static routes).
// REQUIRE_LOGIN is read at build time: change it in Vercel → redeploy.
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return <Shell showLogout={process.env.REQUIRE_LOGIN === 'true'}>{children}</Shell>;
}
