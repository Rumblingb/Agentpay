/**
 * AgentPay Tip Modal Component
 * React component for humans to tip Moltbook bots.
 *
 * Props:
 *   bot          – { id, handle, bio, avatar?, tips_received? }
 *   onClose      – () => void
 *   onTipComplete – ({ amount, bot, tx_hash }) => void
 */

import React, { useState } from 'react';

interface Bot {
  id: string;
  handle: string;
  bio?: string;
  avatar?: string;
  tips_received?: number;
}

interface TipModalProps {
  bot: Bot;
  onClose: () => void;
  onTipComplete: (result: { amount: number; bot: string; tx_hash: string }) => void;
}

const PRESET_AMOUNTS = [0.25, 0.50, 1.00, 2.00, 5.00];

const TipModal: React.FC<TipModalProps> = ({ bot, onClose, onTipComplete }) => {
  const [amount, setAmount] = useState<number>(0.50);
  const [paymentMethod, setPaymentMethod] = useState<'usdc' | 'card'>('usdc');
  const [loading, setLoading] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fee = +(amount * 0.05).toFixed(2);
  const botReceives = +(amount - fee).toFixed(2);

  const handleTip = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/tips/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_id: bot.id,
          amount,
          payment_method: paymentMethod,
          human_id: 'human_current', // Replace with actual user ID from auth context
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Tip failed');

      setPaymentUrl(data.payment_url);
      setQrCode(data.qr_code);
      pollForCompletion(data.intent_id);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const pollForCompletion = (intentId: string) => {
    let attempts = 0;
    const maxAttempts = 60;

    const interval = setInterval(async () => {
      attempts++;
      try {
        const response = await fetch(`/api/v1/tips/${intentId}/status`);
        const data = await response.json();

        if (data.status === 'completed') {
          clearInterval(interval);
          setLoading(false);
          onTipComplete({ amount, bot: bot.handle, tx_hash: data.tx_hash });
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          setError('Payment timeout — please check your transaction');
          setLoading(false);
        }
      } catch {
        // Continue polling on transient error
      }
    }, 5000);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">

        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Tip @{bot.handle}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>

        {/* Bot info */}
        <div className="flex items-center mb-6 p-3 bg-gray-50 rounded">
          {bot.avatar && (
            <img
              src={bot.avatar}
              alt={bot.handle}
              className="w-12 h-12 rounded-full mr-3"
            />
          )}
          <div>
            <div className="font-semibold">@{bot.handle}</div>
            {bot.bio && <div className="text-sm text-gray-600">{bot.bio}</div>}
            <div className="text-xs text-green-600 mt-1">
              💰 {bot.tips_received ?? 0} tips received
            </div>
          </div>
        </div>

        {!paymentUrl ? (
          <>
            {/* Preset amounts */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Select Amount</label>
              <div className="grid grid-cols-5 gap-2 mb-3">
                {PRESET_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setAmount(preset)}
                    className={`p-2 rounded border text-sm ${
                      amount === preset
                        ? 'border-blue-500 bg-blue-50 font-semibold'
                        : 'border-gray-300 hover:border-blue-300'
                    }`}
                  >
                    ${preset}
                  </button>
                ))}
              </div>
              <input
                type="number"
                step="0.01"
                min="0.10"
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                className="w-full p-2 border rounded"
                placeholder="Custom amount"
              />
            </div>

            {/* Payment method */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Payment Method</label>
              <div className="flex gap-2">
                {(['usdc', 'card'] as const).map((method) => (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method)}
                    className={`flex-1 p-3 rounded border ${
                      paymentMethod === method ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                    }`}
                  >
                    <div className="font-semibold capitalize">{method === 'usdc' ? 'USDC' : 'Card'}</div>
                    <div className="text-xs text-gray-600">
                      {method === 'usdc' ? 'Crypto wallet' : 'Credit/Debit'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Fee breakdown */}
            <div className="mb-6 p-3 bg-gray-50 rounded text-sm">
              <div className="flex justify-between mb-1">
                <span>Tip amount:</span>
                <span>${amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between mb-1 text-gray-600">
                <span>AgentPay fee (5%):</span>
                <span>${fee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-semibold pt-2 border-t">
                <span>Bot receives:</span>
                <span className="text-green-600">${botReceives.toFixed(2)}</span>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleTip}
              disabled={loading || amount < 0.10}
              className="w-full bg-blue-500 text-white p-3 rounded font-semibold hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {loading ? 'Processing…' : `Tip $${amount.toFixed(2)}`}
            </button>

            <p className="text-xs text-gray-500 mt-3 text-center">
              Secure payment via AgentPay · Non-custodial · Instant settlement
            </p>
          </>
        ) : (
          <div className="text-center">
            <div className="text-lg font-semibold mb-2">Complete Payment</div>
            <div className="text-gray-600 mb-4">
              {paymentMethod === 'usdc' ? 'Scan the QR code or open your wallet' : 'Click below to pay with card'}
            </div>

            {paymentMethod === 'usdc' && qrCode && (
              <div className="flex justify-center mb-4">
                <img src={qrCode} alt="Payment QR code" className="w-48 h-48" />
              </div>
            )}

            <a
              href={paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-green-500 text-white px-6 py-3 rounded font-semibold hover:bg-green-600 mb-4"
            >
              {paymentMethod === 'usdc' ? 'Open Wallet' : 'Pay with Card'}
            </a>

            <div className="text-sm text-gray-500">Waiting for payment confirmation…</div>

            {loading && (
              <div className="mt-4 flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TipModal;
