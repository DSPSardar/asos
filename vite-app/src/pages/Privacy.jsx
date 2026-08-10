// src/pages/Privacy.jsx — DRAFT privacy policy.
//
// Written against what the code actually does, not from a template. The
// processor list below was taken from the outbound hosts in backend/src and
// the keys validated in backend/src/config/env.js. If you add a service that
// receives customer data, add it here in the same commit.
import React from 'react';
import LegalPage, { Section } from '@components/legal/LegalPage';
import { SALES_EMAIL } from '@components/landing/links';

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="11 August 2026">
      <p>
        This policy explains what ASOS collects, why, and who else processes it. ASOS is a
        sales automation platform: businesses connect their own WhatsApp Business number, and
        our AI agents read and reply to messages from the people who contact that number.
      </p>
      <p>
        Two groups of people appear below. <strong>Customers</strong> are the businesses that
        hold an ASOS account. <strong>End users</strong> are the people who message a
        customer&rsquo;s WhatsApp number. Most data in the system is about end users, and the
        customer — not ASOS — is the party that decides why it is collected.
      </p>

      <Section heading="What we collect">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Account data (customers):</strong> name, email address, password (stored
            only as a bcrypt hash — never in readable form), business name, and phone number.
          </li>
          <li>
            <strong>WhatsApp identifiers (end users):</strong> the phone number that messages
            the customer&rsquo;s business number, plus the display name WhatsApp supplies.
          </li>
          <li>
            <strong>Conversation content (end users):</strong> the full text of messages sent
            to and from the business number. This is stored, not just processed in transit —
            it is what the AI agents read to qualify a lead and write replies.
          </li>
          <li>
            <strong>AI-derived data:</strong> a lead stage, a score from 1 to 10, an inferred
            intent, and a short summary of the person&rsquo;s stated problem. These are
            machine-generated inferences and can be wrong.
          </li>
          <li>
            <strong>Payment confirmations:</strong> subscription status, plan, and billing
            events from Stripe. <strong>We never receive or store full card numbers</strong> —
            Stripe handles card data directly.
          </li>
          <li>
            <strong>Advertising attribution:</strong> where a lead came from, and conversion
            events sent to Meta&rsquo;s Conversions API when a customer enables it.
          </li>
          <li>
            <strong>Operational logs:</strong> IP addresses, request metadata, and error
            traces, kept for security and debugging.
          </li>
        </ul>
      </Section>

      <Section heading="How we use it">
        <ul className="list-disc pl-5 space-y-2">
          <li>To run the service: routing inbound messages, generating replies, and sending them back through WhatsApp.</li>
          <li>To qualify and score leads, and show customers a pipeline of them.</li>
          <li>To bill customers and enforce plan limits, including AI token usage.</li>
          <li>To attribute conversions to advertising, where the customer has configured it.</li>
          <li>To detect abuse, debug faults, and keep the service secure.</li>
        </ul>
        <p>
          We do not sell personal data, and we do not use end-user conversation content to
          train our own models.
        </p>
      </Section>

      <Section heading="Third-party processors">
        <p>Message content and related data are sent to these services in the course of running ASOS:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>OpenAI</strong> — runs the qualifying and reply-writing agents. Message content and conversation history are sent to it.</li>
          <li><strong>Meta (WhatsApp Business Platform)</strong> — delivers and receives every message; also receives conversion events via the Conversions API when enabled.</li>
          <li><strong>ElevenLabs</strong> — generates voice notes from text where a customer has enabled that feature.</li>
          <li><strong>Anthropic</strong> — used only by the marketing content studio for ad copy, not in the sales conversation pipeline.</li>
          <li><strong>Stripe</strong> — subscription billing and payment processing.</li>
          <li><strong>Twilio</strong> — voice call handling where enabled.</li>
          <li><strong>Resend</strong> — transactional email, such as password resets.</li>
          <li><strong>Google</strong> — optional sign-in with Google.</li>
          <li><strong>Replicate</strong> and <strong>Pollinations</strong> — image generation in the content studio.</li>
          <li><strong>Railway</strong> — hosting and managed databases. <strong>Cloudflare</strong> — CDN and DNS.</li>
        </ul>
        <p>
          Each has its own privacy terms. Several process data outside the country where a
          customer or end user is located.
        </p>
      </Section>

      <Section heading="AI processing, in plain terms">
        <p>
          Inbound WhatsApp messages are <strong>not</strong> end-to-end encrypted from
          ASOS&rsquo;s point of view. WhatsApp encrypts messages in transit to the business
          account, but the whole purpose of this product is that our agents read the content
          in order to answer it. Message text is therefore visible to ASOS and is sent to
          OpenAI. Do not use this product for conversations where that is unacceptable.
        </p>
        <p>
          Replies are machine-generated. They can be wrong, and the customer is responsible
          for what is sent from their business number.
        </p>
      </Section>

      <Section heading="Retention">
        <p>
          <strong>We do not currently run automatic deletion.</strong> Account data,
          conversations, messages, and AI logs are retained for as long as the account is
          open. Customers can delete individual leads from the dashboard, which also removes
          that lead&rsquo;s conversations, messages, AI logs, and activity records.
        </p>
        <p>
          To have an account and its data deleted, email us at the address below. Note that a
          scheduled retention window is not yet implemented; if you need a defined retention
          period for a compliance obligation, raise it with us before onboarding.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          Passwords are hashed with bcrypt. WhatsApp and Meta credentials are encrypted at
          rest with AES-256-GCM. Traffic is served over TLS. Each customer&rsquo;s records are
          scoped to their own workspace, enforced in the application layer of every query.
        </p>
        <p>
          We hold no third-party security certification. We do not claim SOC 2, ISO 27001,
          HIPAA, or GDPR certification, and we do not offer an uptime guarantee.
        </p>
      </Section>

      <Section heading="Your rights">
        <p>
          Depending on where you live, you may have rights to access, correct, export, or
          delete your personal data, and to object to certain processing. End users should
          contact the business they messaged, since that business decides why their data is
          held. If you cannot reach them, contact us and we will help route the request.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions or requests: <a className="text-indigo-400 hover:text-indigo-300 underline" href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>
        </p>
      </Section>
    </LegalPage>
  );
}
