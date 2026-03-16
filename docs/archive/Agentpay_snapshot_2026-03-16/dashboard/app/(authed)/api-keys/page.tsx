'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, RefreshCw, Eye, EyeOff, ShieldCheck } from 'lucide-react';

interface MeResponse {
  id: string;
  name: string;
  email: string;
}

async function fetchProfile(): Promise<MeResponse> {
  const res = await fetch('/api/me');
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}

export default function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
  });

  const rotateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/keys', { method: 'POST' });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to rotate key');
      }
      return res.json() as Promise<{ apiKey: string }>;
    },
    onSuccess: (data) => {
      setNewKey(data.apiKey);
      setError('');
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const maskedKey = 'ap_••••••••••••••••••••••••••••••••';

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-xl font-bold">API Keys</h1>

      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl space-y-5">
        {/* Profile info */}
        {!isLoading && profile && (
          <div className="space-y-1 pb-4 border-b border-slate-800">
            <p className="text-sm font-semibold">{profile.name}</p>
            <p className="text-xs text-slate-400">{profile.email}</p>
          </div>
        )}

        {/* Key display */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Key size={14} className="text-blue-400" />
            <label htmlFor="current-api-key" className="text-[10px] text-slate-500 uppercase font-bold">
              Current API Key
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="current-api-key"
              type={showKey && newKey ? 'text' : 'password'}
              value={newKey ?? maskedKey}
              readOnly
              className="bg-black/40 border border-slate-800 rounded-lg px-4 py-2.5 text-sm flex-1 font-mono text-slate-300 focus:outline-none"
            />
            {newKey && (
              <button
                onClick={() => setShowKey((v) => !v)}
                className="p-2 text-slate-400 hover:text-white transition"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}
          </div>
          {newKey && (
            <p className="mt-2 text-xs text-yellow-400">
              ⚠ Copy this key now — it will not be shown again once you navigate away.
            </p>
          )}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {/* Rotate button */}
        <button
          onClick={() => rotateMutation.mutate()}
          disabled={rotateMutation.isPending}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-semibold transition"
        >
          {rotateMutation.isPending ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Rotate Key
        </button>

        {/* Security notes */}
        <div className="pt-4 border-t border-slate-800">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="text-emerald-400" size={16} />
            <span className="text-xs font-semibold text-emerald-400">Security</span>
          </div>
          <ul className="text-xs text-slate-400 space-y-1">
            <li>✓ PBKDF2 key hashing</li>
            <li>✓ Recipient address verified on-chain</li>
            <li>✓ 2+ block confirmation depth</li>
            <li>✓ Rate limiting enabled on sensitive operations</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
