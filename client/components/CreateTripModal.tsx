'use client';
import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000/api` : 'http://localhost:4000/api');

interface CreateTripModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (tripId: string) => void;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function CreateTripModal({ isOpen, onClose, onCreated }: CreateTripModalProps) {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    if (!startDate) setStartDate(isoDate(new Date()));
    if (!endDate) {
      const soon = new Date();
      soon.setDate(soon.getDate() + 3);
      setEndDate(isoDate(soon));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    const token = localStorage.getItem('tripvault-token');
    if (!token) {
      setError('Please sign in before creating a trip.');
      return;
    }
    if (!title.trim() || !location.trim()) {
      setError('Trip name and location are required.');
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setError('The end date must be on or after the start date.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/trips`, {
        method: 'POST',
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
      if (!res.ok) throw new Error(data.message || 'Could not create trip');

      localStorage.setItem('tripvault-trip-id', data.id);
      setTitle('');
      setLocation('');
      setDescription('');
      onCreated(data.id);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Could not create trip');
    } finally {
      setLoading(false);
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
            <p className="text-xs font-bold uppercase tracking-widest text-moss">START SOMETHING NEW</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink">Create a trip</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-black/5 text-sm font-semibold transition hover:bg-black/10"
          >
            ✕
          </button>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-black/60">
          Set up the trip first, then add photos, videos, and audio to its shared gallery. You can invite members with a
          shareable link after creating it.
        </p>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
            ✕ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-black/70">Trip name</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="E.g. Goa getaway"
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
              placeholder="E.g. Goa, India"
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
            <label className="mb-1 block text-xs font-semibold text-black/70">
              Notes <span className="font-normal text-black/40">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Who's coming, what's the plan, anything worth remembering…"
              className="w-full resize-none rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm text-ink outline-none transition focus:border-moss"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-moss py-2.5 text-sm font-semibold text-white transition hover:bg-moss/90 disabled:opacity-50"
          >
            {loading ? 'Creating trip…' : 'Create trip'}
          </button>
        </form>
      </div>
    </div>
  );
}
