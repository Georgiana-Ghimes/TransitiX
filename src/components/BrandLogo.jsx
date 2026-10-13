import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import logoColor from '@/images/transitix-logo-color.png';
import logoMark from '@/images/transitix-mark.png';

/**
 * Brand mark / wordmark.
 * Color logo for light UI; white wordmark loads only when `html.dark` is active
 * (login stays light and must not pay for the dark asset).
 */
export default function BrandLogo({
  variant = 'full',
  className,
  imgClassName,
  alt = 'Transitix',
  priority = false,
}) {
  const [logoWhite, setLogoWhite] = useState('');

  useEffect(() => {
    if (variant === 'mark') return undefined;
    const root = document.documentElement;
    let cancelled = false;
    const loadWhite = () => {
      if (!root.classList.contains('dark')) return;
      import('@/images/transitix-logo-white.png').then((mod) => {
        if (!cancelled) setLogoWhite(mod.default);
      });
    };
    loadWhite();
    const mo = new MutationObserver(loadWhite);
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => {
      cancelled = true;
      mo.disconnect();
    };
  }, [variant]);

  if (variant === 'mark') {
    return (
      <img
        src={logoMark}
        alt={alt}
        width={96}
        height={96}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        className={cn('h-9 w-9 object-contain shrink-0', imgClassName, className)}
      />
    );
  }

  return (
    <span className={cn('relative inline-flex items-center min-w-0', className)}>
      <img
        src={logoColor}
        alt={alt}
        width={795}
        height={120}
        decoding={priority ? 'sync' : 'async'}
        fetchPriority={priority ? 'high' : 'auto'}
        className={cn(
          'h-8 w-auto max-w-[11.5rem] object-contain object-left dark:hidden',
          imgClassName,
        )}
      />
      {logoWhite ? (
        <img
          src={logoWhite}
          alt=""
          aria-hidden="true"
          width={795}
          height={120}
          decoding="async"
          className={cn(
            'h-8 w-auto max-w-[11.5rem] object-contain object-left hidden dark:block',
            imgClassName,
          )}
        />
      ) : null}
    </span>
  );
}

export { logoColor, logoMark };
