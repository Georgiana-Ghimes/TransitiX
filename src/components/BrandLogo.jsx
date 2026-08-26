import React from 'react';
import { cn } from '@/lib/utils';
import logoColor from '@/images/Asset 5TRANSITIX-LOGO.png';
import logoWhite from '@/images/Asset 10TRANSITIX-LOGO-ALB.png';
import logoMark from '@/images/512x512-FAVICON-TRANSITIX.png';

/**
 * Brand mark / wordmark.
 * Color logo for light UI; white wordmark when `html.dark` is active.
 */
export default function BrandLogo({
  variant = 'full',
  className,
  imgClassName,
  alt = 'Transitix',
}) {
  if (variant === 'mark') {
    return (
      <img
        src={logoMark}
        alt={alt}
        className={cn('h-9 w-9 object-contain shrink-0', imgClassName, className)}
      />
    );
  }

  return (
    <span className={cn('relative inline-flex items-center min-w-0', className)}>
      <img
        src={logoColor}
        alt={alt}
        className={cn(
          'h-8 w-auto max-w-[11.5rem] object-contain object-left dark:hidden',
          imgClassName
        )}
      />
      <img
        src={logoWhite}
        alt=""
        aria-hidden="true"
        className={cn(
          'h-8 w-auto max-w-[11.5rem] object-contain object-left hidden dark:block',
          imgClassName
        )}
      />
    </span>
  );
}

export { logoColor, logoWhite, logoMark };
