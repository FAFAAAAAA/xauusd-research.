'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** A single passive listener adds restrained depth on a mouse; touch stays steady. */
export default function DimensionalEffects() {
  const pathname = usePathname();

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    let active: HTMLElement | null = null;
    let frame = 0;
    let clientX = 0;
    let clientY = 0;

    const reset = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (active) {
        for (const key of ['--tilt-x', '--tilt-y', '--glare-x', '--glare-y']) active.style.removeProperty(key);
        active = null;
      }
    };

    const paint = () => {
      frame = 0;
      if (!active || !motion.matches || !pointer.matches) return;
      const rect = active.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      active.style.setProperty('--tilt-x', `${((.5 - y) * 4).toFixed(2)}deg`);
      active.style.setProperty('--tilt-y', `${((x - .5) * 6).toFixed(2)}deg`);
      active.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
      active.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !motion.matches || !pointer.matches) return reset();
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tilt="true"]') : null;
      if (element !== active) {
        reset();
        active = element;
      }
      if (!active) return;
      clientX = event.clientX;
      clientY = event.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
    motion.addEventListener('change', reset);
    pointer.addEventListener('change', reset);
    return () => {
      reset();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset);
      motion.removeEventListener('change', reset);
      pointer.removeEventListener('change', reset);
    };
  }, [pathname]);

  return null;
}
