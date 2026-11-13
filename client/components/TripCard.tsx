'use client';
import { useState } from 'react';
import { TRIP_COVER_IMAGES } from './covers';

interface TripCardProps {
  trip: any;
  index?: number;
  active: boolean;
  onSelect: () => void;
  onManage?: () => void;
}

function formatDate(value?: string) {
  if (!value) return '';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
}

export default function TripCard({ trip, index = 0, active, onSelect, onManage }: TripCardProps) {
  const isAdmin = trip.role === 'owner';
  const [imageFailed, setImageFailed] = useState(false);
  const cover = trip.cover_url || TRIP_COVER_IMAGES[index % TRIP_COVER_IMAGES.length];
  const showImage = !!cover && !imageFailed;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group relative cursor-pointer overflow-hidden rounded-3xl border bg-white text-left shadow-2xs transition hover:-translate-y-1 ${
        active ? 'border-moss ring-2 ring-moss/25' : 'border-black/10'
      }`}
    >
      {/* Cover */}
      <div className="relative h-40 overflow-hidden bg-gradient-to-br from-moss via-emerald-700 to-teal-800">
        {showImage ? (
          <img
            src={cover}
            alt={`${trip.title} cover`}
            className="h-full w-full object-cover transition duration-700 group-hover:scale-110"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="grid h-full place-items-center text-5xl opacity-80">
            {['🏝️', '🏔️', '⛵', '🌅', '🏛️', '🌲', '🌊', '❄️', '🏜️', '🌴'][index % 10]}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

        <span
          className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
            isAdmin ? 'bg-amber-300 text-ink' : 'bg-white/85 text-ink'
          }`}
        >
          {isAdmin ? '👑 Admin' : '👤 Member'}
        </span>

        {active && (
          <span className="absolute bottom-3 left-3 rounded-full bg-lime-200 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink">
            Active trip
          </span>
        )}

        {isAdmin && onManage && (
          <button
            type="button"
            title="Edit or delete this trip"
            onClick={(e) => {
              e.stopPropagation();
              onManage();
            }}
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/35 text-sm text-white backdrop-blur-xs transition hover:bg-black/55"
          >
            ⚙
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="truncate text-base font-semibold tracking-tight text-ink">{trip.title}</h3>
        <p className="mt-0.5 truncate text-xs text-black/55">{trip.location}</p>
        <p className="mt-1 text-[11px] font-medium text-black/45">
          {formatDate(trip.start_date)} – {formatDate(trip.end_date)}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-black/60">
          <span className="rounded-full bg-black/5 px-2 py-1">📷 {trip.photo_count ?? 0}</span>
          <span className="rounded-full bg-black/5 px-2 py-1">🎬 {trip.video_count ?? 0}</span>
          <span className="rounded-full bg-black/5 px-2 py-1">🎧 {trip.audio_count ?? 0}</span>
          <span className="rounded-full bg-black/5 px-2 py-1">👥 {trip.member_count ?? 0}</span>
        </div>
      </div>
    </div>
  );
}
