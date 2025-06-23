import { Queue } from 'bullmq';
import { connection } from '../lib/redis';

export const mediaQueue = new Queue('media-processing', { connection });
