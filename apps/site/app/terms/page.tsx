import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, Section } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms for using Fremwork and Fremwork AI.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <Section title="Using Fremwork">
        <p>By using Fremwork you agree to these terms. Keep your login details safe and give accurate information. You are responsible for what happens under your account.</p>
      </Section>
      <Section title="Acceptable use">
        <p>Don't break the law with Fremwork, try to reach other people's data, disrupt the service, or get around its limits.</p>
      </Section>
      <Section title="Your data">
        <p>What you add to Fremwork stays yours. You allow us to store and process it to provide the service, as described in our <Link href="/privacy" className="lnk">Privacy Policy</Link>.</p>
      </Section>
      <Section title="AI answers">
        <p>Fremwork AI can make mistakes. Its answers are general information, not financial, tax or legal advice. Check important figures and speak to a qualified professional before you rely on them.</p>
      </Section>
      <Section title="Early service">
        <p>Fremwork is a new product. Features may change, and the service may sometimes be unavailable. Daily limits may apply to AI requests. Keep your own copies of important records.</p>
      </Section>
      <Section title="Events">
        <p>Event details can change. We will use the email address you registered with to tell you about changes.</p>
      </Section>
      <Section title="Closing your account">
        <p>You can ask us to close your account at any time. We may suspend accounts that break these terms.</p>
      </Section>
      <Section title="Contact">
        <p>Questions about these terms: <a href="mailto:support@fremwork.com" className="lnk">support@fremwork.com</a>.</p>
      </Section>
    </LegalPage>
  );
}
