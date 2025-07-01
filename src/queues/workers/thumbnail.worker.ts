import { Worker, Job } from 'bullmq';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream } from 'fs';
import { s3 } from '../../api-gateway/utils/storage';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import logger from '../../utils';
import { connection } from '../../lib/redis';
import { pipeline } from 'stream';


const execAsync = promisify(exec);

interface ThumbnailJobData {
    fileId: string;
    key: string;  
    type: 'video' | 'audio';
}

export const thumbnailWorker = new Worker(
    'thumbnail',
    async (job: Job<ThumbnailJobData>) => {
        const { fileId, key, type } = job.data;
        const bucket = process.env.AWS_S3_BUCKET_NAME!;
        const tempDir = os.tmpdir();
        const localPath = path.join(tempDir, path.basename(key));

        try {
            // Step 1: Download original or transcoded file from S3
            const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            await pipeline(object.Body as any, createWriteStream(localPath));

            // Step 2: Process based on media type
            if (type === 'video') {
                const thumbnailPath = localPath.replace(/\.\w+$/, '_thumb.jpg');
                const command = `ffmpeg -ss 10 -i "${localPath}" -frames:v 1 -q:v 2 "${thumbnailPath}"`;
                await execAsync(command);

                // Upload thumbnail to S3
                const buffer = await fs.readFile(thumbnailPath);
                const thumbnailKey = `thumbnails/${fileId}/thumb.jpg`;
                
                const s3Url = `https://${bucket}.s3.amazonaws.com/${thumbnailKey}`;
                logger.info(`Thumbnail uploaded: ${s3Url}`);

                await s3.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: thumbnailKey,
                    Body: buffer,
                    ContentType: 'image/jpeg',
                }));

            } else if (type === 'audio') {
                const waveformPath = localPath.replace(/\.\w+$/, '_waveform.png');
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
            }



            return { status: 'done', fileId };

        } catch (err) {
            logger.error({ err }, 'Thumbnail job failed');
            throw err;
        } finally {
            await fs.rm(localPath, { force: true });
        }
    },
    {
        connection,
        concurrency: 2,
    }
);


