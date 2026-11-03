'use client';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/** Decorative, reduced-motion-safe scroll reveal. Content always exists in the DOM. */
export default function ScrollReveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    node.classList.add('is-pending');
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        node.classList.add('is-visible');
        observer.disconnect();
      }
    }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });
    observer.observe(node);
    return () => { observer.disconnect(); node.classList.remove('is-pending'); };
  }, []);
  return <div ref={ref} className={'apple-reveal ' + className}>{children}</div>;
}
