import Link from 'next/link';
import FoundingRibbon from './FoundingRibbon';

interface Props {
  /** Controls which sub-nav items appear and visual treatment.
   *  'homepage' — absolute-positioned over the hero
   *  'network'  — standard block header on the black bg
   */
  variant?: 'homepage' | 'network';
}

/**
 * Shared public-facing navigation header.
 *
 * Used on the homepage (absolute over hero) and on all
 * /network/* pages via the network layout — creating a single
 * recognizable product shell across both surfaces.
 */
export function PublicHeader({ variant = 'network' }: Props) {
  const isHomepage = variant === 'homepage';

  return (
    <>
      <FoundingRibbon />
      <header
        className={[
          'px-6 py-4 flex items-center justify-between',
          isHomepage
            ? 'absolute top-0 left-0 right-0 z-20 border-b border-white/[0.04]'
            : 'border-b border-neutral-900 bg-black/90 backdrop-blur-md sticky top-0 z-30',
        ].join(' ')}
      >
      {/* Brand */}
      <Link
        href="/"
        className="flex items-center gap-2.5 font-semibold text-sm text-white hover:opacity-80 transition-opacity duration-200 tracking-tight"
      >
        <span className="text-emerald-400 text-base leading-none">⬡</span>
        <span className="tracking-tight">AgentPay</span>
      </Link>

      <nav className="flex items-center gap-6 text-sm text-neutral-500">
        <Link href="/network" className="hover:text-neutral-200 transition-colors duration-200">
          Network
        </Link>
        {!isHomepage && (
          <Link href="/network/feed" className="hover:text-neutral-200 transition-colors duration-200 hidden sm:inline">
            Live Feed
          </Link>
        )}
        <Link
          href="/registry"
          className="hover:text-neutral-200 transition-colors duration-200 hidden md:inline"
        >
          Registry
        </Link>
        <Link
          href="/market"
          className="hover:text-neutral-200 transition-colors duration-200 hidden md:inline"
        >
          Market
        </Link>
        <Link
          href="/trust"
          className="hover:text-neutral-200 transition-colors duration-200 hidden md:inline"
        >
          Trust
        </Link>
        <Link
          href="/build"
          className="hover:text-neutral-200 transition-colors duration-200 hidden md:inline"
        >
          Build
        </Link>
        <a
          href="https://github.com/Rumblingb/Agentpay#readme"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-neutral-200 transition-colors duration-200 hidden md:inline"
        >
          Docs
        </a>

        <Link
          href="/login"
          className="border border-neutral-800 hover:border-neutral-700 bg-neutral-900/60 hover:bg-neutral-800/60 text-neutral-300 hover:text-white px-3.5 py-1.5 rounded-lg transition-all duration-200 text-xs font-medium tracking-wide"
        >
          Open App
        </Link>
      </nav>
    </header>
    </>
  );
}
