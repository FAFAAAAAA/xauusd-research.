'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loading } from '@/components/Status';

const Backtest = dynamic(() => import('@/app/(main)/analytics/page'), { loading: () => <Loading /> });
const Calculator = dynamic(() => import('@/app/(main)/calculator/page'), { loading: () => <Loading /> });
const Trade = dynamic(() => import('@/app/(main)/trade/page'), { loading: () => <Loading /> });
const News = dynamic(() => import('@/app/(main)/news/page'), { loading: () => <Loading /> });
const Settings = dynamic(() => import('@/app/(main)/settings/page'), { loading: () => <Loading /> });

export const RESEARCH_LINKS = [
  { id: 'backtest', href: '/analytics', label: 'Backtest', Component: Backtest },
  { id: 'calculator', href: '/calculator', label: 'Kalkulator', Component: Calculator },
  { id: 'trade', href: '/trade', label: 'Trade', Component: Trade },
  { id: 'news', href: '/news', label: 'Berita', Component: News },
  { id: 'settings', href: '/settings', label: 'Atur', Component: Settings },
] as const;

export default function ResearchFlow({ onActive }: { onActive: (href: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const path = usePathname();
  const active = useRef(path);
  const navigating = useRef(false);

  useEffect(() => {
    if (active.current === path && root.current?.dataset.ready) return;
    const item = RESEARCH_LINKS.find((item) => item.href === path) ?? RESEARCH_LINKS[0];
    active.current = item.href;
    onActive(item.href);
    navigating.current = true;
    const frame = requestAnimationFrame(() => {
      document.getElementById(item.id)?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
      if (root.current) root.current.dataset.ready = 'true';
      navigating.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [path, onActive]);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (navigating.current || document.body.style.overflow === 'hidden') return;
      let current: (typeof RESEARCH_LINKS)[number] = RESEARCH_LINKS[0];
      for (const item of RESEARCH_LINKS) {
        const element = document.getElementById(item.id);
        if (element && element.getBoundingClientRect().top <= 150) current = item;
      }
      if (active.current !== current.href) {
        active.current = current.href;
        onActive(current.href);
        window.history.replaceState(null, '', current.href);
      }
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', scroll, { passive: true });

    // Reveal content arriving from API requests as well as the initial cards.
    const seen = new WeakSet<Element>();
    const reveal = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        reveal.unobserve(entry.target);
      }
    }, { threshold: 0.04 });
    const observe = () => {
      container.querySelectorAll('.page-head, .group, .panel, .metrics').forEach((element) => {
        if (seen.has(element) || element.closest('[role="dialog"]')) return;
        seen.add(element);
        element.classList.add('flow-reveal');
        reveal.observe(element);
      });
    };
    observe();
    const mutations = new MutationObserver(observe);
    mutations.observe(container, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scroll);
      reveal.disconnect();
      mutations.disconnect();
    };
  }, [onActive]);

  return <div className="research-flow" ref={root}>
    {RESEARCH_LINKS.map(({ id, label, Component }, index) => (
      <section key={id} id={id} className="research-section" aria-label={label}>
        <Component />
        {index < RESEARCH_LINKS.length - 1 ? (
          <a className="flow-next" href={RESEARCH_LINKS[index + 1].href} onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            document.getElementById(RESEARCH_LINKS[index + 1].id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' as ScrollBehavior : 'smooth' });
          }}>{RESEARCH_LINKS[index + 1].label}<span aria-hidden>↓</span></a>
        ) : null}
      </section>
    ))}
  </div>;
}
