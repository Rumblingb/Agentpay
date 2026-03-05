import Link from 'next/link';
import { ArrowRight, BookOpen, Shield, Zap, Globe, CheckCircle, Star } from 'lucide-react';

export default function WelcomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 animate-gradient text-white">
      {/* Grid overlay */}
      <div className="absolute inset-0 bg-grid pointer-events-none" />

      {/* Floating orbs */}
      <div className="absolute top-1/6 left-1/5 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl animate-orb pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/5 w-96 h-96 bg-cyan-500/8 rounded-full blur-3xl animate-orb-slow pointer-events-none" />
      <div className="absolute top-2/3 left-1/2 w-56 h-56 bg-emerald-400/5 rounded-full blur-2xl animate-orb pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-16">
        {/* Badge */}
        <div className="mb-8 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full px-4 py-1.5 text-xs font-medium text-slate-300">
          <span className="text-emerald-400">●</span> Powered by Solana & USDC
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-center leading-tight tracking-tight max-w-4xl">
          <span className="bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            AgentPay Trust Infrastructure
          </span>
        </h1>

        {/* Subheadline */}
        <h2 className="mt-4 text-2xl sm:text-3xl lg:text-4xl font-bold text-center max-w-3xl">
          <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            Financial OS for AI Agents
          </span>
        </h2>

        {/* AgentRank tagline */}
        <p className="mt-4 text-sm sm:text-base text-slate-400 text-center font-medium">
          Powered by AgentRank — the FICO Score for the agentic economy
        </p>

        {/* Three Pillars */}
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 max-w-3xl w-full">
          <div className="flex flex-col items-center text-center bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-5">
            <Zap className="text-emerald-400 mb-2" size={24} />
            <div className="text-sm font-bold text-white">Lightning Settlement</div>
            <div className="text-xs text-slate-400 mt-1">{'<'}200 ms on Solana</div>
          </div>
          <div className="flex flex-col items-center text-center bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-5">
            <Shield className="text-emerald-400 mb-2" size={24} />
            <div className="text-sm font-bold text-white">Escrow-Protected Success</div>
            <div className="text-xs text-slate-400 mt-1">100% completion with automated disputes</div>
          </div>
          <div className="flex flex-col items-center text-center bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-5">
            <CheckCircle className="text-emerald-400 mb-2" size={24} />
            <div className="text-sm font-bold text-white">Verified Trust</div>
            <div className="text-xs text-slate-400 mt-1">Real-time AgentRank scoring + staking/escrow protection</div>
          </div>
        </div>

        {/* CTAs + AAA Badge */}
        <div className="mt-10 flex flex-col items-center gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="group flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white px-8 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98]"
              >
                Access Dashboard
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              {/* AAA Badge */}
              <div className="flex items-center gap-1 bg-emerald-500/15 border border-emerald-400/30 rounded-lg px-2.5 py-1.5" title="S ≥ 950 · A ≥ 800 — AgentRank Grades">
                <Star className="text-yellow-400" size={14} />
                <span className="text-xs font-extrabold text-emerald-300">AAA</span>
              </div>
            </div>
            <a
              href="https://github.com/Rumblingb/Agentpay#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 text-slate-300 hover:text-white px-8 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-105 active:scale-[0.98]"
            >
              <BookOpen size={16} />
              View Docs
            </a>
          </div>

          {/* Staked & Protected Ticker */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
            <div className="flex items-center gap-1.5 bg-white/5 backdrop-blur-sm border border-emerald-400/20 rounded-full px-3 py-1">
              <span className="text-emerald-400 animate-pulse text-[10px]">●</span>
              <span className="text-xs font-semibold text-slate-300">Staked &amp; Protected</span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1">
              <span className="text-xs text-slate-400">Agents Staked: <span className="text-emerald-400 font-bold">$100+ USDC each</span></span>
            </div>
          </div>

          {/* AgentRank Demo Snippet */}
          <div className="mt-2 bg-slate-900/80 backdrop-blur-sm border border-white/10 rounded-lg px-4 py-2 font-mono text-xs text-slate-400">
            <span className="text-slate-500">$</span>{' '}
            <span className="text-white">agent-alpha</span>{' '}
            <span className="text-slate-500">→</span>{' '}
            <span className="text-emerald-400 font-bold">A Grade</span>{' '}
            <span className="text-slate-600">(score: 850)</span>
          </div>
        </div>

        {/* Feature badges */}
        <div className="mt-14 flex flex-wrap items-center justify-center gap-4">
          <div className="flex items-center gap-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-2.5">
            <Shield className="text-emerald-400" size={16} />
            <span className="text-xs font-semibold text-slate-300">AES-256 Encrypted</span>
          </div>
          <div className="flex items-center gap-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-2.5">
            <Zap className="text-emerald-400" size={16} />
            <span className="text-xs font-semibold text-slate-300">Solana Powered</span>
          </div>
          <div className="flex items-center gap-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-2.5">
            <Globe className="text-emerald-400" size={16} />
            <span className="text-xs font-semibold text-slate-300">REST API</span>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-14 text-center">
          <p className="text-xs text-slate-600">
            © {new Date().getFullYear()} AgentPay · Built for the autonomous economy
          </p>
        </div>
      </div>
    </div>
  );
}
