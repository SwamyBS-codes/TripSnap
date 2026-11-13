'use client';
import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000/api` : 'http://localhost:4000/api');

interface TripSettingsModalProps {
  isOpen: boolean;
  trip: any;
  isAppAdmin?: boolean;
  onClose: () => void;
  onUpdated: (trip: any) => void;
  onDeleted: (tripId: string) => void;
}

function dateValue(value?: string) {
  return value ? value.slice(0, 10) : '';
}

export default function TripSettingsModal({
  isOpen,
  trip,
  isAppAdmin = false,
  onClose,
  onUpdated,
  onDeleted
}: TripSettingsModalProps) {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !trip) return;
    setTitle(trip.title || '');
    setLocation(trip.location || '');
    setStartDate(dateValue(trip.start_date));
    setEndDate(dateValue(trip.end_date));
    setDescription(trip.description || '');
    setError('');
  }, [isOpen, trip?.id]);

  if (!isOpen || !trip) return null;

  const isAdmin = isAppAdmin || trip.role === 'owner';

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAdmin) {
      setError('Only the trip admin can change trip details.');
      return;
    }
    setError('');

    if (!title.trim() || !location.trim()) {
      setError('Trip name and location are required.');
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setError('The end date must be on or after the start date.');
      return;
    }

    const token = localStorage.getItem('tripvault-token');
    if (!token) {
      setError('Your session has expired. Please sign in again.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/trips/${trip.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: title.trim(),
          location: location.trim(),
          startDate,
          endDate,
          description: description.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not update trip');
      onUpdated(data);
    } catch (err: any) {
      setError(err.message || 'Could not update trip');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isAdmin) {
      setError('Only the trip admin can delete this trip.');
      return;
    }
    if (!confirm(`Delete “${trip.title}” permanently?\n\nAll of its photos, videos, audio, comments, and likes will be removed for every member. This cannot be undone.`)) {
      return;
    }

    const token = localStorage.getItem('tripvault-token');
    if (!token) {
      setError('Your session has expired. Please sign in again.');
      return;
    }

    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`${API}/trips/${trip.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not delete trip');
      onDeleted(trip.id);
    } catch (err: any) {
      setError(err.message || 'Could not delete trip');
    } finally {
      setDeleting(false);
    }
  };

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
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-moss">TRIP SETTINGS</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink">{trip.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-black/5 text-sm font-semibold transition hover:bg-black/10"
          >
            ✕
          </button>
        </div>

        {!isAdmin && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-900">
            👤 You are a member of this trip. Only a trip admin can edit or delete it.
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
            ✕ {error}
          </div>
        )}

        <form onSubmit={handleUpdate} className="mt-5 space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-black/70">Trip name</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm text-ink outline-none transition focus:border-moss"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-black/70">Location</label>
            <input
              type="text"
              required
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm text-ink outline-none transition focus:border-moss"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-black/70">Start date</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm text-ink outline-none transition focus:border-moss"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-black/70">End date</label>
              <input
                type="date"
                required
                min={startDate || undefined}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm text-ink outline-none transition focus:border-moss"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-black/70">Notes</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm text-ink outline-none transition focus:border-moss"
            />
          </div>

          <button
            type="submit"
            disabled={!isAdmin || loading || deleting}
            className="w-full rounded-xl bg-moss py-2.5 text-sm font-semibold text-white transition hover:bg-moss/90 disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save trip details'}
          </button>
        </form>

        <div className="mt-6 border-t border-black/10 pt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-red-600">Danger zone</p>
          <p className="mt-1 text-[11px] leading-relaxed text-black/55">
            Deleting a trip removes its database records and stored media for everyone. This cannot be undone.
          </p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!isAdmin || loading || deleting}
            className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : '🗑 Delete this trip'}
          </button>
        </div>
      </div>
    </div>
  );
}
