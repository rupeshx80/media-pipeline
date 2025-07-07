import { Worker, Job } from 'bullmq';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import os from 'os';
import { connection } from '../../lib/redis';
import { s3 } from '../../api-gateway/utils/storage';
import logger from '../../utils/logger';
import { Request, Response } from 'express';
import { getCachedFilePath } from '../../utils/cache';


const execAsync = promisify(exec);

const OUTPUT_FORMATS = [
    { suffix: '720p.mp4', size: '1280x720' },
    { suffix: '480p.mp4', size: '854x480' }
];

interface TranscodeJobData {
    fileId: string;
    url: string;
    key: string;
    originalName: string;
}

export const transcodeWorker = new Worker(
    'transcode',
    async (job: Job<TranscodeJobData>) => {
        const { fileId, url, key } = job.data;
        const bucket = process.env.AWS_S3_BUCKET_NAME!;

        logger.info({ jobId: job.id, fileId, url }, 'Starting transcode job');

        // const originalFilename = path.basename(url);
        const tempDir = os.tmpdir();
        const outputDir = path.join(tempDir, fileId);
        const outputFiles: string[] = [];

        let inputPath: string | undefined;
        try {

            logger.info(`Downloading ${key} from S3...`);

            inputPath = await getCachedFilePath(key);

            logger.info(`Downloaded to ${inputPath}`);

            await fs.mkdir(outputDir, { recursive: true });

            for (const format of OUTPUT_FORMATS) {
                const outputFilename = `${fileId}-${format.suffix}`;
                const outputPath = path.join(outputDir, outputFilename);

                const command = `ffmpeg -y -i "${inputPath}" -vf scale=${format.size} -c:v libx264 -preset ultrafast -crf 28 -c:a aac "${outputPath}"`;

                logger.info({ command }, 'Running FFmpeg');
                await execAsync(command);

                outputFiles.push(outputPath);
            }

            logger.info({ outputFiles }, 'Transcoding complete');

            for (const filePath of outputFiles) {
                const buffer = await fs.readFile(filePath);
                const filename = path.basename(filePath);
                const originalName = job.data.originalName || 'unnamed';
                const sanitizedOriginalName = originalName.replace(/\s+/g, '-');
                const transcodedKey = `transcoded/${fileId}-${sanitizedOriginalName}/${filename}`;


                await s3.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: transcodedKey,
                    Body: buffer,
                    ContentType: 'video/mp4',
                }));

                logger.info(`Uploaded ${filename} to S3 as ${transcodedKey}`);
            }

            return { status: 'success', fileId };
        } catch (err) {
            logger.error({ err, jobId: job.id }, 'Transcode job failed');
            throw err;
        } finally {
            try {
                if (inputPath) {
                    await fs.unlink(inputPath);
                }
                for (const file of outputFiles) {
                    await fs.unlink(file);
                }
                await fs.rm(outputDir, { recursive: true, force: true });
                logger.info(`Cleaned up temp files for job ${job.id}`);
            } catch (cleanupErr) {
                logger.warn({ cleanupErr, fileId }, 'Cleanup failed');
            }
        }
    },
    {
        connection,
        concurrency: 2,
    }
);

export const deleteOriginalVideo = async (req: Request, res: Response): Promise<any> => {
    const { key } = req.body;
    const bucket = process.env.AWS_S3_BUCKET_NAME!;

    if (!key || typeof key !== 'string') {
        logger.warn('Missing or invalid `key` in request body');
        return res.status(400).json({ error: 'Invalid or missing `key` in body' });
    }

    try {
        await s3.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
        }));

        logger.info(`Deleted ${key} from S3`);
        res.json({ message: `Deleted ${key} from S3` });
    } catch (err) {
        logger.error({ err, key }, 'Failed to delete file from S3');
        res.status(500).json({ error: 'Failed to delete from S3' });
    }
};