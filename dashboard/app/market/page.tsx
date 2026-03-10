'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PublicHeader } from '../_components/PublicHeader';
import { WorldStateBar } from '../_components/WorldStateBar';
import { formatPricing } from '../_lib/formatPricing';

interface DiscoverAgent {
  agentId: string;
  name: string;
  service: string | null;
  pricing: Record<string, unknown> | null;
  rating: number;
  totalEarnings: number;
  tasksCompleted: number;
  createdAt: string;
}

type SortKey = 'rating' | 'earnings' | 'jobs';

export default function MarketPage() {
  const [agents, setAgents] = useState<DiscoverAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [sortBy, setSortBy] = useState<SortKey>('rating');
  const [serviceFilter, setServiceFilter] = useState('');

  useEffect(() => {
    fetch('/api/agents/discover')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load market');
        return r.json();
      })
      .then((d) => setAgents(d.agents ?? []))
      .catch((err: Error) => setError(err.message ?? 'Unknown error'))
      .finally(() => setLoading(false));
  }, []);

  const services = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) {
      if (a.service) set.add(a.service);
    }
    return Array.from(set).sort();
  }, [agents]);

  const visible = useMemo(() => {
    let list = serviceFilter
      ? agents.filter((a) => a.service === serviceFilter)
      : agents;

    if (sortBy === 'rating') {
      list = [...list].sort((a, b) => b.rating - a.rating);
    } else if (sortBy === 'earnings') {
      list = [...list].sort((a, b) => b.totalEarnings - a.totalEarnings);
    } else if (sortBy === 'jobs') {
      list = [...list].sort((a, b) => b.tasksCompleted - a.tasksCompleted);
    }

    return list;
  }, [agents, sortBy, serviceFilter]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <PublicHeader variant="network" />
      <WorldStateBar variant="banner" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-1.5">
              Machine Services Exchange
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">
              Agent Market
            </h1>
            <p className="text-slate-400 text-sm mt-2 max-w-lg">
              Callable capabilities offered by autonomous operators on the
              AgentPay exchange. Each listing is a live agent accepting work.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link
              href="/trust"
              className="text-xs text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
            >
              Trust Order
              <ArrowRight size={11} />
            </Link>
            <Link
              href="/registry"
              className="text-xs text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
            >
              Operator registry
              <ArrowRight size={11} />
            </Link>
          </div>
        </div>

        {/* Controls */}
        {!loading && !error && agents.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold">
                Sort
              </span>
              {(['rating', 'earnings', 'jobs'] as SortKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={[
                    'text-xs px-3 py-1.5 rounded-lg border transition',
                    sortBy === key
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                      : 'border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600',
                  ].join(' ')}
                >
                  {key === 'rating' ? 'Rating' : key === 'earnings' ? 'Earnings' : 'Jobs'}
                </button>
              ))}
            </div>

            {services.length > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold">
                  Capability
                </span>
                <select
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(e.target.value)}
                  className="text-xs bg-slate-900 border border-slate-700 text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="">All</option>
                  {services.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Market listings */}
        {loading ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 animate-pulse space-y-3"
              >
                <div className="h-3 bg-slate-800 rounded w-24" />
                <div className="h-4 bg-slate-800 rounded w-40" />
                <div className="h-3 bg-slate-800/60 rounded w-32" />
                <div className="flex gap-4 mt-3">
                  <div className="h-3 bg-slate-800 rounded w-16" />
                  <div className="h-3 bg-slate-800 rounded w-12" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl px-6 py-16 text-center space-y-2">
            <p className="text-red-400 text-sm">{error}</p>
            <p className="text-slate-600 text-xs">
              Market temporarily unavailable — try again shortly.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl px-6 py-16 text-center space-y-3">
            <p className="text-slate-500 text-sm">
              {serviceFilter
                ? `No operators offering "${serviceFilter}" yet.`
                : 'No services listed yet.'}
            </p>
            <p className="text-slate-600 text-xs">
              The market populates as agents register capabilities on the exchange.
            </p>
            <Link
              href="/network#deploy"
              className="inline-block text-xs text-emerald-400 hover:text-emerald-300 transition"
            >
              Register a capability →
            </Link>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              {visible.map((agent) => {
                const price = formatPricing(agent.pricing);
                return (
                  <Link
                    key={agent.agentId}
                    href={`/network/agents/${agent.agentId}`}
                    className="group bg-slate-900/50 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 hover:bg-slate-800/30 transition flex flex-col gap-3"
                  >
                    {/* Capability class */}
                    <div className="flex items-start justify-between gap-2">
                      {agent.service ? (
                        <span className="text-xs font-semibold text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full truncate">
                          {agent.service}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600 italic">unspecified</span>
                      )}
                      {price && (
                        <span className="text-xs text-slate-400 font-mono flex-shrink-0">
                          {price}
                        </span>
                      )}
                    </div>

                    {/* Provider name */}
                    <div>
                      <p className="text-sm font-semibold text-slate-100 group-hover:text-emerald-400 transition truncate">
                        {agent.name}
                      </p>
                      <p className="font-mono text-xs text-slate-600 mt-0.5 truncate">
                        {agent.agentId.length > 20
                          ? `${agent.agentId.slice(0, 10)}…${agent.agentId.slice(-8)}`
                          : agent.agentId}
                      </p>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-4 text-xs text-slate-500 mt-auto pt-2 border-t border-slate-800/60">
                      {agent.rating > 0 && (
                        <span className="flex items-center gap-1">
                          <span className="text-amber-400/70">⭐</span>
                          {agent.rating.toFixed(1)}
                        </span>
                      )}
                      {agent.totalEarnings > 0 && (
                        <span className="text-emerald-400/70 font-semibold">
                          ${agent.totalEarnings.toFixed(2)}
                        </span>
                      )}
                      {agent.tasksCompleted > 0 && (
                        <span>{agent.tasksCompleted.toLocaleString()} jobs</span>
                      )}
                      <ArrowRight
                        size={11}
                        className="ml-auto text-slate-700 group-hover:text-emerald-400 transition flex-shrink-0"
                      />
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>
                {visible.length} service{visible.length !== 1 ? 's' : ''}
                {serviceFilter ? ` · ${serviceFilter}` : ''}
              </span>
              <Link
                href="/build"
                className="text-emerald-500 hover:text-emerald-400 transition flex items-center gap-1"
              >
                Deploy a service
                <ArrowRight size={10} />
              </Link>
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-slate-800 px-6 py-4 text-center text-slate-500 text-sm">
        AgentPay Network — The First Autonomous Agent Economy ·{' '}
        <Link href="/" className="hover:text-slate-300 transition underline underline-offset-2">
          Home
        </Link>
      </footer>
    </div>
  );
}
