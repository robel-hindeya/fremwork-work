import type { SupabaseClient } from '@supabase/supabase-js';

/** Roles are read from the authenticated user's database profile; failures deny access. */
export async function checkIsAdmin(supabase: SupabaseClient, user: { id: string }): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    return !error && (data?.role === 'owner' || data?.role === 'admin');
  } catch { return false; }
}

export async function getPostLoginRedirect(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  nextParam?: string | null,
): Promise<string> {
  const allowed = ['/open-app', '/admin', '/set-password'];
  if (!nextParam || !allowed.includes(nextParam)) return '/open-app';
  if (nextParam === '/admin' && !(await checkIsAdmin(supabase, user))) return '/open-app';
  return nextParam;
}
