import { Queue } from 'bullmq';
import { connection } from './redis';

//all queues setup perfectly
export const transcodeQueue = new Queue('transcode', { connection });
export const thumbnailQueue = new Queue('thumbnail', { connection });
export const previewQueue = new Queue('preview', { connection }); 