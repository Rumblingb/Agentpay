"use client";

import React, { useEffect, useState } from 'react';
import { Activity, Key, ShieldCheck, RefreshCw, Wand2 } from 'lucide-react';

export default function MerchantDashboard() {
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  // 1. Corrected state declarations
  const [apiKey, setApiKey] = useState('ap_live_7x8k2...m9q');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('http://localhost:3001/health');
        if (res.ok) setServerStatus('online');
        else setServerStatus('offline');
      } catch {
        setServerStatus('offline');
      }
    };
    checkHealth();
  }, []);

  // 2. Function is now INSIDE the component
  const handleGenerateKey = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/v1/merchants/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId: 'demo-id' })
      });
      const data = await response.json();
      if (data.success) {
        setApiKey(data.apiKey);
      }
    } catch (err) {
      console.error("Failed to rotate key");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8 font-sans">
      <div className="flex justify-between items-center mb-12 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-emerald-400">AgentPay / Dashboard</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`h-2 w-2 rounded-full ${serverStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <p className="text-xs text-slate-400 uppercase font-semibold">Engine Status: {serverStatus}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* API ACCESS CARD */}
        <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl shadow-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-blue-500/10 p-2 rounded-lg"><Key className="text-blue-400" size={20} /></div>
            <h2 className="text-lg font-semibold">API Credentials</h2>
          </div>
          
          <div className="space-y-4">
            <div className="group relative">
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Live Secret Key</label>
              <input 
                type="text" // Changed to text so you can see your new key
                value={apiKey} 
                readOnly 
                className="bg-black/40 border border-slate-800 rounded-lg px-4 py-3 text-sm w-full font-mono text-slate-300 focus:outline-none"
              />
            </div>

            {/* 3. The New Action Button */}
            <button 
              onClick={handleGenerateKey}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-semibold transition"
            >
              {isLoading ? <RefreshCw className="animate-spin" size={16} /> : <Wand2 size={16} />}
              Generate New Key
            </button>
          </div>
        </div>

        {/* STATS CARDS (Simplified for brevity) */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
           <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
            <ShieldCheck className="text-emerald-400 mb-4" size={24} />
            <h3 className="text-3xl font-bold">L3 Verified</h3>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
            <Activity className="text-purple-400 mb-4" size={24} />
            <h3 className="text-3xl font-bold">0.8%</h3>
          </div>
        </div>
      </div>
    </div>
  );
}