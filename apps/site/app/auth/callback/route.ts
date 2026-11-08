import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getPostLoginRedirect } from '@/lib/auth-dest';

/** OAuth (Google) and password-reset links land here with a PKCE `code`. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next');

  if (code) {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const dest = await getPostLoginRedirect(supabase, data.user, nextParam);
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }
  const reason = searchParams.get('error_description') || 'That sign-in link did not work. Try again.';
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);
}
