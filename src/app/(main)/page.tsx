'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import OfficeDock from '@/components/OfficeDock';

/** Home = only the virtual office, full screen. Swipe sideways to open Trade. */
export default function Home() {
  const router = useRouter();
  useEffect(() => { router.prefetch('/trade'); }, [router]);
  return <OfficeDock full onSwipe={() => router.push('/trade')} />;
}
