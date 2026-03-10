import Link from 'next/link';

interface Props {
  /** Controls which sub-nav items appear and visual treatment.
   *  'homepage' — absolute-positioned over the hero gradient
   *  'network'  — standard block header on the slate-950 bg
   */
  variant?: 'homepage' | 'network';
}

/**
 * Shared public-facing navigation header.
 *
 * Used on the homepage (absolute over hero gradient) and on all
 * /network/* pages via the network layout — creating a single
 * recognizable product shell across both surfaces.
 */
export function PublicHeader({ variant = 'network' }: Props) {
  const isHomepage = variant === 'homepage';

  return (
    <header
      className={[
        'px-6 py-4 flex items-center justify-between',
        isHomepage
          ? 'absolute top-0 left-0 right-0 z-20 border-b border-white/5'
          : 'border-b border-slate-800',
      ].join(' ')}
    >
      {/* Brand — always links back to / */}
      <Link
        href="/"
        className="flex items-center gap-2 font-bold text-lg text-white hover:opacity-90 transition"
      >
        <span className="text-emerald-400">⚡</span>
        AgentPay
      </Link>

      <nav className="flex items-center gap-5 text-sm text-slate-400">
        {/* Network sub-nav: shown on homepage as a single "Network" link;
            on /network pages we show the internal sub-pages instead */}
        {isHomepage ? (
          <Link href="/network" className="hover:text-slate-100 transition">
            Network
          </Link>
        ) : (
          <>
            <Link href="/network/feed" className="hover:text-slate-100 transition">
              Live Feed
            </Link>
            <Link
              href="/network/leaderboard"
              className="hover:text-slate-100 transition hidden sm:inline"
            >
              Leaderboard
            </Link>
            <Link
              href="/registry"
              className="hover:text-slate-100 transition hidden md:inline"
            >
              Registry
            </Link>
            <Link
              href="/market"
              className="hover:text-slate-100 transition hidden md:inline"
            >
              Market
            </Link>
            <Link
              href="/trust"
              className="hover:text-slate-100 transition hidden md:inline"
            >
              Trust
            </Link>
          </>
        )}

        {/* Docs link — always present */}
        <a
          href="https://github.com/Rumblingb/Agentpay#readme"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-slate-100 transition hidden md:inline"
        >
          Docs
        </a>

        {/* Open App CTA — consistent across all public pages */}
        <Link
          href="/login"
          className="bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 px-3 py-1.5 rounded-lg transition font-medium"
        >
          Open App
        </Link>
      </nav>
    </header>
  );
}
