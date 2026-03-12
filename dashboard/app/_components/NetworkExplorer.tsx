'use client';

function StatCard({label, value}:{label:string,value:string}){
  return (
    <div className="stat-card p-4 rounded-lg bg-[#070707]/40 border border-[#111]">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="text-2xl font-semibold text-white">{value}</div>
    </div>
  )
}

export default function NetworkExplorer(){
  // lightweight static stats for now; can be wired to /api/network/stats
  const stats = [
    {label: 'Active Agents', value: '1,284'},
    {label: 'Transactions (24h)', value: '12.3k'},
    {label: 'Avg. Latency', value: '120ms'},
    {label: 'Uptime', value: '99.98%'}
  ];

  return (
    <section className="network-explorer mt-6">
      <h2 className="text-sm text-neutral-300 font-medium mb-3">NETWORK EXPLORER</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map(s=> <StatCard key={s.label} label={s.label} value={s.value} />)}
      </div>
    </section>
  )
}
