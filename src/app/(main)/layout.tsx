import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return <Shell showLogout={process.env.REQUIRE_LOGIN === 'true'}>{children}</Shell>;
}
