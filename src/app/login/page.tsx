import { redirect } from 'next/navigation';
import { getCurrentUser, countUsers } from '@/lib/auth';
import { authStatus, databaseStatus } from '@/lib/config';
import { LoginForm } from './form';

export default async function LoginPage() {
  const auth = authStatus();
  const database = databaseStatus();

  if (auth.status === 'CONFIGURED' && database.status === 'CONFIGURED') {
    const user = await getCurrentUser();
    if (user) redirect('/');
  }

  let needsSetup = false;
  if (auth.status === 'CONFIGURED' && database.status === 'CONFIGURED') {
    try {
      needsSetup = (await countUsers()) === 0;
    } catch {
      // A database that cannot be reached is reported by the form, not here.
    }
  }

  return (
    <LoginForm
      needsSetup={needsSetup}
      authMissing={auth.status === 'NOT_CONFIGURED' ? auth.missing : []}
      databaseMissing={database.status === 'NOT_CONFIGURED' ? database.missing : []}
    />
  );
}
