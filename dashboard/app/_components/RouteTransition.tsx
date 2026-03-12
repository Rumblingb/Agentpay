use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function RouteTransition() {
  const pathname = usePathname();

  useEffect(() => {
    if (!document) return;
    const veil = document.createElement('div');
    veil.className = 'route-veil active';
    document.body.appendChild(veil);

    const t = setTimeout(() => {
      veil.classList.remove('active');
    }, 220);

    const cleanup = () => {
      clearTimeout(t);
      if (veil.parentNode) veil.parentNode.removeChild(veil);
    };

    // remove after transition
    const done = setTimeout(cleanup, 500);

    return () => {
      clearTimeout(done);
      cleanup();
    };
  }, [pathname]);

  return null;
}
