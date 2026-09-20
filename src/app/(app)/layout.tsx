import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { authStatus } from '@/lib/config';
import { Shell } from '@/components/shell';

/**
 * Every CRM page sits under this layout, so the auth check happens server-side
 * once rather than being repeated (and forgotten) per page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (authStatus().status === 'NOT_CONFIGURED') redirect('/login');

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <Shell user={{ email: user.email, full_name: user.full_name }}>{children}</Shell>;
}
