import Link from 'next/link';

import { cn } from '@kit/ui/utils';

function LogoImage({
  className,
}: {
  className?: string;
  width?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={'/images/evaiq-logo.svg'}
      alt={'EVA IQ Ads Manager'}
      className={cn('h-10 w-auto', className)}
    />
  );
}

export function AppLogo({
  href,
  label,
  className,
}: {
  href?: string | null;
  className?: string;
  label?: string;
}) {
  if (href === null) {
    return <LogoImage className={className} />;
  }

  return (
    <Link aria-label={label ?? 'Home Page'} href={href ?? '/'}>
      <LogoImage className={className} />
    </Link>
  );
}
