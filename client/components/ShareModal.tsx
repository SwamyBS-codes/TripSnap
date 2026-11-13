'use client';
import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000/api` : 'http://localhost:4000/api');

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  trip: any;
  trips?: any[];
  isAppAdmin?: boolean;
  currentUserId?: string;
}

export default function ShareModal({
  isOpen,
  onClose,
  trip,
  trips = [],
  isAppAdmin = false,
  currentUserId,
}: ShareModalProps) {
  const [selectedTripId, setSelectedTripId] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [error, setError] = useState('');

  // Only trips the current user can manage can be invited to.
  const manageableTrips = (trips.length > 0 ? trips : trip ? [trip] : []).filter(
    (t) => isAppAdmin || t.role === 'owner' || t.id === trip?.id
  );
  const selectedTrip = manageableTrips.find((t) => t.id === selectedTripId) || trip;
  const isAdmin = isAppAdmin || selectedTrip?.role === 'owner';

  const loadMembers = async (tripId: string) => {
    if (!tripId) return;
    const token = localStorage.getItem('tripvault-token');
    if (!token) return;
    setLoadingMembers(true);
    try {
      const res = await fetch(`${API}/trips/${tripId}/members`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setMembers(await res.json());
      }
    } catch (e) {
      console.error('Failed to load members:', e);
    } finally {
      setLoadingMembers(false);
    }
  };

  const generateInviteLink = async (tripId: string) => {
    if (!tripId) return;
    const token = localStorage.getItem('tripvault-token');
    if (!token) return;
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`${API}/trips/${tripId}/invitations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to generate link');
      
      const origin = window.location.origin;
      const url = `${origin}/?join=${data.token}`;
      setInviteUrl(url);
    } catch (err: any) {
      setError(err.message || 'Could not generate link');
    } finally {
      setGenerating(false);
    }
  };

  // Reset the selection each time the modal opens (or the active trip changes).
  useEffect(() => {
    if (isOpen) {
      setSelectedTripId(trip?.id || trips[0]?.id || '');
      setInviteUrl('');
      setCopied(false);
      setError('');
    }
  }, [isOpen, trip?.id, trips]);

  // Generate a link and load members for the selected trip.
  useEffect(() => {
    if (!isOpen || !selectedTripId) return;
    setInviteUrl('');
    setCopied(false);
    if (isAdmin) generateInviteLink(selectedTripId);
    loadMembers(selectedTripId);
  }, [isOpen, selectedTripId, isAdmin]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = inviteUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleRoleChange = async (targetUserId: string, newRole: 'owner' | 'member') => {
    const token = localStorage.getItem('tripvault-token');
    if (!token || !selectedTrip?.id) return;
    setError('');
    try {
      const res = await fetch(`${API}/trips/${selectedTrip.id}/members/${targetUserId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: newRole })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update member role');
      loadMembers(selectedTrip.id);
    } catch (err: any) {
      setError(err.message || 'Failed to change role');
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    if (!confirm('Are you sure you want to remove this member from the trip?')) return;
    const token = localStorage.getItem('tripvault-token');
    if (!token || !selectedTrip?.id) return;
    setError('');
    try {
      const res = await fetch(`${API}/trips/${selectedTrip.id}/members/${targetUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to remove member');
      loadMembers(selectedTrip.id);
    } catch (err: any) {
      setError(err.message || 'Failed to remove member');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-[#f7f5ef] p-6 shadow-2xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/10 pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-moss">SHAREABLE TRIP LINK</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink">
              Invite to {selectedTrip?.title || 'a trip'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-black/5 text-sm font-semibold transition hover:bg-black/10"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-xs font-medium text-red-700">
            ✕ {error}
          </div>
        )}

        {/* Shareable Link Box (admin only) */}
        {isAdmin && (
          <div className="mt-5 rounded-2xl border border-black/10 bg-white p-5 shadow-xs">
            <label className="block text-xs font-bold uppercase tracking-wider text-black/60 mb-2">
              🔗 Shareable Member Invite Link
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                readOnly
                value={generating ? 'Generating link...' : inviteUrl}
                className="flex-1 rounded-xl border border-black/15 bg-neutral-50 px-3.5 py-2.5 text-xs text-ink font-mono select-all outline-none"
              />
              <button
                onClick={handleCopy}
                disabled={generating || !inviteUrl}
                className={`rounded-xl px-5 py-2.5 text-xs font-bold transition flex items-center justify-center gap-1.5 shrink-0 ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-moss text-white hover:bg-moss/90'
                }`}
              >
                {copied ? '✓ Copied!' : '📋 Copy Link'}
              </button>
            </div>

            {/* Trip selector: generate a link for any trip the admin manages */}
            <div className="mt-4 border-t border-black/10 pt-4">
              <label htmlFor="invite-trip" className="mb-2 block text-xs font-bold uppercase tracking-wider text-black/60">
                🗺️ Trip to invite to
              </label>
              <select
                id="invite-trip"
                value={selectedTripId}
                onChange={(e) => setSelectedTripId(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-sm font-medium text-ink outline-none transition focus:border-moss"
              >
                {manageableTrips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}{t.location ? ` · ${t.location}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[11px] text-black/45">
                Pick any trip you manage. A fresh member-only invite link is created for the selected trip.
              </p>
            </div>

            <p className="mt-2.5 text-[11px] text-black/55 leading-relaxed">
              Anyone who visits this link joins <strong className="text-ink">{selectedTrip?.title || 'the trip'}</strong> as a <strong className="text-emerald-700">Member</strong>. Members can view photos and videos and add one photo to the trip.
            </p>
          </div>
        )}

        {/* Trip Members Section */}
        <div className="mt-7">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-moss">
              Trip Members ({members.length})
            </h3>
            {isAdmin && (
              <span className="hidden text-[11px] font-medium text-black/50 sm:inline">
                👑 You can manage roles & members
              </span>
            )}
          </div>

          {loadingMembers ? (
            <p className="text-xs text-black/40 py-4 text-center">Loading members...</p>
          ) : (
            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
              {members.map((m) => {
                const isUserAdmin = m.role === 'owner';
                const isSelf = currentUserId === m.id;
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-2xl border border-black/10 bg-white p-3.5 shadow-2xs"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-moss/10 font-bold text-moss">
                        {m.name?.[0]?.toUpperCase() || 'U'}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-ink leading-tight">{m.name}</p>
                          {isSelf && (
                            <span className="shrink-0 text-[10px] font-normal text-black/40">(You)</span>
                          )}
                        </div>
                        <p className="truncate text-xs text-black/50">{m.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isUserAdmin ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-900 border border-amber-300">
                          👑 Admin
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-900 border border-emerald-300">
                          👤 Member
                        </span>
                      )}

                      {/* Role Actions for Admins */}
                      {isAdmin && !isSelf && (
                        <div className="flex items-center gap-1 ml-1">
                          {isUserAdmin ? (
                            <button
                              onClick={() => handleRoleChange(m.id, 'member')}
                              title="Demote to Member"
                              className="rounded-lg bg-neutral-100 px-2 py-1 text-[10px] font-semibold text-neutral-700 hover:bg-neutral-200"
                            >
                              Make Member
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRoleChange(m.id, 'owner')}
                              title="Promote to Admin"
                              className="rounded-lg bg-amber-50 border border-amber-200 px-2 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-100"
                            >
                              Make Admin
                            </button>
                          )}
                          <button
                            onClick={() => handleRemoveMember(m.id)}
                            title="Remove member"
                            className="rounded-lg bg-red-50 p-1 text-[10px] text-red-600 hover:bg-red-100"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-7 border-t border-black/10 pt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-full bg-neutral-200 px-5 py-2 text-xs font-semibold text-neutral-800 transition hover:bg-neutral-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
