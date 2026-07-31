'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Only useful when you are somewhere other than the dashboard — on the dashboard itself
 * there is nothing to go back to, so it renders nothing.
 */
export function BackToStart({ label }: { label: string }) {
  const pathname = usePathname();
  if (pathname === '/') return null;
  return (
    <Link href="/" className="btn">
      ← {label}
    </Link>
  );
}
