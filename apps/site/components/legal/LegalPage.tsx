import type { ReactNode } from 'react';
import Link from 'next/link';

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: '720px', margin: '0 auto', padding: '56px 20px 80px', color: '#1A1A1A', fontSize: '16px', lineHeight: 1.65 }}>
      <Link href="/" className="lnk" style={{ color: '#5E5E5E', fontSize: '14px' }}>Back to Fremwork</Link>
      <h1 style={{ fontSize: '40px', lineHeight: 1.1, letterSpacing: '-0.03em', fontWeight: 600, margin: '28px 0 8px' }}>{title}</h1>
      <p style={{ color: '#5E5E5E', fontSize: '14px', margin: '0 0 36px' }}>Last updated November 7, 2026</p>
      {children}
    </main>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: '28px' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 8px' }}>{title}</h2>
      {children}
    </section>
  );
}
