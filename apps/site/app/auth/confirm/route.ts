import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getPostLoginRedirect } from '@/lib/auth-dest';

/**
 * Email links that carry a `token_hash` (invites, sign-up confirmation, recovery).
 * The email templates in supabase/templates point here.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const nextParam = searchParams.get('next');

  if (tokenHash && type) {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data.user) {
      const dest = await getPostLoginRedirect(supabase, data.user, nextParam);
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('That link has expired. Ask for a new one.')}`);
}
