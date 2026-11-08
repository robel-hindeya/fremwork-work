import type { SupabaseClient, User } from '@supabase/supabase-js';

const EMBEDDED_ADMIN_EMAILS = ['edomiyastesfaye321@gmail.com'];

export const ADMIN_EMAILS = new Set<string>([
  ...EMBEDDED_ADMIN_EMAILS,
  ...(process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  ...(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
]);

/** Checks whether a user is an admin or owner. */
export async function checkIsAdmin(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null }
): Promise<boolean> {
  const email = (user.email ?? '').toLowerCase().trim();
  if (email && ADMIN_EMAILS.has(email)) {
    return true;
  }

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile && (profile.role === 'owner' || profile.role === 'admin')) {
      return true;
    }
  } catch {
    // If table read fails, fall back to email check result
  }

  return false;
}

/** Determines post-login redirect destination. */
export async function getPostLoginRedirect(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  nextParam?: string | null
): Promise<string> {
  const isAdmin = await checkIsAdmin(supabase, user);

  if (nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')) {
    if (nextParam.startsWith('/admin') && !isAdmin) {
      return '/open-app';
    }
    if (nextParam === '/open-app' && isAdmin) {
      return '/admin';
    }
    return nextParam;
  }

  return isAdmin ? '/admin' : '/open-app';
}
