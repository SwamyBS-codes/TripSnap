import { useState, useEffect, useCallback } from 'react';
import UploadPanel from '../components/UploadPanel';
import ProfileModal from '../components/ProfileModal';
import ShareModal from '../components/ShareModal';
import JoinModal from '../components/JoinModal';
import CreateTripModal from '../components/CreateTripModal';
import TripCard from '../components/TripCard';
import TripSettingsModal from '../components/TripSettingsModal';
import Lightbox from '../components/Lightbox';
import { HOME_HERO_IMAGE } from '../components/covers';

const API = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000/api` : 'http://localhost:4000/api');

type Route = { name: 'home' } | { name: 'trip'; tripId: string };

function parseRoute(): Route {
  const match = window.location.pathname.match(/^\/trips\/([^/]+)\/?$/);
  return match ? { name: 'trip', tripId: decodeURIComponent(match[1]) } : { name: 'home' };
}

function mediaKind(mimeType?: string): 'image' | 'video' | 'audio' | 'other' {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  return 'other';
}

function formatTripDate(value?: string) {
  if (!value) return '';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export default function Home() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [loading, setLoading] = useState(true);

  const [openUpload, setOpenUpload] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);
  const [openShare, setOpenShare] = useState(false);
  const [openJoin, setOpenJoin] = useState(false);
  const [openCreateTrip, setOpenCreateTrip] = useState(false);
  const [joinToken, setJoinToken] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const [filter, setFilter] = useState('All moments');
  const [mediaList, setMediaList] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [trip, setTrip] = useState<any>(null);
  const [manageTrip, setManageTrip] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<'owner' | 'member' | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [mediaActionBusy, setMediaActionBusy] = useState(false);

  const navigate = useCallback((path: string, replace = false) => {
    if (replace) window.history.replaceState({}, document.title, path);
    else window.history.pushState({}, document.title, path);
    setRoute(parseRoute());
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadData = useCallback(async () => {
    const token = localStorage.getItem('tripvault-token');
    if (!token) {
      setUser(null);
      setUserRole(null);
      setTrip(null);
      setTrips([]);
      setMediaList([]);
      setLoading(false);
      return;
    }

    if (route.name === 'trip') setLoading(true);

    try {
      const headers = { Authorization: `Bearer ${token}` };

      // 1. Load the user profile and the trip cards in parallel.
      const [profRes, tripsRes] = await Promise.all([
        fetch(`${API}/user/profile`, { headers }).catch(() => null),
        fetch(`${API}/trips`, { headers }).catch(() => null),
      ]);

      if (profRes && profRes.ok) {
        const profData = await profRes.json();
        setUser(profData.user);
      }

      let tripsData: any[] = [];
      if (tripsRes && tripsRes.ok) {
        tripsData = await tripsRes.json();
        setTrips(tripsData);
      }

      // The home page only needs the profile and trip cards.
      if (route.name !== 'trip') {
        setTrip(null);
        setUserRole(null);
        setMediaList([]);
        return;
      }

      // 2. Load the trip from the URL. If it is gone or not accessible,
      //    the trip page shows a friendly "not available" state.
      const tripId = route.tripId;
      if (tripsRes && tripsRes.ok && !tripsData.some((t) => t.id === tripId)) {
        setTrip(null);
        setUserRole(null);
        setMediaList([]);
        return;
      }

      localStorage.setItem('tripvault-trip-id', tripId);

      const [tripRes, mediaRes] = await Promise.all([
        fetch(`${API}/trips/${tripId}`, { headers }).catch(() => null),
        fetch(`${API}/trips/${tripId}/media`, { headers }).catch(() => null),
      ]);

      if (tripRes && tripRes.ok) {
        const tripData = await tripRes.json();
        setTrip(tripData);
        setUserRole(tripData.role || null);
      } else {
        setTrip(null);
        setUserRole(null);
        setMediaList([]);
      }

      if (mediaRes && mediaRes.ok) {
        setMediaList(await mediaRes.json());
      }
    } catch (e) {
      console.error('Failed to load data:', e);
    } finally {
      setLoading(false);
    }
  }, [route]);

  // Load (or reload) whenever the route changes.
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset per-trip UI whenever the page changes.
  useEffect(() => {
    setFilter('All moments');
    setLightboxIndex(null);
    setSelectedMediaIds([]);
  }, [route]);

  // Poll while uploads are being processed so video/audio become playable without a reload.
  useEffect(() => {
    const hasPending = mediaList.some((m) => m.status === 'PENDING' || m.status === 'PROCESSING');
    if (!hasPending) return;
    const timer = window.setInterval(loadData, 4000);
    return () => window.clearInterval(timer);
  }, [mediaList, loadData]);

  // Handle invitation link (?join=...) on initial mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinParam = params.get('join');
    if (!joinParam) return;

    const token = localStorage.getItem('tripvault-token');
    if (token) {
      fetch(`${API}/trips/join/${joinParam}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.tripId) {
            localStorage.setItem('tripvault-trip-id', data.tripId);
            setBannerMessage(`🎉 You joined ${data.tripTitle || 'the trip'} as a Member!`);
            navigate(`/trips/${data.tripId}`, true);
          }
        })
        .catch(() => {
          setJoinToken(joinParam);
          setOpenJoin(true);
        });
    } else {
      // Prompt the visitor to sign up or sign in before joining.
      setJoinToken(joinParam);
      setOpenJoin(true);
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('tripvault-token');
    localStorage.removeItem('tripvault-trip-id');
    setUser(null);
    setTrip(null);
    setTrips([]);
    setUserRole(null);
    setMediaList([]);
    setManageTrip(null);
    setLightboxIndex(null);
    navigate('/', true);
  };

  const handleTripSelect = (newTripId: string) => {
    localStorage.setItem('tripvault-trip-id', newTripId);
    setFilter('All moments');
    setLightboxIndex(null);
    navigate(`/trips/${newTripId}`);
  };

  const handleTripUpdated = () => {
    setManageTrip(null);
    setBannerMessage('✏️ Trip details updated.');
    loadData();
  };

  const handleTripDeleted = (deletedTripId: string) => {
    setManageTrip(null);
    setBannerMessage('🗑️ Trip deleted along with its media.');

    if (localStorage.getItem('tripvault-trip-id') === deletedTripId) {
      localStorage.removeItem('tripvault-trip-id');
    }

    if (route.name === 'trip' && route.tripId === deletedTripId) {
      navigate('/', true);
    } else {
      loadData();
    }
  };

  const totalMoments = mediaList.length;
  const photoCount = mediaList.filter((m) => mediaKind(m.mime_type) === 'image').length;
  const videoCount = mediaList.filter((m) => mediaKind(m.mime_type) === 'video').length;
  const audioCount = mediaList.filter((m) => mediaKind(m.mime_type) === 'audio').length;
  const isAppAdmin = !!user?.is_admin;
  const canManage = isAppAdmin || userRole === 'owner';
  const showAdmin = route.name === 'trip' ? canManage : isAppAdmin;
  const myPhotoCount = mediaList.filter(
    (m) => m.uploader_id === user?.id && mediaKind(m.mime_type) === 'image' && m.status !== 'FAILED'
  ).length;
  const filteredMedia = mediaList.filter((m) => {
    if (filter === 'Photos') return mediaKind(m.mime_type) === 'image';
    if (filter === 'Videos') return mediaKind(m.mime_type) === 'video';
    if (filter === 'Audio') return mediaKind(m.mime_type) === 'audio';
    return true;
  });
  const lightboxImages = filteredMedia.filter(
    (m) => mediaKind(m.mime_type) === 'image' && !!m.url
  );
  const imageIndexById = new Map(lightboxImages.map((m, i) => [m.id, i] as const));
  const toggleMediaSelection = (mediaId: string) => setSelectedMediaIds(ids => ids.includes(mediaId) ? ids.filter(id => id !== mediaId) : [...ids, mediaId]);
  const selectAllVisible = () => setSelectedMediaIds(ids => ids.length === filteredMedia.length ? [] : filteredMedia.map(m => m.id));
  const deleteSelectedMedia = async () => {
    if (!trip || !selectedMediaIds.length || !window.confirm(`Delete ${selectedMediaIds.length} selected item(s)? This removes the media from this trip.`)) return;
    setMediaActionBusy(true);
    try {
      const response = await fetch(`${API}/trips/${trip.id}/media`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('tripvault-token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaIds: selectedMediaIds }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not delete selected media');
      setMediaList(items => items.filter(item => !data.deleted.includes(item.id)));
      setSelectedMediaIds([]);
      setBannerMessage(`Deleted ${data.deleted.length} selected item(s).`);
    } catch (error) { setBannerMessage(error instanceof Error ? error.message : 'Could not delete selected media.'); }
    finally { setMediaActionBusy(false); }
  };

  const totalPhotos = trips.reduce((sum, t) => sum + (t.photo_count || 0), 0);
  const totalVideos = trips.reduce((sum, t) => sum + (t.video_count || 0), 0);
  const totalAudio = trips.reduce((sum, t) => sum + (t.audio_count || 0), 0);

  return (
    <main className="page-bg min-h-screen pb-16">
      {/* Optional Notification Banner */}
      {bannerMessage && (
        <div className="bg-emerald-600 text-white px-6 py-2.5 text-xs sm:text-sm font-semibold flex items-center justify-between">
          <span>{bannerMessage}</span>
          <button onClick={() => setBannerMessage(null)} className="ml-4 font-bold hover:opacity-80">✕</button>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-black/5 bg-[#f7f5ef]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-2 font-semibold tracking-tight text-ink"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-moss text-lg text-white">↗</span>
          tripvault
        </button>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Create Trip Option (app admin, home page only) */}
          {user && isAppAdmin && route.name === 'home' && (
            <button
              onClick={() => setOpenCreateTrip(true)}
              title="Create a new trip"
              className="hidden items-center gap-1.5 rounded-full border border-black/15 bg-white px-3.5 py-2 text-xs sm:flex sm:text-sm font-semibold text-ink shadow-2xs transition hover:bg-black/5 hover:border-black/30"
            >
              <span>＋</span>
              <span>New trip</span>
            </button>
          )}

          {/* Invite people (home page, admins with trips) */}
          {user && route.name === 'home' && trips.some((t) => isAppAdmin || t.role === 'owner') && (
            <button
              onClick={() => setOpenShare(true)}
              title="Share an invite link"
              className="hidden items-center gap-1.5 rounded-full border border-black/15 bg-white px-3.5 py-2 text-xs sm:flex sm:text-sm font-semibold text-ink shadow-2xs transition hover:bg-black/5 hover:border-black/30"
            >
              <span>🔗</span>
              <span>Invite</span>
            </button>
          )}

          {/* Invite link (admin, trip page only) */}
          {trip && route.name === 'trip' && canManage && (
            <button
              onClick={() => setOpenShare(true)}
              title="Shareable invite link"
              className="hidden items-center gap-1.5 rounded-full border border-black/15 bg-white px-3.5 py-2 text-xs sm:flex sm:text-sm font-semibold text-ink shadow-2xs transition hover:bg-black/5 hover:border-black/30"
            >
              <span>🔗</span>
              <span>Invite link</span>
            </button>
          )}

          {/* Add Moment Button (trip page only) */}
          {trip && route.name === 'trip' && (
            <button
              onClick={() => setOpenUpload(true)}
              className="whitespace-nowrap rounded-full bg-lime-200 px-3.5 py-2 text-xs sm:text-sm font-semibold text-ink transition hover:bg-lime-100 shadow-2xs"
            >
              ＋ Add moment
            </button>
          )}

          {/* User Profile Button with Access Role Indicator */}
          {user ? (
            <button
              onClick={() => setOpenProfile(true)}
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white p-1 pr-3 text-left shadow-2xs transition hover:bg-black/5"
            >
              <div className="grid h-8 w-8 place-items-center rounded-full bg-moss text-xs font-bold text-white">
                {user.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-bold text-ink leading-none">{user.name}</p>
                <p className="text-[10px] text-black/50 leading-none mt-0.5">
                  {showAdmin ? '👑 Admin' : '👤 Member'}
                </p>
              </div>
            </button>
          ) : (
            <button
              onClick={() => setOpenUpload(true)}
              className="whitespace-nowrap rounded-full border border-black/15 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-ink transition hover:bg-black/5"
            >
              Sign in
            </button>
          )}
        </div>
        </div>
      </header>

      {route.name === 'home' ? (
        <>
          {/* Home Hero */}
          <section className="mx-auto max-w-7xl px-6 pb-6 pt-6">
            <div className="relative overflow-hidden rounded-[2rem] bg-[#273e34] px-7 py-10 text-white sm:px-12 sm:py-16 shadow-xl">
              <img
                src={HOME_HERO_IMAGE}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover opacity-45"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#101f19]/95 via-[#1b3328]/85 to-[#274438]/55" />
              <div className="absolute -right-4 -top-16 select-none text-[180px] opacity-10">☀</div>

              <div className="relative flex flex-wrap items-center gap-2 mb-3">
                <p className="text-xs font-semibold uppercase tracking-[.22em] text-lime-200">
                  A LITTLE TRIP, A LOT TO REMEMBER
                </p>
                {user && (
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    isAppAdmin ? 'bg-amber-400 text-ink' : 'bg-lime-300 text-ink'
                  }`}>
                    {isAppAdmin ? '👑 Admin Access' : '👤 Member Access'}
                  </span>
                )}
              </div>

              <div className="relative flex flex-col justify-between gap-8 sm:flex-row sm:items-end">
                <div>
                  <h1 className="max-w-xl text-4xl font-medium tracking-tight drop-shadow-sm sm:text-6xl">
                    Every trip deserves
                    <br />
                    <span className="text-lime-200">a home</span>
                  </h1>
                  <p className="mt-4 max-w-xl text-sm text-white/70">
                    {user
                      ? 'Open a trip to relive its moments, or start a new one for the next adventure.'
                      : 'A private, invite-only home for the photos, videos, and voices from your trips.'}
                  </p>

                  {user && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-white/65">
                      <span className="rounded-full bg-white/10 px-2.5 py-1">🗺️ {trips.length} trips</span>
                      <span className="rounded-full bg-white/10 px-2.5 py-1">📷 {totalPhotos} photos</span>
                      <span className="rounded-full bg-white/10 px-2.5 py-1">🎬 {totalVideos} videos</span>
                      <span className="rounded-full bg-white/10 px-2.5 py-1">🎧 {totalAudio} audio</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {user && isAppAdmin && (
                    <button
                      onClick={() => setOpenCreateTrip(true)}
                      className="rounded-full bg-lime-200 px-6 py-3 text-sm font-semibold text-ink transition hover:bg-lime-100"
                    >
                      ＋ Create a trip
                    </button>
                  )}
                  {user && trips.length > 0 && (
                    <button
                      onClick={() => document.getElementById('trips')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className="rounded-full border border-white/30 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur-xs transition hover:bg-white/20"
                    >
                      Browse your trips ↓
                    </button>
                  )}
                  {!user && (
                    <button
                      onClick={() => setOpenUpload(true)}
                      className="rounded-full bg-lime-200 px-6 py-3 text-sm font-semibold text-ink transition hover:bg-lime-100"
                    >
                      Sign in to get started
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {user ? (
            /* Trip Cards */
            <section id="trips" className="mx-auto max-w-7xl scroll-mt-24 px-6 pb-12">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.2em] text-moss">YOUR TRIPS</p>
                  <h2 className="mt-1 text-2xl font-medium tracking-tight text-ink">Choose a trip to open it</h2>
                </div>
                {isAppAdmin && (
                  <button
                    onClick={() => setOpenCreateTrip(true)}
                    className="rounded-full border border-moss/25 bg-moss/5 px-4 py-2 text-xs font-bold text-moss transition hover:bg-moss/10"
                  >
                    ＋ New trip
                  </button>
                )}
              </div>

              {trips.length > 0 ? (
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {trips.map((t, index) => (
                    <TripCard
                      key={t.id}
                      trip={t}
                      index={index}
                      active={false}
                      onSelect={() => handleTripSelect(t.id)}
                      onManage={isAppAdmin || t.role === 'owner' ? () => setManageTrip(t) : undefined}
                    />
                  ))}
                  {isAppAdmin && (
                    <button
                      onClick={() => setOpenCreateTrip(true)}
                      className="flex min-h-[248px] flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-moss/25 bg-white/40 p-6 text-moss transition hover:border-moss/50 hover:bg-white/70"
                    >
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-moss/10 text-2xl">＋</span>
                      <span className="text-sm font-semibold">Create another trip</span>
                      <span className="text-[11px] text-black/45">Photos, videos, and audio welcome</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-5 rounded-3xl border border-dashed border-moss/25 bg-white/50 p-8 text-center">
                  <p className="text-3xl">🗺️</p>
                  <p className="mt-2 font-semibold text-ink">{isAppAdmin ? 'No trips yet' : 'No trips joined yet'}</p>
                  <p className="mt-1 text-sm text-black/55">
                    {isAppAdmin
                      ? 'Create your first trip to start a shared gallery.'
                      : 'Ask an admin for an invite link to join a trip. Members can view photos and videos and add one photo.'}
                  </p>
                  {isAppAdmin && (
                    <button
                      onClick={() => setOpenCreateTrip(true)}
                      className="mt-4 rounded-full bg-moss px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-moss/90"
                    >
                      ＋ Create your first trip
                    </button>
                  )}
                </div>
              )}
            </section>
          ) : (
            /* Logged-out feature strip */
            <section className="mx-auto max-w-7xl px-6 pb-12">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { icon: '🔒', title: 'Private by default', copy: 'Invite-only links and short-lived access to every file.' },
                  { icon: '📸', title: 'Photos, video & audio', copy: 'One shared gallery for everything you capture together.' },
                  { icon: '👥', title: 'Built for the group', copy: 'Admins manage the trip; every member can add a photo.' },
                ].map((feature) => (
                  <div key={feature.title} className="rounded-3xl border border-black/10 bg-white/70 p-6 shadow-2xs">
                    <p className="text-2xl">{feature.icon}</p>
                    <p className="mt-2 font-semibold text-ink">{feature.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-black/55">{feature.copy}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          {/* Trip page: back link */}
          <div className="mx-auto max-w-7xl px-6 pt-6">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-ink shadow-2xs transition hover:bg-black/5"
            >
              ← All trips
            </button>
          </div>

          {loading ? (
            <div className="mx-auto max-w-7xl px-6 py-6">
              <div className="h-64 animate-pulse rounded-[2rem] bg-white/60" />
              <div className="mt-8 h-10 w-64 animate-pulse rounded-full bg-white/60" />
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="aspect-[.83] animate-pulse rounded-2xl bg-white/50" />
                ))}
              </div>
            </div>
          ) : trip ? (
            <>
              {/* Trip Hero */}
              <section id="trip-overview" className="mx-auto max-w-7xl scroll-mt-24 px-6 pb-6 pt-4">
                <div className="relative overflow-hidden rounded-[2rem] bg-[#273e34] px-7 py-10 text-white sm:px-12 sm:py-16 shadow-xl">
                  <img
                    src={HOME_HERO_IMAGE}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full object-cover opacity-45"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#101f19]/95 via-[#1b3328]/85 to-[#274438]/55" />
                  <div className="absolute -right-4 -top-16 select-none text-[180px] opacity-10">☀</div>

                  <div className="relative flex flex-wrap items-center gap-2 mb-3">
                    <p className="text-xs font-semibold uppercase tracking-[.22em] text-lime-200">
                      A LITTLE TRIP, A LOT TO REMEMBER
                    </p>
                    {userRole && (
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        canManage ? 'bg-amber-400 text-ink' : 'bg-lime-300 text-ink'
                      }`}>
                        {canManage ? '👑 Admin Access' : '👤 Member Access'}
                      </span>
                    )}
                  </div>

                  <div className="relative flex flex-col justify-between gap-8 sm:flex-row sm:items-end">
                    <div>
                      <h1 className="max-w-xl text-4xl font-medium tracking-tight drop-shadow-sm sm:text-6xl">
                        The {trip.title}{' '}
                        <span className="text-lime-200">
                          {trip.start_date ? `’${trip.start_date.slice(2, 4)}` : '’26'}
                        </span>
                      </h1>
                      <p className="mt-4 text-sm text-white/70">
                        {trip.location}
                        {' · '}
                        {formatTripDate(trip.start_date)} – {formatTripDate(trip.end_date)}
                      </p>

                      {trip.description && (
                        <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/55">{trip.description}</p>
                      )}
                      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-white/65">
                        <span className="rounded-full bg-white/10 px-2.5 py-1">👥 {trip.member_count ?? 0} members</span>
                        <span className="rounded-full bg-white/10 px-2.5 py-1">📷 {trip.photo_count ?? 0} photos</span>
                        <span className="rounded-full bg-white/10 px-2.5 py-1">🎬 {trip.video_count ?? 0} videos</span>
                        <span className="rounded-full bg-white/10 px-2.5 py-1">🎧 {trip.audio_count ?? 0} audio</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {canManage && (
                        <button
                          onClick={() => setManageTrip(trip)}
                          className="rounded-full border border-white/30 bg-white/10 backdrop-blur-xs px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
                        >
                          ⚙ Manage trip
                        </button>
                      )}
                      {canManage && (
                        <button
                          onClick={() => setOpenShare(true)}
                          className="rounded-full border border-white/30 bg-white/10 backdrop-blur-xs px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
                        >
                          🔗 Invite link
                        </button>
                      )}
                      <button
                        onClick={() => setOpenUpload(true)}
                        className="rounded-full bg-lime-200 px-6 py-3 text-sm font-semibold text-ink transition hover:bg-lime-100"
                      >
                        ＋ Add your moments
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              {/* Gallery */}
              <section id="trip-gallery" className="mx-auto max-w-7xl scroll-mt-24 px-6 pb-12">
                {/* Filters and Counters */}
                <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[.2em] text-moss">THE CAMERA ROLL, TOGETHER</p>
                    <h2 className="mt-2 text-2xl font-medium tracking-tight text-ink">
                      Little moments, big memories <span className="ml-2 text-sm text-black/40">{totalMoments}</span>
                    </h2>
                  </div>
                  <div className="flex gap-1 rounded-full bg-white p-1 text-sm shadow-2xs border border-black/5">
                    {['All moments', 'Photos', 'Videos', 'Audio'].map((x) => (
                      <button
                        key={x}
                        onClick={() => {
                          setFilter(x);
                          setLightboxIndex(null);
                        }}
                        className={`rounded-full px-4 py-1.5 transition ${filter === x ? 'bg-moss text-white font-semibold' : 'text-black/55 hover:text-black'}`}
                      >
                        {x}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between border-b border-black/10 pb-3 text-xs font-semibold uppercase tracking-[.16em] text-black/45">
                  <span>{filter}</span>
                  <span>
                    {photoCount} photos · {videoCount} videos · {audioCount} audio
                  </span>
                </div>
                {canManage && filteredMedia.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-moss/15 bg-white px-4 py-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                      <input type="checkbox" checked={filteredMedia.length > 0 && selectedMediaIds.length === filteredMedia.length} onChange={selectAllVisible} />
                      Select all {filter === 'All moments' ? 'moments' : filter.toLowerCase()}
                    </label>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-black/55">{selectedMediaIds.length} selected</span>
                      <button disabled={!selectedMediaIds.length || mediaActionBusy} onClick={deleteSelectedMedia} className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{mediaActionBusy ? 'Deleting…' : 'Delete selected'}</button>
                    </div>
                  </div>
                )}

                {lightboxImages.length > 0 && (
                  <p className="mt-2 text-[11px] text-black/40">
                    Click any photo to open it full screen, then browse with ← →.
                  </p>
                )}

                {/* Media Grid */}
                {mediaList.length > 0 ? (
                  filteredMedia.length > 0 ? (
                    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {filteredMedia.map((media) => {
                        const kind = mediaKind(media.mime_type);

                        if (kind === 'audio') {
                          return (
                            <div
                              key={media.id}
                              className="group relative flex aspect-[.83] flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-moss via-emerald-700 to-teal-800 p-4 text-white shadow-2xs transition hover:-translate-y-1"
                            >
                              {canManage && <input aria-label={`Select ${media.filename}`} type="checkbox" checked={selectedMediaIds.includes(media.id)} onChange={() => toggleMediaSelection(media.id)} className="absolute left-3 top-3 z-20 h-5 w-5 accent-moss" />}
                              <div className="flex items-start justify-between">
                                <span className="text-2xl">🎧</span>
                                <span className="rounded-full bg-white/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider backdrop-blur-xs">
                                  Audio
                                </span>
                              </div>
                              <div>
                                <p className="line-clamp-2 text-sm font-medium">{media.caption || media.filename}</p>
                                <p className="mt-1 text-[10px] uppercase tracking-[.16em] text-white/60">{media.status}</p>
                                {media.url && (
                                  <audio src={media.url} controls preload="metadata" className="mt-2 w-full" />
                                )}
                              </div>
                            </div>
                          );
                        }

                        const imageIndex = imageIndexById.get(media.id);

                        if (kind === 'image' && media.url && imageIndex !== undefined) {
                          return (
                            <div key={media.id} className="group relative aspect-[.83] overflow-hidden rounded-2xl">
                            {canManage && <input aria-label={`Select ${media.filename}`} type="checkbox" checked={selectedMediaIds.includes(media.id)} onChange={() => toggleMediaSelection(media.id)} onClick={e => e.stopPropagation()} className="absolute left-3 top-3 z-20 h-5 w-5 accent-moss" />}
                            <button
                              type="button"
                              onClick={() => setLightboxIndex(imageIndex)}
                              aria-label={`Open ${media.caption || media.filename} full screen`}
                              className="group relative aspect-[.83] overflow-hidden rounded-2xl bg-neutral-100 text-left shadow-2xs transition hover:-translate-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss"
                            >
                              <img
                                src={media.url}
                                alt={media.caption || media.filename}
                                className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                                loading="lazy"
                              />
                              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 pt-16 text-white">
                                <p className="text-[10px] font-semibold tracking-[.18em] text-white/70">
                                  {media.status === 'READY' ? 'READY' : media.status}
                                </p>
                                <p className="mt-1 truncate text-sm font-medium">{media.caption || media.filename}</p>
                              </div>
                              <span className="pointer-events-none absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-sm text-white opacity-0 backdrop-blur-xs transition group-hover:opacity-100">
                                ⤢
                              </span>
                            </button></div>
                          );
                        }

                        return (
                          <div
                            key={media.id}
                            className="group relative aspect-[.83] overflow-hidden rounded-2xl bg-neutral-100 text-left shadow-2xs transition hover:-translate-y-1"
                          >
                            {canManage && <input aria-label={`Select ${media.filename}`} type="checkbox" checked={selectedMediaIds.includes(media.id)} onChange={() => toggleMediaSelection(media.id)} className="absolute left-3 top-3 z-20 h-5 w-5 accent-moss" />}
                            {media.url ? (
                              <video src={media.url} controls playsInline className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-moss/10 text-3xl">
                                🎬
                              </div>
                            )}

                            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 pt-16 text-white">
                              <p className="text-[10px] font-semibold tracking-[.18em] text-white/70">
                                {media.status === 'READY' ? 'READY' : media.status}
                              </p>
                              <p className="mt-1 truncate text-sm font-medium">{media.caption || media.filename}</p>
                            </div>
                            {kind === 'video' && (
                              <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/50 px-2 py-1 text-[11px] text-white backdrop-blur-xs">
                                ▶ Video
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-dashed border-moss/30 bg-white/50 p-8 text-center">
                      <p className="text-2xl">{filter === 'Audio' ? '🎧' : filter === 'Videos' ? '🎬' : '📷'}</p>
                      <p className="mt-2 text-sm text-black/60">No {filter.toLowerCase()} in this trip yet.</p>
                      <button
                        onClick={() => setOpenUpload(true)}
                        className="mt-3 text-sm font-semibold text-moss underline underline-offset-4"
                      >
                        Upload {filter === 'Photos' ? 'a photo' : filter === 'Videos' ? 'a video' : 'audio'}
                      </button>
                    </div>
                  )
                ) : (
                  <div className="mt-5 rounded-3xl border border-dashed border-moss/30 bg-white/60 px-6 py-14 text-center">
                    <p className="text-4xl">🎒</p>
                    <h3 className="mt-3 text-lg font-semibold text-ink">{trip.title} is ready for its first memory</h3>
                    <p className="mx-auto mt-1 max-w-md text-sm text-black/55">
                      Add photos, videos, and audio to this trip’s shared gallery. Everyone you invite can contribute too.
                    </p>
                    <button
                      onClick={() => setOpenUpload(true)}
                      className="mt-5 rounded-full bg-moss px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-moss/90"
                    >
                      ＋ Add photos, videos, or audio
                    </button>
                  </div>
                )}

                {mediaList.length > 0 && (
                  <div className="mt-10 rounded-2xl border border-dashed border-moss/30 bg-white/50 p-8 text-center">
                    <p className="text-2xl">📸</p>
                    <p className="mt-2 font-medium text-ink">Have a moment we haven’t seen?</p>
                    <button
                      onClick={() => setOpenUpload(true)}
                      className="mt-3 text-sm font-semibold text-moss underline underline-offset-4"
                    >
                      Add photos, videos, or audio
                    </button>
                  </div>
                )}
              </section>
            </>
          ) : (
            /* Trip missing / no access */
            <section className="mx-auto max-w-7xl px-6 py-8">
              <div className="rounded-[2rem] border border-dashed border-moss/30 bg-white/60 px-6 py-16 text-center">
                <p className="text-4xl">🧭</p>
                <h1 className="mt-3 text-2xl font-semibold text-ink">
                  {user ? 'This trip isn’t available' : 'Sign in to view this trip'}
                </h1>
                <p className="mx-auto mt-2 max-w-md text-sm text-black/55">
                  {user
                    ? 'It may have been deleted, or you may not be a member yet. Ask an admin for a fresh invite link.'
                    : 'This link points to a shared trip. Sign in or create an account to open its gallery.'}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {!user && (
                    <button
                      onClick={() => setOpenUpload(true)}
                      className="rounded-full bg-moss px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-moss/90"
                    >
                      Sign in or create account
                    </button>
                  )}
                  <button
                    onClick={() => navigate('/')}
                    className="rounded-full border border-black/15 bg-white px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-black/5"
                  >
                    Back to trips
                  </button>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* Upload Modal */}
      {openUpload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => setOpenUpload(false)}
        >
          <section
            className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-3xl bg-cream p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-black/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-moss font-bold">SHARE THE GOOD STUFF</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink">Add your moments</h2>
              </div>
              <button
                onClick={() => setOpenUpload(false)}
                className="grid h-8 w-8 place-items-center rounded-full bg-black/5 text-sm font-semibold hover:bg-black/10"
              >
                ✕
              </button>
            </div>
            <UploadPanel
              isAppAdmin={isAppAdmin}
              userRole={userRole}
              myPhotoCount={myPhotoCount}
              onUploadComplete={() => {
                loadData();
              }}
            />
          </section>
        </div>
      )}

      {/* User Profile Modal */}
      <ProfileModal
        isOpen={openProfile}
        onClose={() => setOpenProfile(false)}
        user={user}
        trip={trip}
        userRole={userRole}
        isAppAdmin={isAppAdmin}
        onUserUpdated={(updatedUser) => setUser(updatedUser)}
        onLogout={handleLogout}
        onTripSwitched={handleTripSelect}
        onCreateTrip={isAppAdmin ? () => setOpenCreateTrip(true) : undefined}
      />

      {/* Create Trip Modal */}
      <CreateTripModal
        isOpen={openCreateTrip}
        onClose={() => setOpenCreateTrip(false)}
        onCreated={(tripId) => {
          handleTripSelect(tripId);
          setBannerMessage('🎉 Trip created! Add photos, videos, or audio to its gallery.');
        }}
      />

      {/* Admin trip settings: update or delete */}
      <TripSettingsModal
        isOpen={!!manageTrip}
        trip={manageTrip}
        isAppAdmin={isAppAdmin}
        onClose={() => setManageTrip(null)}
        onUpdated={handleTripUpdated}
        onDeleted={handleTripDeleted}
      />

      {/* Shareable Link & Members Modal */}
      <ShareModal
        isOpen={openShare}
        onClose={() => setOpenShare(false)}
        trip={trip}
        trips={trips}
        isAppAdmin={isAppAdmin}
        currentUserId={user?.id}
      />

      {/* Full-screen photo viewer */}
      {lightboxIndex !== null && lightboxImages.length > 0 && (
        <Lightbox
          items={lightboxImages}
          index={Math.min(lightboxIndex, lightboxImages.length - 1)}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}

      {/* Join Trip Invitation Modal */}
      {openJoin && joinToken && (
        <JoinModal
          token={joinToken}
          onJoined={(joinedTripId, joinedTripTitle) => {
            setOpenJoin(false);
            setJoinToken(null);
            setBannerMessage(`🎉 You joined ${joinedTripTitle} as a Member!`);
            navigate(`/trips/${joinedTripId}`, true);
          }}
          onClose={() => {
            setOpenJoin(false);
            setJoinToken(null);
            window.history.replaceState({}, document.title, window.location.pathname);
          }}
        />
      )}
    </main>
  );
}
