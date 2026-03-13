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
      <style>{`@keyframes pulse {0% { opacity: .4; transform: scale(.9);} 50% { opacity: 1; transform: scale(1);} 100% { opacity: .4; transform: scale(.9);} }
        .pulse-dot { width:8px; height:8px; border-radius:50%; background:#22C55E; box-shadow:0 0 8px rgba(34,197,94,0.18); display:inline-block; margin-right:8px; animation:pulse 2000ms infinite; }
        .panel-glass { background: rgba(10,15,20,0.9); border: 1px solid #1b2630; border-radius: 14px; transition: all .25s ease; }
        .panel-glass:hover { transform: translateY(-2px); border-color: #22c55e; box-shadow: 0 0 0 1px rgba(34,197,94,0.15), 0 12px 30px rgba(0,0,0,0.35); }
      `}</style>
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

      <nav className="flex items-center gap-6 md:gap-8 text-sm text-neutral-500">
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
        {/* Market removed from primary nav for cleaner top navigation */}
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
        {/* Docs intentionally omitted from primary nav to simplify header */}

        <Link
          href="/login"
          className="border border-neutral-800 hover:border-neutral-700 bg-neutral-900/60 hover:bg-neutral-800/60 text-neutral-300 hover:text-white px-3.5 py-1.5 rounded-lg transition-all duration-200 text-xs font-medium tracking-wide"
        >
          Open App
        </Link>
      </nav>

      {/* Compact network status indicator (top-right) */}
      <div style={{ marginLeft: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 140 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9AA4AF', fontSize: 12, lineHeight: 1 }}>
          <span className="pulse-dot" aria-hidden />
          <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#F5F7FA' }}>Preview Network</span>
            <span style={{ fontSize: 11, color: '#9AA4AF' }}>Founding Era Beta</span>
          </div>
        </div>
      </div>
    </header>
    </>
  );
}
