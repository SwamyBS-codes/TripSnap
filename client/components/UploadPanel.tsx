'use client';
import { useEffect, useRef, useState } from 'react';
import Uppy from '@uppy/core';
import AwsS3 from '@uppy/aws-s3';
import { Dashboard } from '@uppy/react';

const API = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000/api` : 'http://localhost:4000/api');

interface UploadPanelProps {
  onUploadComplete?: () => void;
  isAppAdmin?: boolean;
  userRole?: 'owner' | 'member' | null;
  myPhotoCount?: number;
}

export default function UploadPanel({
  onUploadComplete,
  isAppAdmin = false,
  userRole = null,
  myPhotoCount = 0
}: UploadPanelProps) {
  const [token, setToken] = useState('');
  const tokenRef = useRef('');
  const [error, setError] = useState('');
  const [signup, setSignup] = useState(false);
  const [tripId, setTripId] = useState('');
  const tripRef = useRef('');

  const canUploadAll = isAppAdmin || userRole === 'owner';
  const memberPhotoLimitReached = !canUploadAll && myPhotoCount >= 1;

  useEffect(() => {
    const saved = localStorage.getItem('tripvault-token') || '';
    tokenRef.current = saved;
    setToken(saved);
    const savedTrip = localStorage.getItem('tripvault-trip-id') || import.meta.env.VITE_DEMO_TRIP_ID || '';
    tripRef.current = savedTrip;
    setTripId(savedTrip);

    // If the token exists but no trip is selected yet, fall back to the user's first trip.
    if (saved && !savedTrip) {
      fetch(`${API}/user/profile`, { headers: { Authorization: `Bearer ${saved}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const firstTripId = data?.trips?.[0]?.id;
          if (firstTripId) {
            localStorage.setItem('tripvault-trip-id', firstTripId);
            tripRef.current = firstTripId;
            setTripId(firstTripId);
          }
        })
        .catch(() => {});
    }
  }, []);

  const authenticate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      const endpoint = signup ? 'signup' : 'login';
      const response = await fetch(`${API}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
          name: form.get('name') || 'Trip member'
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not sign in');
      localStorage.setItem('tripvault-token', data.accessToken);
      tokenRef.current = data.accessToken;
      setToken(data.accessToken);

      // Load the user's trips so an existing trip can be used immediately.
      const profile = await fetch(`${API}/user/profile`, {
        headers: { Authorization: `Bearer ${data.accessToken}` }
      })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      const firstTripId = profile?.trips?.[0]?.id;
      if (firstTripId) {
        localStorage.setItem('tripvault-trip-id', firstTripId);
        tripRef.current = firstTripId;
        setTripId(firstTripId);
      }
      onUploadComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    }
  };

  const makeTrip = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      const response = await fetch(`${API}/trips`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.get('title'),
          location: form.get('location'),
          startDate: form.get('startDate'),
          endDate: form.get('endDate'),
          description: ''
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not create trip');
      localStorage.setItem('tripvault-trip-id', data.id);
      tripRef.current = data.id;
      setTripId(data.id);
      onUploadComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trip creation failed');
    }
  };

  const [uppy] = useState(() => {
    const u = new Uppy({
      autoProceed: false,
      restrictions: {
        maxFileSize: 2 * 1024 ** 3,
        maxNumberOfFiles: 100,
        allowedFileTypes: ['image/*', 'video/*', 'audio/*']
      }
    });

    const auth = () => ({
      Authorization: `Bearer ${tokenRef.current}`,
      'Content-Type': 'application/json'
    });

    const ensureMedia = async (file: any) => {
      if (file.meta.mediaId) return file.meta.mediaId;
      const response = await fetch(`${API}/trips/${tripRef.current}/media`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type,
          size: file.size,
          caption: file.meta.caption || ''
        })
      });
      if (!response.ok) throw new Error((await response.text()) || 'Could not create media record');
      const data = await response.json();
      u.setFileMeta(file.id, { mediaId: data.mediaId });
      return data.mediaId;
    };

    u.use(AwsS3, {
      shouldUseMultipart: (file) => (file.size || 0) > 100 * 1024 ** 2,
      getUploadParameters: async (file) => {
        const mediaId = await ensureMedia(file);
        const response = await fetch(`${API}/media/${mediaId}/upload-url`, {
          method: 'POST',
          headers: auth()
        });
        if (!response.ok) throw new Error('Could not create upload URL');
        const signed = await response.json();
        return { method: 'PUT', url: signed.url, headers: signed.headers };
      },
      createMultipartUpload: async (file) => {
        const mediaId = await ensureMedia(file);
        u.setFileMeta(file.id, { multipart: true });
        const response = await fetch(`${API}/media/${mediaId}/multipart`, {
          method: 'POST',
          headers: auth()
        });
        if (!response.ok) throw new Error('Could not start multipart upload');
        const result = await response.json();
        return { uploadId: result.uploadId, key: mediaId };
      },
      listParts: async (file, { uploadId }) => {
        const mediaId = (file.meta as any).mediaId;
        const response = await fetch(`${API}/media/${mediaId}/multipart/${uploadId}/parts`, { headers: auth() });
        if (!response.ok) throw new Error('Could not restore uploaded parts');
        return response.json();
      },
      signPart: async (file, { uploadId, partNumber }) => {
        const mediaId = (file.meta as any).mediaId;
        const response = await fetch(`${API}/media/${mediaId}/multipart/${uploadId}/part-url`, {
          method: 'POST',
          headers: auth(),
          body: JSON.stringify({ partNumber })
        });
        if (!response.ok) throw new Error('Could not sign upload part');
        const signed = await response.json();
        return { url: signed.url };
      },
      completeMultipartUpload: async (file, { uploadId, parts }) => {
        const mediaId = (file.meta as any).mediaId;
        const response = await fetch(`${API}/media/${mediaId}/multipart/${uploadId}/complete`, {
          method: 'POST',
          headers: auth(),
          body: JSON.stringify({ parts })
        });
        if (!response.ok) throw new Error('Could not complete multipart upload');
        return { location: '' };
      },
      abortMultipartUpload: async () => {}
    });

    u.on('upload-success', async (file) => {
      if (!file || (file.meta as any).multipart) return;
      const mediaId = (file.meta as any).mediaId;
      if (mediaId) {
        const response = await fetch(`${API}/media/${mediaId}/complete`, {
          method: 'POST',
          headers: auth()
        });
        if (!response.ok) {
          setError('Upload finished, but processing could not be queued.');
        } else {
          onUploadComplete?.();
        }
      }
    });

    u.on('complete', () => {
      onUploadComplete?.();
    });

    u.on('upload-error', (_file, err) => setError(err.message));

    return u;
  });

  useEffect(() => {
    uppy.setOptions({
      restrictions: {
        maxFileSize: 2 * 1024 ** 3,
        maxNumberOfFiles: canUploadAll ? 100 : Math.max(0, 1 - myPhotoCount),
        allowedFileTypes: canUploadAll ? ['image/*', 'video/*', 'audio/*'] : ['image/*']
      }
    });
  }, [uppy, canUploadAll, myPhotoCount]);

  if (!token) {
    return (
      <form onSubmit={authenticate} className="rounded-2xl bg-white p-5">
        <p className="font-medium">{signup ? 'Create your TripVault account' : 'Welcome back'}</p>
        {signup && <input name="name" placeholder="Your name" required className="mt-3 w-full rounded-xl border p-3 text-sm" />}
        <input name="email" type="email" placeholder="Email address" required className="mt-3 w-full rounded-xl border p-3 text-sm" />
        <input name="password" type="password" minLength={12} placeholder="Password (12+ characters)" required className="mt-3 w-full rounded-xl border p-3 text-sm" />
        <button type="submit" className="mt-4 w-full rounded-full bg-moss px-4 py-3 text-sm font-semibold text-white">
          {signup ? 'Create account' : 'Sign in'}
        </button>
        <button type="button" onClick={() => setSignup(!signup)} className="mt-3 text-sm text-moss underline">
          {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      </form>
    );
  }

  if (!tripId) {
    if (!canUploadAll) {
      return (
        <div className="rounded-2xl bg-white p-6 text-center">
          <p className="text-3xl">🔒</p>
          <p className="mt-2 font-semibold">No trip assigned yet</p>
          <p className="mt-1 text-sm text-black/55">
            Ask an admin for an invite link. Members can view photos and videos and add one photo to each trip.
          </p>
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      );
    }

    return (
      <form onSubmit={makeTrip} className="rounded-2xl bg-white p-5">
        <p className="font-medium">Create your first trip</p>
        <input name="title" placeholder="Trip name" required className="mt-3 w-full rounded-xl border p-3 text-sm" />
        <input name="location" placeholder="Location" required className="mt-3 w-full rounded-xl border p-3 text-sm" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <input name="startDate" type="date" required className="rounded-xl border p-3 text-sm" />
          <input name="endDate" type="date" required className="rounded-xl border p-3 text-sm" />
        </div>
        <button type="submit" className="mt-4 w-full rounded-full bg-moss px-4 py-3 text-sm font-semibold text-white">
          Create trip
        </button>
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      </form>
    );
  }

  if (memberPhotoLimitReached) {
    return (
      <div className="rounded-2xl bg-white p-6 text-center">
        <p className="text-3xl">✅</p>
        <p className="mt-2 font-semibold">You’ve added your photo</p>
        <p className="mt-1 text-sm text-black/55">
          Members can add one photo to each trip. You can still browse everyone’s photos and videos in the gallery.
        </p>
        {error && <p role="status" className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <>
      {!canUploadAll && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-900">
          👤 Member access: you can add one photo to this trip. Videos and audio are view-only.
        </div>
      )}
      <Dashboard
        uppy={uppy}
        proudlyDisplayPoweredByUppy={false}
        note={
          canUploadAll
            ? 'Photos, videos, and audio up to 2 GB · uploads go straight to private storage'
            : 'Add one photo up to 2 GB · your upload goes to private storage'
        }
      />
      {error && <p role="status" className="mt-2 text-sm text-red-700">{error}</p>}
    </>
  );
}
