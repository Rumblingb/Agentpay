import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About AgentPay',
  description:
    'AgentPay Labs builds payment infrastructure for AI agents: capability vaults, governed mandates, and verifiable settlement receipts.',
  alternates: { canonical: 'https://app.agentpay.so/about' },
  openGraph: {
    title: 'About AgentPay Labs',
    description: 'Payment infrastructure for governed AI agents and agentic commerce.',
    url: 'https://app.agentpay.so/about',
    type: 'website',
  },
};

export default function AboutPage() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'AgentPay Labs',
        url: 'https://app.agentpay.so/',
        logo: 'https://app.agentpay.so/opengraph-image',
        address: { '@type': 'PostalAddress', addressLocality: 'London', addressCountry: 'GB' },
        sameAs: ['https://github.com/Rumblingb/Agentpay'],
      },
      {
        '@type': 'WebSite',
        name: 'AgentPay',
        url: 'https://app.agentpay.so/',
        description: 'Payment infrastructure for governed AI agents and agentic commerce.',
      },
    ],
  };

  return (
    <main className="min-h-screen bg-[#080808] text-[#d4d4d4]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <header className="border-b border-[#1b1b1b] px-6 py-4">
        <nav className="mx-auto flex max-w-4xl items-center justify-between" aria-label="About navigation">
          <Link href="/" className="font-semibold text-white hover:text-emerald-400 transition">
            AgentPay
          </Link>
          <div className="flex gap-5 text-sm text-neutral-500">
            <Link href="/docs" className="hover:text-white transition">Docs</Link>
            <Link href="/commerce" className="hover:text-white transition">Commerce</Link>
            <Link href="/trust" className="hover:text-white transition">Trust</Link>
          </div>
        </nav>
      </header>
      <article className="mx-auto max-w-4xl space-y-14 px-6 py-20">
        <section className="max-w-3xl space-y-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">AgentPay Labs · London</p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl">Payment infrastructure for AI agents.</h1>
          <p className="text-lg leading-8 text-neutral-400">
            AgentPay gives agents a governed way to discover capabilities, request approval, and complete payment workflows without putting raw credentials or unbounded spending into the prompt loop.
          </p>
        </section>
        <section className="grid gap-5 md:grid-cols-3" aria-label="AgentPay pillars">
          {[
            ['Capability vaults', 'Connect paid tools once while keeping upstream credentials out of agent context.'],
            ['Governed mandates', 'Set budgets and approval thresholds before an agent takes a consequential action.'],
            ['Verifiable receipts', 'Return a clear settlement trail that people and systems can audit.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-[#222] bg-[#0d0d0d] p-6">
              <h2 className="text-base font-semibold text-white">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-neutral-500">{body}</p>
            </div>
          ))}
        </section>
        <section className="space-y-4 border-t border-[#222] pt-10">
          <h2 className="text-2xl font-semibold text-white">Explore the live surfaces</h2>
          <p className="max-w-2xl leading-7 text-neutral-400">Read the quickstart, inspect the public network, or try the sandbox shopping experience.</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/docs" className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-black hover:bg-emerald-400 transition">Read the docs</Link>
            <Link href="/network" className="rounded-lg border border-[#333] px-4 py-2 text-neutral-200 hover:border-emerald-500 transition">Explore the network</Link>
            <Link href="/commerce" className="rounded-lg border border-[#333] px-4 py-2 text-neutral-200 hover:border-emerald-500 transition">Try Commerce</Link>
          </div>
        </section>
      </article>
    </main>
  );
}
