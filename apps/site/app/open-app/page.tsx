'use client';

import { useEffect } from 'react';
import { APP_URL } from '@/lib/app-url';

/**
 * Sends the visitor to the Fremwork AI workspace's own sign-in page. Sessions are never handed
 * from this site to the workspace: a page that auto-submits tokens to another domain is what
 * phishing kits do, and Google Safe Browsing flagged the workspace for receiving them.
 */
export default function OpenAppPage() {
  const target = new URL('/sign-in', APP_URL).href;
  useEffect(() => {
    window.location.replace(target);
  }, [target]);
  return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', fontFamily: "'Geist', system-ui, sans-serif" }}>
    <p role="status">Opening Fremwork AI… <a href={target}>Continue</a></p>
  </div>;
}
