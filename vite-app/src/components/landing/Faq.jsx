// src/components/landing/Faq.jsx — objection handling.
//
// Native <details>/<summary>: zero JS, keyboard-accessible by default.
//
// These answers are EDITABLE PLACEHOLDERS. Do not add specific
// certifications (SOC 2, ISO, HIPAA) or contractual guarantees unless
// they have been verified — an unverified compliance claim on a page
// aimed at paid traffic is a liability, not a conversion lever.
import React from 'react';
import Eyebrow from './Eyebrow';

const FAQS = [
  {
    q: 'Is my data secure?',
    a: 'Every record is scoped to your own workspace, and your WhatsApp and Meta credentials are encrypted at rest with AES-256-GCM. Traffic is served over TLS. If you need a security review before signing up, contact sales and we will walk you through exactly how the setup works.',
  },
  {
    q: 'How long does setup take?',
    a: 'Most teams are live the same day. You connect your WhatsApp Business number, paste in the facts your AI is allowed to use, and send a test message. Meta Ads attribution takes a little longer if you have not set up the Conversions API before.',
  },
  {
    q: 'What happens after the 14-day trial?',
    a: 'You pick a plan and carry on, or you do nothing and the workspace pauses. No card is required to start, so nothing is charged automatically when the trial ends.',
  },
  {
    q: 'Does this replace my sales team?',
    a: 'No — it replaces the follow-up your team never gets to. The AI handles qualification and first response around the clock, then hands over to a human when a lead is ready to buy or asks something outside its brief. Your closers spend their time on leads that are already warm.',
  },
  {
    q: 'Do I need my own WhatsApp Business account?',
    a: 'Yes. You connect your own WhatsApp Business number so conversations happen under your brand and you keep ownership of the number and the message history.',
  },
  {
    q: 'Can the AI make things up about my product?',
    a: 'It is constrained not to. The Closer agent may only use facts you have supplied in your configuration, and replies that stray outside that — inventing discounts, guarantees or services you do not offer — are blocked before they are sent.',
  },
];

export default function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="border-y border-indigo-500/10">
      <div className="max-w-3xl mx-auto px-6 py-20 md:py-28">
        <div className="text-center mb-12">
          <Eyebrow className="mb-4">Questions</Eyebrow>
          <h2 id="faq-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            Before you <span className="gradient-text">sign up</span>
          </h2>
        </div>

        <div className="space-y-3">
          {FAQS.map((item) => (
            <details
              key={item.q}
              className="group glass-card rounded-2xl px-6 py-5 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none text-base font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-lg">
                {item.q}
                <span
                  aria-hidden="true"
                  className="flex-shrink-0 text-indigo-400 text-xl leading-none transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-4 text-sm text-slate-400 leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
