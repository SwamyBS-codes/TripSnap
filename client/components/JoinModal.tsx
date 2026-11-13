'use client';
import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000/api` : 'http://localhost:4000/api');

interface JoinModalProps {
  token: string;
  onJoined: (tripId: string, tripTitle: string) => void;
  onClose: () => void;
}

export default function JoinModal({ token, onJoined, onClose }: JoinModalProps) {
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSignup, setIsSignup] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${API}/trips/join-info/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Invitation is invalid or expired');
        setInfo(data);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load invitation');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const email = form.get('email');
    const password = form.get('password');
    const name = form.get('name') || 'Trip Member';

    try {
      const endpoint = isSignup ? 'signup' : 'login';
      const authRes = await fetch(`${API}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
      });
      const authData = await authRes.json();
      if (!authRes.ok) throw new Error(authData.message || 'Authentication failed');

      localStorage.setItem('tripvault-token', authData.accessToken);

      // Now join the trip
      const joinRes = await fetch(`${API}/trips/join/${token}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authData.accessToken}` }
      });
      const joinData = await joinRes.json();
      if (!joinRes.ok) throw new Error(joinData.message || 'Failed to join trip');

      localStorage.setItem('tripvault-trip-id', joinData.tripId);
      onJoined(joinData.tripId, joinData.tripTitle || info?.trip?.title || 'Trip');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl bg-[#f7f5ef] p-6 shadow-2xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/10 pb-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-moss text-white font-bold">↗</span>
            <span className="font-semibold tracking-tight text-ink">TripVault Invite</span>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-black/5 text-sm font-semibold transition hover:bg-black/10"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-black/50">
            Checking invitation link...
          </div>
        ) : error && !info ? (
          <div className="py-8 text-center">
            <p className="text-3xl">⚠️</p>
            <h3 className="mt-3 text-lg font-bold text-ink">Invalid or Expired Link</h3>
            <p className="mt-1 text-xs text-black/60">{error}</p>
            <button
              onClick={onClose}
              className="mt-5 rounded-full bg-moss px-5 py-2 text-xs font-semibold text-white"
            >
              Close
            </button>
          </div>
        ) : (
          <div>
            <div className="mt-4 rounded-2xl bg-white border border-black/10 p-4 text-center shadow-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900 border border-emerald-300">
                👤 Member Invitation
              </span>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink">
                {info?.trip?.title}
              </h2>
              <p className="mt-1 text-xs text-black/60">
                {info?.trip?.location} · Invited by <strong className="text-moss">{info?.inviter}</strong>
              </p>
              <p className="mt-2 text-xs text-black/50">
                Sign in or create an account to join this trip as a Member and share memories!
              </p>
            </div>

            {error && (
              <div className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3 text-xs font-medium text-red-700">
                ✕ {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
              <div className="flex gap-2 rounded-xl bg-black/5 p-1 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setIsSignup(true)}
                  className={`flex-1 rounded-lg py-1.5 transition ${isSignup ? 'bg-white shadow-xs font-bold text-ink' : 'text-black/60'}`}
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => setIsSignup(false)}
                  className={`flex-1 rounded-lg py-1.5 transition ${!isSignup ? 'bg-white shadow-xs font-bold text-ink' : 'text-black/60'}`}
                >
                  Sign In
                </button>
              </div>

              {isSignup && (
                <div>
                  <label className="block text-xs font-semibold text-black/70 mb-1">Your Name</label>
                  <input
                    type="text"
                    name="name"
                    required
                    placeholder="E.g. Alex"
                    className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm text-ink outline-none focus:border-moss"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-black/70 mb-1">Email</label>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm text-ink outline-none focus:border-moss"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-black/70 mb-1">Password</label>
                <input
                  type="password"
                  name="password"
                  required
                  placeholder="12+ characters"
                  minLength={12}
                  className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm text-ink outline-none focus:border-moss"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-moss py-2.5 text-sm font-semibold text-white transition hover:bg-moss/90 disabled:opacity-50"
              >
                {submitting ? 'Joining...' : isSignup ? 'Sign Up & Join Trip' : 'Sign In & Join Trip'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
