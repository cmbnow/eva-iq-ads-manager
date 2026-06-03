import Link from 'next/link';

import { cn } from '@kit/ui/utils';

function LogoImage({
  className,
}: {
  className?: string;
  width?: number;
}) {
  return (
    <span
      className={cn(
        'text-lg font-bold tracking-tight whitespace-nowrap',
        className,
      )}
    >
      EVA<span className={'text-primary'}> IQ</span>
    </span>
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
