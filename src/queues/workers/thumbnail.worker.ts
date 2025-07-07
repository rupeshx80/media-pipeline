import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream } from 'fs';
import { s3 } from '../../api-gateway/utils/storage';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import logger from '../../utils/logger';
import { connection } from '../../lib/redis';
import { pipeline } from 'stream/promises';
import { getCachedFilePath } from '../../utils/cache';

const execAsync = promisify(exec);

interface ThumbnailJobData {
    fileId: string;
    key: string;
    type: 'video' | 'audio';
}

const processor = async (job: Job<ThumbnailJobData>) => {
    const { fileId, key, type } = job.data;

    logger.info({ fileId, key, type }, 'Thumbnail worker received job');

    const bucket = process.env.AWS_S3_BUCKET_NAME!;

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-'));


    try {
        const localPath = await getCachedFilePath(key);

        if (type === 'video') {


            const thumbnailPath = path.join(tmpDir, 'thumb.jpg');

           const command = `ffmpeg -analyzeduration 100M -probesize 100M -i "${localPath}" -ss 00:00:01.000 -t 00:00:01.000 -vf "fps=1,scale=320:-1,format=yuv420p" -q:v 2 -y "${thumbnailPath}"`;
           
            await execAsync(command);

            const buffer = await fs.readFile(thumbnailPath);
            const thumbnailKey = `thumbnails/${fileId}/thumb.jpg`;


            await s3.send(new PutObjectCommand({
                Bucket: bucket,
                Key: thumbnailKey,
                Body: buffer,
                ContentType: 'image/jpeg',
            }));

            logger.info({ s3Key: thumbnailKey }, 'Thumbnail uploaded to S3');



        } else if (type === 'audio') {
            
            const waveformPath = path.join(tmpDir, 'waveform.png');
            const command = `ffmpeg -i "${localPath}" -filter_complex "aformat=channel_layouts=mono,showwavespic=s=640x120" -frames:v 1 "${waveformPath}"`;
            await execAsync(command);

            const buffer = await fs.readFile(waveformPath);
            const waveformKey = `waveforms/${fileId}/waveform.png`;

            await s3.send(new PutObjectCommand({
                Bucket: bucket,
                Key: waveformKey,
                Body: buffer,
                ContentType: 'image/png',
            }));
            
            const s3Url = `https://${bucket}.s3.amazonaws.com/${waveformKey}`;
            logger.info(`Waveform uploaded : ${s3Url}`);

        }

        return { status: 'done', fileId };

    } catch (err) {
        logger.error({ err }, 'Thumbnail job failed');
        throw err;
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });

    }
}

export const thumbnailWorker = new Worker<ThumbnailJobData>(
    'thumbnail',
    async (job) => {
        if (job.name === 'generate-thumbnail') {
            return processor(job);
        } else {
            logger.warn(`Unknown job name: ${job.name}`);
            throw new Error(`Unknown job name: ${job.name}`);
        }

    },
    {
        connection,
        concurrency: 2,
    }
);

thumbnailWorker.on('completed', (job) => {
    logger.info(`Thumbnail job completed: ${job.id}`);
});

thumbnailWorker.on('failed', (job, err) => {
    const jobId = job ? job.id : 'unknown';
    logger.error({ err }, `Thumbnail job failed: ${jobId}`);
});

thumbnailWorker.on('error', (err) => {
    logger.error({ err }, 'Worker error');
});

