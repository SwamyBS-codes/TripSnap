import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { S3Client, PutObjectCommand, GetObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, ListPartsCommand, HeadObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Kafka } from 'kafkajs';
import { Pool, types } from 'pg';
import { randomUUID, scryptSync, timingSafeEqual, randomBytes, createHash } from 'node:crypto';

// Keep PostgreSQL `date` columns as YYYY-MM-DD strings so trip dates do not
// shift by a day when serialized to the browser.
types.setTypeParser(1082, (value: string) => value);

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const bucket = process.env.S3_ORIGINALS_BUCKET || 'tripvault-originals';
const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: !!process.env.S3_ENDPOINT,
  credentials: process.env.S3_ACCESS_KEY ? {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY || ''
  } : undefined
});

function getSigner(req: Request) {
  // With no custom endpoint, use the normal AWS S3 endpoint and SDK credentials.
  if (!process.env.S3_ENDPOINT) return s3;
  const host = req.hostname || 'localhost';
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  const endpoint = (process.env.S3_PUBLIC_ENDPOINT && !process.env.S3_PUBLIC_ENDPOINT.includes('localhost'))
    ? process.env.S3_PUBLIC_ENDPOINT
    : `${protocol}://${host}:9000`;
  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || '',
      secretAccessKey: process.env.S3_SECRET_KEY || ''
    }
  });
}

const kafka = new Kafka({ clientId: 'tripvault-api', brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',') });
const producer = kafka.producer();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const MAX_BYTES = 2 * 1024 ** 3;
const ALLOWED = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
  // Video
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/mpeg',
  // Audio
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/x-aac',
  'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/x-ogg', 'audio/opus', 'audio/webm',
  'audio/flac', 'audio/x-flac', 'audio/3gpp'
]);
const allowedOrigins = (process.env.WEB_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);

function mediaKind(mimeType: string): 'image' | 'video' | 'audio' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'video';
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      !process.env.WEB_ORIGIN ||
      allowedOrigins.includes('*') ||
      allowedOrigins.includes(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));

type User = { sub: string, email: string };
type AuthedRequest = Request & { user?: User };

function auth(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const value = req.header('authorization');
    if (!value?.startsWith('Bearer ')) return next(Object.assign(new Error('Authentication required'), { status: 401 }));
    req.user = jwt.verify(value.slice(7), JWT_SECRET) as User;
    next();
  } catch {
    return next(Object.assign(new Error('Invalid or expired token'), { status: 401 }));
  }
}

function wrap(fn: (req: AuthedRequest, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req as AuthedRequest, res)).catch(next);
}

async function member(userId: string, tripId: string) {
  const q = await pool.query('SELECT 1 FROM trip_members WHERE user_id=$1 AND trip_id=$2', [userId, tripId]);
  return !!q.rowCount;
}

async function getTripRole(userId: string, tripId: string): Promise<'owner' | 'member' | null> {
  const { rows } = await pool.query('SELECT role FROM trip_members WHERE user_id=$1 AND trip_id=$2', [userId, tripId]);
  return rows[0]?.role || null;
}

async function isAppAdmin(userId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT is_admin FROM users WHERE id=$1', [userId]);
  return !!rows[0]?.is_admin;
}

async function canManageTrip(userId: string, tripId: string): Promise<boolean> {
  if (await isAppAdmin(userId)) return true;
  return (await getTripRole(userId, tripId)) === 'owner';
}

async function authorizedMedia(userId: string, id: string) {
  const { rows } = await pool.query('SELECT m.* FROM media m JOIN trip_members tm ON tm.trip_id=m.trip_id WHERE m.id=$1 AND tm.user_id=$2', [id, userId]);
  if (!rows[0]) throw Object.assign(new Error('Media not found or trip access denied'), { status: 403 });
  return rows[0];
}

async function enqueue(media: any) {
  await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: media.s3_key }));
  await pool.query("UPDATE media SET status='PROCESSING',updated_at=now() WHERE id=$1", [media.id]);
  await producer.send({
    topic: 'media-uploaded',
    messages: [{
      key: media.id,
      value: JSON.stringify({ mediaId: media.id, s3Key: media.s3_key, type: mediaKind(media.mime_type) })
    }]
  });
}

async function removeS3Keys(bucketName: string, keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    const Objects = keys.slice(i, i + 1000).map(Key => ({ Key }));
    if (Objects.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucketName, Delete: { Objects } }));
    }
  }
}

function assertValidTripDates(startDate: string, endDate: string) {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw Object.assign(new Error('Valid start and end dates are required'), { status: 400 });
  }
  if (end < start) {
    throw Object.assign(new Error('Trip end date must be on or after the start date'), { status: 400 });
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// Auth
app.post('/api/auth/signup', wrap(async (req, res) => {
  const { email, password, name } = req.body;
  if (typeof email !== 'string' || !/^.+@.+\..+$/.test(email) || typeof password !== 'string' || password.length < 12 || typeof name !== 'string') {
    throw Object.assign(new Error('Valid email, name, and password (12+ chars) required'), { status: 400 });
  }
  const salt = randomUUID(), hash = scryptSync(password, salt, 64).toString('hex');
  try {
    const { rows } = await pool.query(
      `INSERT INTO users(email,name,password_hash,is_admin)
       VALUES($1,$2,$3, NOT EXISTS (SELECT 1 FROM users WHERE is_admin))
       RETURNING id,email,name,is_admin`,
      [email, name, `${salt}:${hash}`]
    );
    res.status(201).json({ accessToken: jwt.sign({ sub: rows[0].id, email: rows[0].email }, JWT_SECRET, { expiresIn: '7d' }), user: rows[0] });
  } catch {
    throw Object.assign(new Error('Account could not be created'), { status: 409 });
  }
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query('SELECT id,email,name,password_hash,is_admin FROM users WHERE email=$1', [email]);
  if (!rows[0] || typeof password !== 'string') throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  const [salt, expected] = rows[0].password_hash.split(':');
  const actual = scryptSync(password, salt, 64);
  if (!timingSafeEqual(actual, Buffer.from(expected, 'hex'))) throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  res.json({ accessToken: jwt.sign({ sub: rows[0].id, email: rows[0].email }, JWT_SECRET, { expiresIn: '7d' }), user: { id: rows[0].id, email: rows[0].email, name: rows[0].name, is_admin: rows[0].is_admin } });
}));

// User Profile
app.get('/api/user/profile', auth, wrap(async (req, res) => {
  const user = req.user!;
  const { rows: userRows } = await pool.query('SELECT id, email, name, is_admin, created_at FROM users WHERE id=$1', [user.sub]);
  if (!userRows[0]) throw Object.assign(new Error('User not found'), { status: 404 });
  const { rows: tripRows } = await pool.query(
    `SELECT t.id, t.title, t.location, t.start_date, t.end_date, tm.role, tm.joined_at 
     FROM trips t 
     JOIN trip_members tm ON tm.trip_id=t.id 
     WHERE tm.user_id=$1 
     ORDER BY tm.joined_at DESC`,
    [user.sub]
  );
  res.json({
    user: userRows[0],
    trips: tripRows
  });
}));

app.put('/api/user/profile', auth, wrap(async (req, res) => {
  const user = req.user!;
  const { name, password } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw Object.assign(new Error('Valid name is required'), { status: 400 });
  }
  if (password) {
    if (typeof password !== 'string' || password.length < 12) {
      throw Object.assign(new Error('Password must be at least 12 characters'), { status: 400 });
    }
    const salt = randomUUID();
    const hash = scryptSync(password, salt, 64).toString('hex');
    const { rows } = await pool.query(
      'UPDATE users SET name=$1, password_hash=$2 WHERE id=$3 RETURNING id, email, name, is_admin',
      [name.trim(), `${salt}:${hash}`, user.sub]
    );
    return res.json({ user: rows[0] });
  } else {
    const { rows } = await pool.query(
      'UPDATE users SET name=$1 WHERE id=$2 RETURNING id, email, name, is_admin',
      [name.trim(), user.sub]
    );
    return res.json({ user: rows[0] });
  }
}));

// Trips
app.post('/api/trips', auth, wrap(async (req, res) => {
  const user = req.user!;
  if (!await isAppAdmin(user.sub)) {
    throw Object.assign(new Error('Only the app admin can create trips'), { status: 403 });
  }
  const { title, location, startDate, endDate, description = '' } = req.body;
  if (typeof title !== 'string' || typeof location !== 'string' || typeof startDate !== 'string' || typeof endDate !== 'string' || typeof description !== 'string' || !title.trim() || !location.trim()) {
    throw Object.assign(new Error('Trip title, location, and valid dates required'), { status: 400 });
  }
  assertValidTripDates(startDate, endDate);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('INSERT INTO trips(title,location,start_date,end_date,description,owner_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [title.trim(), location.trim(), startDate, endDate, description.trim(), user.sub]);
    await client.query("INSERT INTO trip_members(trip_id,user_id,role) VALUES($1,$2,'owner')", [rows[0].id, user.sub]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/trips', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, tm.role,
       COALESCE(stats.media_count, 0)::int AS media_count,
       COALESCE(stats.photo_count, 0)::int AS photo_count,
       COALESCE(stats.video_count, 0)::int AS video_count,
       COALESCE(stats.audio_count, 0)::int AS audio_count,
       COALESCE(members.member_count, 0)::int AS member_count,
       cover.processed_key AS cover_processed_key,
       cover.s3_key AS cover_s3_key
     FROM trips t
     JOIN trip_members tm ON tm.trip_id = t.id AND tm.user_id = $1
     LEFT JOIN LATERAL (
       SELECT count(*) AS media_count,
              count(*) FILTER (WHERE mime_type LIKE 'image/%') AS photo_count,
              count(*) FILTER (WHERE mime_type LIKE 'video/%') AS video_count,
              count(*) FILTER (WHERE mime_type LIKE 'audio/%') AS audio_count
       FROM media m WHERE m.trip_id = t.id
     ) stats ON true
     LEFT JOIN LATERAL (
       SELECT count(*) AS member_count FROM trip_members x WHERE x.trip_id = t.id
     ) members ON true
     LEFT JOIN LATERAL (
       SELECT processed_key, s3_key FROM media m
       WHERE m.trip_id = t.id AND m.status = 'READY' AND m.mime_type LIKE 'image/%'
       ORDER BY m.created_at DESC LIMIT 1
     ) cover ON true
     ORDER BY t.created_at DESC`,
    [req.user!.sub]
  );

  const processedBucket = process.env.S3_PROCESSED_BUCKET || 'tripvault-processed';
  const signer = getSigner(req);
  const items = await Promise.all(rows.map(async ({ cover_processed_key, cover_s3_key, ...trip }) => {
    let cover_url = '';
    if (cover_processed_key || cover_s3_key) {
      try {
        cover_url = await getSignedUrl(signer, new GetObjectCommand({
          Bucket: cover_processed_key ? processedBucket : bucket,
          Key: cover_processed_key || cover_s3_key
        }), { expiresIn: 3600 });
      } catch {}
    }
    return { ...trip, cover_url };
  }));
  res.json(items);
}));

app.get('/api/trips/:tripId', auth, wrap(async (req, res) => {
  const user = req.user!, { tripId } = req.params;
  if (!await member(user.sub, tripId)) throw Object.assign(new Error('Trip access denied'), { status: 403 });
  const { rows } = await pool.query(
    `SELECT t.*, tm.role,
       (SELECT count(*)::int FROM media m WHERE m.trip_id = t.id) AS media_count,
       (SELECT count(*)::int FROM media m WHERE m.trip_id = t.id AND m.mime_type LIKE 'image/%') AS photo_count,
       (SELECT count(*)::int FROM media m WHERE m.trip_id = t.id AND m.mime_type LIKE 'video/%') AS video_count,
       (SELECT count(*)::int FROM media m WHERE m.trip_id = t.id AND m.mime_type LIKE 'audio/%') AS audio_count,
       (SELECT count(*)::int FROM trip_members x WHERE x.trip_id = t.id) AS member_count
     FROM trips t JOIN trip_members tm ON tm.trip_id = t.id
     WHERE t.id = $1 AND tm.user_id = $2`,
    [tripId, user.sub]
  );
  if (!rows[0]) throw Object.assign(new Error('Trip not found'), { status: 404 });
  res.json(rows[0]);
}));

// Update trip details (owner/admin only)
app.patch('/api/trips/:tripId', auth, wrap(async (req, res) => {
  const user = req.user!, { tripId } = req.params;
  if (!await canManageTrip(user.sub, tripId)) {
    throw Object.assign(new Error('Only an admin can update trip details'), { status: 403 });
  }

  const { title, location, startDate, endDate, description } = req.body;
  for (const [name, value] of Object.entries({ title, location, startDate, endDate, description })) {
    if (value !== undefined && typeof value !== 'string') {
      throw Object.assign(new Error(`${name} must be a string`), { status: 400 });
    }
  }

  const { rows: currentRows } = await pool.query('SELECT * FROM trips WHERE id=$1', [tripId]);
  if (!currentRows[0]) throw Object.assign(new Error('Trip not found'), { status: 404 });
  const current = currentRows[0];

  const nextTitle = (title ?? current.title).trim();
  const nextLocation = (location ?? current.location).trim();
  const nextStart = startDate || current.start_date;
  const nextEnd = endDate || current.end_date;
  const nextDescription = description ?? current.description;

  if (!nextTitle || !nextLocation) {
    throw Object.assign(new Error('Trip title and location are required'), { status: 400 });
  }
  assertValidTripDates(nextStart, nextEnd);

  const { rows } = await pool.query(
    `UPDATE trips SET title=$1, location=$2, start_date=$3, end_date=$4, description=$5
     WHERE id=$6 RETURNING *`,
    [nextTitle, nextLocation, nextStart, nextEnd, nextDescription.trim(), tripId]
  );
  res.json(rows[0]);
}));

// Delete a trip and its media (owner/admin only). The database cascade removes
// rows; stored objects are removed from MinIO/S3 on a best-effort basis.
app.delete('/api/trips/:tripId', auth, wrap(async (req, res) => {
  const user = req.user!, { tripId } = req.params;
  if (!await canManageTrip(user.sub, tripId)) {
    throw Object.assign(new Error('Only an admin can delete a trip'), { status: 403 });
  }

  const { rows: mediaRows } = await pool.query('SELECT s3_key, processed_key FROM media WHERE trip_id=$1', [tripId]);
  const { rows } = await pool.query('DELETE FROM trips WHERE id=$1 RETURNING id', [tripId]);
  if (!rows[0]) throw Object.assign(new Error('Trip not found'), { status: 404 });

  const processedBucket = process.env.S3_PROCESSED_BUCKET || 'tripvault-processed';
  Promise.allSettled([
    removeS3Keys(bucket, mediaRows.map(m => m.s3_key).filter(Boolean)),
    removeS3Keys(processedBucket, mediaRows.map(m => m.processed_key).filter(Boolean))
  ]).catch(error => console.error('Failed to clean up trip media objects', { tripId, error }));

  res.json({ success: true, deletedTripId: tripId });
}));

// Trip Members & Roles (Admin / Member)
app.get('/api/trips/:tripId/members', auth, wrap(async (req, res) => {
  const user = req.user!, { tripId } = req.params;
  if (!await member(user.sub, tripId)) throw Object.assign(new Error('Trip access denied'), { status: 403 });
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, tm.role, tm.joined_at 
     FROM trip_members tm 
     JOIN users u ON u.id = tm.user_id 
     WHERE tm.trip_id = $1 
     ORDER BY tm.role = 'owner' DESC, tm.joined_at ASC`,
    [tripId]
  );
  res.json(rows);
}));

app.patch('/api/trips/:tripId/members/:targetUserId', auth, wrap(async (req, res) => {
  const user = req.user!, { tripId, targetUserId } = req.params;
  const currentRole = await getTripRole(user.sub, tripId);
  if (currentRole !== 'owner') throw Object.assign(new Error('Only trip admin/owner can change roles'), { status: 403 });

  const { role } = req.body;
  if (role !== 'owner' && role !== 'member') {
    throw Object.assign(new Error('Role must be either "owner" (Admin) or "member" (Member)'), { status: 400 });
  }

  // Prevent demoting the last owner
  if (role === 'member') {
    const { rows: ownerCount } = await pool.query("SELECT COUNT(*) FROM trip_members WHERE trip_id=$1 AND role='owner'", [tripId]);
    if (parseInt(ownerCount[0].count, 10) <= 1) {
      const { rows: target } = await pool.query("SELECT role FROM trip_members WHERE trip_id=$1 AND user_id=$2", [tripId, targetUserId]);
      if (target[0]?.role === 'owner') {
        throw Object.assign(new Error('Cannot demote the only admin of the trip'), { status: 400 });
      }
    }
  }

  const { rows } = await pool.query(
    'UPDATE trip_members SET role=$1 WHERE trip_id=$2 AND user_id=$3 RETURNING trip_id, user_id, role',
    [role, tripId, targetUserId]
  );
  if (!rows[0]) throw Object.assign(new Error('Member not found in trip'), { status: 404 });
  res.json(rows[0]);
}));

app.delete('/api/trips/:tripId/members/:targetUserId', auth, wrap(async (req, res) => {
  const user = req.user!, { tripId, targetUserId } = req.params;
  const currentRole = await getTripRole(user.sub, tripId);
  if (!currentRole) throw Object.assign(new Error('Trip access denied'), { status: 403 });

  if (user.sub !== targetUserId && currentRole !== 'owner') {
    throw Object.assign(new Error('Only trip admin can remove other members'), { status: 403 });
  }

  // Prevent leaving if sole owner
  const { rows: target } = await pool.query('SELECT role FROM trip_members WHERE trip_id=$1 AND user_id=$2', [tripId, targetUserId]);
  if (target[0]?.role === 'owner') {
    const { rows: ownerCount } = await pool.query("SELECT COUNT(*) FROM trip_members WHERE trip_id=$1 AND role='owner'", [tripId]);
    if (parseInt(ownerCount[0].count, 10) <= 1) {
      throw Object.assign(new Error('Cannot remove the only admin of the trip. Transfer ownership first.'), { status: 400 });
    }
  }

  await pool.query('DELETE FROM trip_members WHERE trip_id=$1 AND user_id=$2', [tripId, targetUserId]);
  res.json({ success: true, removedUserId: targetUserId });
}));

// Shareable Invitations
app.post('/api/trips/:tripId/invitations', auth, wrap(async (req, res) => {
  const user = req.user!, { tripId } = req.params;
  if (!await canManageTrip(user.sub, tripId)) {
    throw Object.assign(new Error('Only an admin can create invite links'), { status: 403 });
  }

  const token = randomBytes(16).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const { rows } = await pool.query(
    'INSERT INTO invitations(trip_id, role, token_hash, expires_at, created_by) VALUES($1, $2, $3, $4, $5) RETURNING id, expires_at',
    [tripId, 'member', tokenHash, expiresAt, user.sub]
  );

  res.status(201).json({
    invitationId: rows[0].id,
    token,
    expiresAt: rows[0].expires_at,
    role: 'member'
  });
}));

app.get('/api/trips/join-info/:token', wrap(async (req, res) => {
  const { token } = req.params;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { rows } = await pool.query(
    `SELECT i.id, i.trip_id, i.expires_at, i.role, t.title, t.location, t.start_date, t.end_date, u.name as inviter_name 
     FROM invitations i 
     JOIN trips t ON t.id = i.trip_id 
     JOIN users u ON u.id = i.created_by 
     WHERE i.token_hash = $1 AND i.expires_at > now()`,
    [tokenHash]
  );
  if (!rows[0]) throw Object.assign(new Error('Invitation link is invalid or expired'), { status: 404 });
  res.json({
    valid: true,
    trip: {
      id: rows[0].trip_id,
      title: rows[0].title,
      location: rows[0].location,
      startDate: rows[0].start_date,
      endDate: rows[0].end_date
    },
    role: rows[0].role,
    inviter: rows[0].inviter_name,
    expiresAt: rows[0].expires_at
  });
}));

app.post('/api/trips/join/:token', auth, wrap(async (req, res) => {
  const user = req.user!, { token } = req.params;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { rows } = await pool.query(
    'SELECT i.*, t.title FROM invitations i JOIN trips t ON t.id = i.trip_id WHERE i.token_hash = $1 AND i.expires_at > now()',
    [tokenHash]
  );
  if (!rows[0]) throw Object.assign(new Error('Invitation link is invalid or expired'), { status: 404 });
  
  const tripId = rows[0].trip_id;
  const existingRole = await getTripRole(user.sub, tripId);
  if (existingRole) {
    return res.json({
      success: true,
      alreadyMember: true,
      tripId,
      tripTitle: rows[0].title,
      role: existingRole
    });
  }

  await pool.query(
    "INSERT INTO trip_members(trip_id, user_id, role) VALUES($1, $2, 'member') ON CONFLICT (trip_id, user_id) DO NOTHING",
    [tripId, user.sub]
  );
  await pool.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [rows[0].id]);

  res.json({
    success: true,
    alreadyMember: false,
    tripId,
    tripTitle: rows[0].title,
    role: 'member'
  });
}));

// Media
app.get('/api/trips/:tripId/media', auth, wrap(async (req, res) => {
  const user = req.user!, { tripId } = req.params;
  if (!await member(user.sub, tripId)) throw Object.assign(new Error('Trip access denied'), { status: 403 });
  const { rows } = await pool.query('SELECT * FROM media WHERE trip_id=$1 ORDER BY created_at DESC', [tripId]);
  const processedBucket = process.env.S3_PROCESSED_BUCKET || 'tripvault-processed';
  const client = getSigner(req);
  const items = await Promise.all(rows.map(async (m: any) => {
    let url = '';
    try {
      const b = m.processed_key ? processedBucket : bucket;
      const k = m.processed_key || m.s3_key;
      url = await getSignedUrl(client, new GetObjectCommand({ Bucket: b, Key: k }), { expiresIn: 3600 });
    } catch {}
    return { ...m, url };
  }));
  res.json(items);
}));

app.post('/api/trips/:tripId/media', auth, wrap(async (req, res) => {
  const user = req.user!, { tripId } = req.params;
  const { filename, mimeType, size, caption = '', location = null, takenAt = null } = req.body;
  if (typeof filename !== 'string' || !ALLOWED.has(mimeType) || !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) {
    throw Object.assign(new Error('Invalid filename, supported media type, or size (max 2 GB)'), { status: 400 });
  }
  const role = await getTripRole(user.sub, tripId);
  if (!role) throw Object.assign(new Error('Trip membership required'), { status: 403 });

  // Admins can upload photos, videos, and audio. Members may contribute a
  // single photo to each trip and can view everything else.
  const canUploadAll = (await isAppAdmin(user.sub)) || role === 'owner';
  if (!canUploadAll) {
    if (!String(mimeType).startsWith('image/')) {
      throw Object.assign(new Error('Members can upload photos only'), { status: 403 });
    }
    const { rows: uploadCount } = await pool.query(
      `SELECT count(*)::int AS count FROM media
       WHERE trip_id=$1 AND uploader_id=$2 AND mime_type LIKE 'image/%' AND status <> 'FAILED'`,
      [tripId, user.sub]
    );
    if (uploadCount[0].count >= 1) {
      throw Object.assign(new Error('Members can add one photo to each trip'), { status: 403 });
    }
  }

  const id = randomUUID(), key = `${tripId}/${id}/original`;
  await pool.query('INSERT INTO media(id,trip_id,uploader_id,filename,mime_type,size_bytes,s3_key,caption,location,taken_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, tripId, user.sub, filename, mimeType, size, key, caption, location, takenAt]);
  res.status(201).json({ mediaId: id, status: 'PENDING', s3Key: key });
}));

// Bulk media deletion is restricted to a trip owner or application admin.
app.delete('/api/trips/:tripId/media', auth, wrap(async (req, res) => {
  const user = req.user!, { tripId } = req.params;
  const mediaIds = req.body.mediaIds;
  if (!Array.isArray(mediaIds) || mediaIds.length < 1 || mediaIds.length > 500 || mediaIds.some((id: unknown) => typeof id !== 'string')) {
    throw Object.assign(new Error('Provide between 1 and 500 media IDs'), { status: 400 });
  }
  if (!await canManageTrip(user.sub, tripId)) throw Object.assign(new Error('Only trip admins can delete media'), { status: 403 });
  const { rows } = await pool.query('SELECT id,s3_key,processed_key,poster_key FROM media WHERE trip_id=$1 AND id=ANY($2::uuid[])', [tripId, mediaIds]);
  if (!rows.length) return res.json({ deleted: [] });
  await pool.query('DELETE FROM media WHERE trip_id=$1 AND id=ANY($2::uuid[])', [tripId, rows.map(row => row.id)]);
  const processedBucket = process.env.S3_PROCESSED_BUCKET || 'tripvault-processed';
  await Promise.allSettled([
    removeS3Keys(bucket, rows.map(row => row.s3_key).filter(Boolean)),
    removeS3Keys(processedBucket, rows.flatMap(row => [row.processed_key, row.poster_key]).filter(Boolean))
  ]);
  res.json({ deleted: rows.map(row => row.id) });
}));

app.post('/api/media/:id/upload-url', auth, wrap(async (req, res) => {
  const media = await authorizedMedia(req.user!.sub, req.params.id);
  if (Number(media.size_bytes) > 100 * 1024 ** 2) throw Object.assign(new Error('Use multipart upload for files over 100 MB'), { status: 400 });
  const command = new PutObjectCommand({ Bucket: bucket, Key: media.s3_key, ContentType: media.mime_type });
  res.json({ url: await getSignedUrl(getSigner(req), command, { expiresIn: 900 }), method: 'PUT', headers: { 'Content-Type': media.mime_type }, expiresIn: 900 });
}));

app.post('/api/media/:id/multipart', auth, wrap(async (req, res) => {
  const media = await authorizedMedia(req.user!.sub, req.params.id);
  if (Number(media.size_bytes) <= 100 * 1024 ** 2) throw Object.assign(new Error('Use single upload for files at or below 100 MB'), { status: 400 });
  const result = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: media.s3_key, ContentType: media.mime_type }));
  res.json({ uploadId: result.UploadId, partSize: 10 * 1024 * 1024 });
}));

app.get('/api/media/:id/multipart/:uploadId/parts', auth, wrap(async (req, res) => {
  const media = await authorizedMedia(req.user!.sub, req.params.id);
  const result = await s3.send(new ListPartsCommand({ Bucket: bucket, Key: media.s3_key, UploadId: req.params.uploadId }));
  res.json((result.Parts || []).map(part => ({ PartNumber: part.PartNumber, Size: part.Size, ETag: part.ETag })));
}));

app.post('/api/media/:id/multipart/:uploadId/part-url', auth, wrap(async (req, res) => {
  const media = await authorizedMedia(req.user!.sub, req.params.id), partNumber = Number(req.body.partNumber);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) throw Object.assign(new Error('Invalid part number'), { status: 400 });
  const command = new UploadPartCommand({ Bucket: bucket, Key: media.s3_key, UploadId: req.params.uploadId, PartNumber: partNumber });
  res.json({ url: await getSignedUrl(getSigner(req), command, { expiresIn: 900 }), expiresIn: 900 });
}));

app.post('/api/media/:id/complete', auth, wrap(async (req, res) => {
  const media = await authorizedMedia(req.user!.sub, req.params.id);
  await enqueue(media);
  res.json({ mediaId: media.id, status: 'PROCESSING' });
}));

app.post('/api/media/:id/multipart/:uploadId/complete', auth, wrap(async (req, res) => {
  const media = await authorizedMedia(req.user!.sub, req.params.id), parts = req.body.parts;
  if (!Array.isArray(parts) || !parts.length || parts.some((p: any) => !Number.isInteger(p.partNumber) || typeof p.etag !== 'string')) {
    throw Object.assign(new Error('Invalid parts'), { status: 400 });
  }
  await s3.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: media.s3_key, UploadId: req.params.uploadId, MultipartUpload: { Parts: parts.map((p: any) => ({ PartNumber: p.partNumber, ETag: p.etag })) } }));
  await enqueue(media);
  res.json({ mediaId: media.id, status: 'PROCESSING' });
}));

app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(error.status || 500).json({ message: error.message || 'Internal server error' });
});

async function ensureSchema() {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false');

  // Preserve existing workflows during the first upgrade: current trip owners
  // become app admins. This bootstrap only runs while there is at most one
  // admin, so it cannot keep promoting people later.
  await pool.query(
    `UPDATE users SET is_admin = true
     WHERE id IN (SELECT DISTINCT owner_id FROM trips)
       AND (SELECT count(*) FROM users WHERE is_admin) <= 1`
  );

  // A brand-new installation with accounts but no trips still needs an admin.
  await pool.query(
    `UPDATE users SET is_admin = true
     WHERE id = (
       SELECT u.id FROM users u
       LEFT JOIN trips t ON t.owner_id = u.id
       GROUP BY u.id
       ORDER BY (count(t.id) > 0) DESC, u.created_at ASC
       LIMIT 1
     )
     AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin)`
  );
}

async function start() {
  await ensureSchema();
  await producer.connect();
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({
    waitForLeaders: true,
    topics: [
      { topic: 'media-uploaded', numPartitions: 5, replicationFactor: 1 },
      { topic: 'media-uploaded-dlq', numPartitions: 5, replicationFactor: 1 }
    ]
  });
  await admin.disconnect();
  app.listen(4000, '0.0.0.0', () => console.log('TripVault API listening on :4000'));
}

start().catch(error => {
  console.error(error);
  process.exit(1);
});
