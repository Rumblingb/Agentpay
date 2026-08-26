'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  LockKeyhole,
  ShieldAlert,
} from 'lucide-react';

type Category = 'All' | 'Platform' | 'Agent systems' | 'Apps' | 'Robotics' | 'ChatGPT Sites' | 'Distribution' | 'Boundary';
type Access = 'Live' | 'Store live' | 'Public demo' | 'Private preview' | 'Local proof' | 'Separate';

type Experiment = {
  name: string;
  summary: string;
  categories: Exclude<Category, 'All'>[];
  access: Access;
  proof: string;
  nextGate: string;
  href?: string;
  cta?: string;
};

const categories: Category[] = ['All', 'Platform', 'Agent systems', 'Apps', 'Robotics', 'ChatGPT Sites', 'Distribution', 'Boundary'];

const experiments: Experiment[] = [
  {
    name: 'AgentPay Core',
    summary: 'Governed capability access, approval mandates, payment workflows, and verifiable receipts for AI agents.',
    categories: ['Platform'],
    access: 'Live',
    proof: 'Public API health and documentation are reachable. The dashboard release candidate is still being verified separately.',
    nextGate: 'Prove the claim-safe dashboard build in Preview before any Production promotion.',
    href: 'https://docs.agentpay.so',
    cta: 'Read the docs',
  },
  {
    name: 'Bee & Clickey',
    summary: 'A founder-control experiment for guarded delegation, approval gestures, receipts, and on-device operations.',
    categories: ['Agent systems'],
    access: 'Local proof',
    proof: 'Local control, guard, mandate, approval, settlement, and receipt paths have verified development evidence.',
    nextGate: 'Keep fund execution walled and publish only after a dedicated security and product release review.',
  },
  {
    name: 'ThreadLight',
    summary: 'A voice-first workroom for triage, revisions, approvals, and durable task receipts.',
    categories: ['Agent systems', 'ChatGPT Sites'],
    access: 'Private preview',
    proof: 'Owner-only Sites deployment and local automated tests exist; embedded realtime voice remains labelled Demo Mode.',
    nextGate: 'Public auth, tenant isolation, privacy, abuse controls, and physical microphone evidence.',
  },
  {
    name: 'Hype Pet',
    summary: 'A phone companion and physical interaction experiment with a safety-first mechanical validation path.',
    categories: ['Apps', 'Robotics'],
    access: 'Local proof',
    proof: 'Local app tests, type checks, Expo checks, web export, and mechanical validation artifacts exist.',
    nextGate: 'Physical-device, fit, thermal, retention, feedback, public demo, and submission evidence.',
  },
  {
    name: 'IRONLINK',
    summary: 'A simulated robot-operator world exploring human authority transfer, adaptive opponents, and embodied telemetry.',
    categories: ['Robotics', 'ChatGPT Sites'],
    access: 'Public demo',
    proof: 'The public ChatGPT Site loads and its first simulated level has been exercised end to end.',
    nextGate: 'Real robotics remains unproven; hardware calibration, additional levels, and the public MCP surface are open.',
    href: 'https://ironlink.vishar-baskaran.chatgpt.site/',
    cta: 'Open the demo',
  },
  {
    name: 'Power Cabinet',
    summary: 'A mobile collection and writing experiment built around geek culture, discovery, and playful utility.',
    categories: ['Apps'],
    access: 'Store live',
    proof: 'The iOS listing is publicly reachable.',
    nextGate: 'Android still needs its signed build and store-testing path; store availability is platform-specific.',
    href: 'https://apps.apple.com/us/app/power-cabinet/id6766289130',
    cta: 'View on the App Store',
  },
  {
    name: 'Med Voice',
    summary: 'A voice-led daily check-in app designed to make personal reflection and care routines easier to revisit.',
    categories: ['Apps'],
    access: 'Store live',
    proof: 'The iOS listing is publicly reachable; local source checks have passed.',
    nextGate: 'Fresh physical microphone, playback, and Android release evidence remain open.',
    href: 'https://apps.apple.com/us/app/med-voice-daily-check-in/id6780071067',
    cta: 'View on the App Store',
  },
  {
    name: 'Voice Flash',
    summary: 'A voice-first spaced-repetition experiment for creating and reviewing flashcards hands-free.',
    categories: ['Apps'],
    access: 'Store live',
    proof: 'The iOS listing is publicly reachable under its current store name.',
    nextGate: 'Correct the listing name and complete the Android testing and release path.',
    href: 'https://apps.apple.com/us/app/voice-flash-ac8edd/id6780071150',
    cta: 'View on the App Store',
  },
  {
    name: 'One Question Daily',
    summary: 'A daily voice-journal experiment built around one focused prompt at a time.',
    categories: ['Apps'],
    access: 'Local proof',
    proof: 'Android source identity and a historical staged artifact have been reconciled locally.',
    nextGate: 'Public Android availability and the separate iOS identity decision remain open.',
  },
  {
    name: 'Postiz Distribution Rail',
    summary: 'The guarded publishing rail used to prepare and coordinate approved AgentPay Labs distribution.',
    categories: ['Distribution'],
    access: 'Live',
    proof: 'The public product page and local runtime health are verified; publication remains approval-gated.',
    nextGate: 'Every named draft, schedule, OAuth grant, and publication remains a separate action-time decision.',
    href: 'https://agentpay.so/postizzz',
    cta: 'View the product page',
  },
  {
    name: 'Bill Hedge',
    summary: 'A separate financial-markets brain that shares infrastructure boundaries, not Labs product authority or state.',
    categories: ['Boundary'],
    access: 'Separate',
    proof: 'Only the separation boundary is represented here; no positions, strategies, orders, credentials, or performance data are exposed.',
    nextGate: 'It remains outside AgentPay Labs experiments, releases, analytics, automation, and customer claims.',
  },
];

const accessStyles: Record<Access, string> = {
  Live: 'border-emerald-500/25 bg-emerald-500/8 text-emerald-300',
  'Store live': 'border-sky-500/25 bg-sky-500/8 text-sky-300',
  'Public demo': 'border-violet-500/25 bg-violet-500/8 text-violet-300',
  'Private preview': 'border-amber-500/25 bg-amber-500/8 text-amber-300',
  'Local proof': 'border-neutral-600 bg-white/[0.03] text-neutral-300',
  Separate: 'border-rose-500/25 bg-rose-500/8 text-rose-300',
};

function AccessIcon({ access }: { access: Access }) {
  if (access === 'Live' || access === 'Store live' || access === 'Public demo') return <CheckCircle2 size={13} aria-hidden="true" />;
  if (access === 'Private preview') return <LockKeyhole size={13} aria-hidden="true" />;
  if (access === 'Separate') return <ShieldAlert size={13} aria-hidden="true" />;
  return <CircleDashed size={13} aria-hidden="true" />;
}

export default function ExperimentsExplorer() {
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const filteredExperiments = useMemo(
    () => activeCategory === 'All' ? experiments : experiments.filter((experiment) => experiment.categories.includes(activeCategory)),
    [activeCategory],
  );

  return (
    <>
      <header className="border-b border-[#1b1b1b] px-5 py-4 sm:px-6">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4" aria-label="Experiments navigation">
          <Link href="/" className="flex items-center gap-2 font-semibold text-white transition hover:text-emerald-400">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-black"><FlaskConical size={15} aria-hidden="true" /></span>
            AgentPay Labs
          </Link>
          <div className="flex items-center gap-4 text-sm text-neutral-500 sm:gap-6">
            <Link href="/about" className="transition hover:text-white">About</Link>
            <Link href="/docs" className="transition hover:text-white">Docs</Link>
            <Link href="/trust" className="hidden transition hover:text-white sm:inline">Trust</Link>
          </div>
        </nav>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
        <section className="max-w-4xl">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-6xl">
            A public workbench for products we can prove.
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-7 text-neutral-400 sm:text-lg sm:leading-8">
            Explore what AgentPay Labs is building across agent systems, mobile apps, robotics, ChatGPT Sites, and distribution. Every entry separates what works now from what still needs evidence.
          </p>
        </section>

        <section className="mt-12 grid border-y border-[#222] sm:grid-cols-3" aria-label="How to read the experiments ledger">
          {[
            ['Try what is available', 'Public links appear only where the current destination has been checked.'],
            ['Inspect the proof', 'Each row says what has actually been tested, built, or released.'],
            ['See the next gate', 'Limitations stay visible instead of being hidden behind launch language.'],
          ].map(([title, body], index) => (
            <div key={title} className={`py-6 sm:px-6 ${index > 0 ? 'border-t border-[#222] sm:border-l sm:border-t-0' : ''}`}>
              <h2 className="text-sm font-semibold text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-500">{body}</p>
            </div>
          ))}
        </section>

        <section className="mt-12" aria-labelledby="experiments-ledger-title">
          <div className="flex flex-col gap-6 border-b border-[#222] pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 id="experiments-ledger-title" className="text-2xl font-semibold tracking-tight text-white">Experiments ledger</h2>
              <p className="mt-2 text-sm text-neutral-500" aria-live="polite">Showing {filteredExperiments.length} of {experiments.length} entries.</p>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter experiments">
              {categories.map((category) => (
                <button
                  key={category}
                  id={`experiments-tab-${category.toLowerCase().replaceAll(' ', '-')}`}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === category}
                  aria-controls="experiments-panel"
                  onClick={() => setActiveCategory(category)}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-500/60 ${
                    activeCategory === category
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-[#252525] bg-[#0c0c0c] text-neutral-500 hover:border-[#3a3a3a] hover:text-neutral-300'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          <div
            id="experiments-panel"
            role="tabpanel"
            aria-labelledby={`experiments-tab-${activeCategory.toLowerCase().replaceAll(' ', '-')}`}
            className="divide-y divide-[#202020]"
          >
            {filteredExperiments.map((experiment) => (
              <article key={experiment.name} className="grid gap-6 py-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold tracking-tight text-white">{experiment.name}</h3>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${accessStyles[experiment.access]}`}>
                      <AccessIcon access={experiment.access} />
                      {experiment.access}
                    </span>
                  </div>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400">{experiment.summary}</p>
                  <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-neutral-600">
                    {experiment.categories.map((category) => <span key={category}>{category}</span>)}
                  </div>
                  {experiment.href && experiment.cta ? (
                    <a
                      href={experiment.href}
                      target={experiment.href.startsWith('http') ? '_blank' : undefined}
                      rel={experiment.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                      className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400 transition hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                    >
                      {experiment.cta}<ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600">Current proof</p>
                  <p className="mt-3 text-sm leading-6 text-neutral-400">{experiment.proof}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600">Next gate</p>
                  <p className="mt-3 text-sm leading-6 text-neutral-400">{experiment.nextGate}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10 border-t border-[#222] pt-10">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-semibold tracking-tight text-white">The boundary is part of the product.</h2>
            <p className="mt-4 text-sm leading-7 text-neutral-400">
              “Live,” “store live,” “public demo,” “private preview,” and “local proof” are different states. AgentPay Labs publishes the state it can verify and keeps payments, account changes, store releases, social publishing, and the separate financial-markets brain behind their own approval boundaries.
            </p>
          </div>
        </section>
      </div>

      <footer className="border-t border-[#1b1b1b] px-5 py-7 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 text-sm text-neutral-600 sm:flex-row sm:items-center sm:justify-between">
          <span>AgentPay Labs · London</span>
          <div className="flex flex-wrap gap-5">
            <Link href="/" className="transition hover:text-white">AgentPay</Link>
            <Link href="/privacy" className="transition hover:text-white">Privacy</Link>
            <Link href="/terms" className="transition hover:text-white">Terms</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
