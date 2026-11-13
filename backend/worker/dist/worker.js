"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const kafkajs_1 = require("kafkajs");
const pg_1 = require("pg");
const client_s3_1 = require("@aws-sdk/client-s3");
const sharp_1 = __importDefault(require("sharp"));
const kafka = new kafkajs_1.Kafka({ clientId: 'tripvault-worker', brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',') });
const consumer = kafka.consumer({ groupId: 'tripvault-processors' });
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const s3 = new client_s3_1.S3Client({ region: process.env.S3_REGION || 'us-east-1', endpoint: process.env.S3_ENDPOINT, forcePathStyle: !!process.env.S3_ENDPOINT, credentials: process.env.S3_ACCESS_KEY ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY || '' } : undefined });
const original = process.env.S3_ORIGINALS_BUCKET || 'tripvault-originals', processed = process.env.S3_PROCESSED_BUCKET || 'tripvault-processed';
async function bytes(body) { const chunks = []; for await (const chunk of body)
    chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); }
async function scanHook(_buffer) { }
async function processMedia(message) {
    const { mediaId, s3Key } = message;
    const { rows } = await pool.query('SELECT mime_type FROM media WHERE id=$1', [mediaId]);
    if (!rows[0])
        return;
    const mimeType = rows[0].mime_type;
    const kind = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'video';
    if (kind === 'image') {
        const input = await bytes((await s3.send(new client_s3_1.GetObjectCommand({ Bucket: original, Key: s3Key }))).Body);
        await scanHook(input);
        const thumb = await (0, sharp_1.default)(input, { limitInputPixels: 80_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        const key = `${mediaId}/preview.webp`;
        await s3.send(new client_s3_1.PutObjectCommand({ Bucket: processed, Key: key, Body: thumb, ContentType: 'image/webp' }));
        await pool.query("UPDATE media SET processed_key=$2,status='READY',updated_at=now() WHERE id=$1", [mediaId, key]);
        return;
    }
    // Video/audio: verify the object was uploaded, then serve the original directly.
    // This unblocks playback for trips now. Replace this branch with an ffmpeg/HLS
    // transcoder + poster-frame generator when the media pipeline is configured.
    await s3.send(new client_s3_1.HeadObjectCommand({ Bucket: original, Key: s3Key }));
    await pool.query("UPDATE media SET processed_key=NULL,status='READY',failure_code=NULL,updated_at=now() WHERE id=$1", [mediaId]);
}
async function main() {
    await consumer.connect();
    await consumer.subscribe({ topic: 'media-uploaded', fromBeginning: false });
    await consumer.run({ eachMessage: async ({ message }) => {
            if (!message.value)
                return;
            const event = JSON.parse(message.value.toString());
            try {
                await processMedia(event);
            }
            catch (error) {
                const text = error instanceof Error ? error.message : 'unknown';
                console.error({ mediaId: event.mediaId, error: text });
                await pool.query("UPDATE media SET status='FAILED',failure_code=$2,updated_at=now() WHERE id=$1", [event.mediaId, text.slice(0, 120)]);
            }
        } });
}
main().catch(error => { console.error(error); process.exit(1); });
