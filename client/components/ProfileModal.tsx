'use client';
import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000/api` : 'http://localhost:4000/api');

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  trip: any;
  userRole: 'owner' | 'member' | null;
  isAppAdmin?: boolean;
  onUserUpdated: (user: any) => void;
  onLogout: () => void;
  onTripSwitched: (tripId: string) => void;
  onCreateTrip?: () => void;
}

export default function ProfileModal({
  isOpen,
  onClose,
  user,
  trip,
  userRole,
  isAppAdmin = false,
  onUserUpdated,
  onLogout,
  onTripSwitched,
  onCreateTrip,
}: ProfileModalProps) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (user?.name) {
      setName(user.name);
    }
  }, [user]);

  useEffect(() => {
    if (!isOpen) {
      setSuccessMsg('');
      setErrorMsg('');
      return;
    }
    const token = localStorage.getItem('tripvault-token');
    if (!token) return;

    fetch(`${API}/user/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.user) {
          setName(data.user.name);
          onUserUpdated(data.user);
        }
        if (data.trips) {
          setTrips(data.trips);
        }
      })
      .catch(err => console.error('Failed to load profile:', err));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');
    setLoading(true);

    const token = localStorage.getItem('tripvault-token');
    if (!token) {
      setErrorMsg('Not authenticated');
      setLoading(false);
      return;
    }

    try {
      const body: any = { name: name.trim() };
      if (password.trim()) {
        if (password.length < 12) {
          setErrorMsg('Password must be at least 12 characters');
          setLoading(false);
          return;
        }
        body.password = password;
      }

      const res = await fetch(`${API}/user/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update profile');

      setSuccessMsg('Profile updated successfully!');
      setPassword('');
      onUserUpdated(data.user);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = isAppAdmin || userRole === 'owner';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-[#f7f5ef] p-6 shadow-2xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-moss font-bold text-white text-xl">
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-ink">{user?.name || 'User Profile'}</h2>
              <p className="text-xs text-black/60">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-black/5 text-sm font-semibold transition hover:bg-black/10"
          >
            ✕
          </button>
        </div>

        {/* Current Trip & Access Role */}
        <div className="mt-5 rounded-2xl border border-black/10 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-black/50">Current Trip Role</span>
            {isAdmin ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 border border-amber-300">
                👑 Admin
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900 border border-emerald-300">
                👤 Member
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium text-ink">
            {trip ? trip.title : 'No trip open'}
          </p>
          <p className="mt-1 text-xs text-black/60 leading-relaxed">
            {!trip
              ? 'Choose a trip from the list below to open its gallery.'
              : isAdmin
                ? '👑 Admin Access: You can create or delete trips, invite members, manage roles, and upload photos, videos, and audio.'
                : '👤 Member Access: You can view photos and videos and add one photo to this trip. Media processing and members are managed by an admin.'}
          </p>
        </div>

        {/* Edit Profile Form */}
        <form onSubmit={handleUpdate} className="mt-6 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-moss">Account Details</h3>

          {successMsg && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-medium text-emerald-800">
              ✓ {successMsg}
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs font-medium text-red-700">
              ✕ {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-black/70 mb-1">Display Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm text-ink outline-none transition focus:border-moss focus:ring-1 focus:ring-moss"
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-black/70 mb-1">
              New Password <span className="text-black/40 font-normal">(leave blank to keep current)</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm text-ink outline-none transition focus:border-moss focus:ring-1 focus:ring-moss"
              placeholder="12+ characters"
              minLength={12}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-moss py-2.5 text-sm font-semibold text-white transition hover:bg-moss/90 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Profile Changes'}
          </button>
        </form>

        {/* Trips Switcher */}
        <div className="mt-6 border-t border-black/10 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-black/50">Your Trips ({trips.length})</h3>
            {onCreateTrip && (
              <button
                type="button"
                onClick={() => {
                  onCreateTrip();
                  onClose();
                }}
                className="rounded-full border border-moss/25 bg-moss/5 px-3 py-1 text-[11px] font-bold text-moss transition hover:bg-moss/10"
              >
                ＋ New trip
              </button>
            )}
          </div>
          {trips.length === 0 && (
            <p className="rounded-xl border border-dashed border-black/15 bg-white/60 p-3 text-xs text-black/55">
              {onCreateTrip
                ? 'No trips yet. Create your first trip to start collecting photos, videos, and audio.'
                : 'No trips yet. Ask an app admin for an invite link to join a trip.'}
            </p>
          )}
          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {trips.map((t) => {
                const isCurrent = trip && trip.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      onTripSwitched(t.id);
                      onClose();
                    }}
                    className={`flex w-full items-center justify-between rounded-xl p-2.5 text-left transition ${
                      isCurrent ? 'bg-moss/10 border border-moss/30 font-semibold' : 'bg-white border border-black/10 hover:bg-black/5'
                    }`}
                  >
                    <div>
                      <p className="text-sm text-ink leading-tight">{t.title}</p>
                      <p className="text-[11px] text-black/50">{t.location}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        t.role === 'owner' ? 'bg-amber-100 text-amber-900' : 'bg-neutral-100 text-neutral-700'
                      }`}>
                        {t.role === 'owner' ? 'Admin' : 'Member'}
                      </span>
                      {isCurrent && <span className="text-xs text-moss font-bold">Active</span>}
                    </div>
                  </button>
                );
              })}
          </div>
        </div>

        {/* Logout */}
        <div className="mt-6 border-t border-black/10 pt-4 flex justify-between items-center">
          <p className="text-xs text-black/40">TripVault Secure Session</p>
          <button
            type="button"
            onClick={() => {
              onLogout();
              onClose();
            }}
            className="rounded-full bg-red-50 border border-red-200 px-4 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
