import Link from 'next/link';
import { ArrowRight, BookOpen, Shield, Zap, Globe } from 'lucide-react';

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
            Financial OS for
          </span>
          <br />
          <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            AI Agents
          </span>
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-slate-400 text-center max-w-2xl leading-relaxed">
          Universal payment infrastructure that lets autonomous AI agents send,
          receive, and manage USDC payments on Solana — in milliseconds.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
          <Link
            href="/login"
            className="group flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white px-8 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98]"
          >
            Access Dashboard
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
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

        {/* Stats */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-10">
          <div className="text-center">
            <div className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              200ms
            </div>
            <div className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-semibold">
              Settlement Speed
            </div>
          </div>
          <div className="text-center">
            <div className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              100%
            </div>
            <div className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-semibold">
              Success Rate
            </div>
          </div>
          <div className="text-center">
            <div className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              {'<'}$0.01
            </div>
            <div className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-semibold">
              Per Transaction
            </div>
          </div>
        </div>

        {/* Feature badges */}
        <div className="mt-16 flex flex-wrap items-center justify-center gap-4">
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
        <div className="mt-16 text-center">
          <p className="text-xs text-slate-600">
            © {new Date().getFullYear()} AgentPay · Built for the autonomous economy
          </p>
        </div>
      </div>
    </div>
  );
}
