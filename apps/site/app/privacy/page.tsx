import type { Metadata } from 'next';
import { LegalPage, Section } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What Fremwork collects, why, and the choices you have.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <Section title="What we collect">
        <ul>
          <li><strong>Account details:</strong> your name, email address and password, or your Google sign-in.</li>
          <li><strong>Waitlist and event details:</strong> what you enter when you join the waitlist or register for an event.</li>
          <li><strong>Fremwork AI data:</strong> the transactions, budgets, goals, projects, tasks and chats you add to the app.</li>
          <li><strong>Website visits:</strong> a random browser ID stored in a cookie and in your browser, the pages you view, the site that referred you, the campaign link you used, and your approximate location (country, region and city). If you sign up or register for an event, we link this visit record to your email address.</li>
        </ul>
      </Section>
      <Section title="How we use it">
        <p>We use this information to run your account and the app, answer your AI requests, manage event places, send emails about your account or registration, keep the service secure, and understand how people find and use Fremwork.</p>
        <p>We do not sell your personal information.</p>
      </Section>
      <Section title="Who processes it for us">
        <ul>
          <li><strong>Supabase:</strong> database and sign-in.</li>
          <li><strong>Vercel:</strong> website and app hosting.</li>
          <li><strong>Resend:</strong> email delivery.</li>
          <li><strong>Google:</strong> Gemini answers your AI requests, so your messages and the ledger details needed for an answer are sent to Google. Google also handles Google sign-in if you choose it.</li>
        </ul>
        <p>These providers may process information outside your country.</p>
      </Section>
      <Section title="Financial information">
        <p>Your ledger is private to your account. Fremwork AI gives general information based on the data you provide. It is not financial, tax or legal advice.</p>
      </Section>
      <Section title="Your choices">
        <p>You can ask us for a copy of your information, or ask us to correct or delete it, by emailing <a href="mailto:support@fremwork.com" className="lnk">support@fremwork.com</a>. You can clear the visit cookie and browser ID at any time in your browser settings.</p>
      </Section>
      <Section title="Contact">
        <p>Questions about this policy: <a href="mailto:support@fremwork.com" className="lnk">support@fremwork.com</a>. If we make important changes, we will update this page.</p>
      </Section>
    </LegalPage>
  );
}
