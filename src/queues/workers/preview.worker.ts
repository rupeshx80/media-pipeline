import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../../api-gateway/utils/storage';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import prisma from "../../config/db";
import { connection } from '../../lib/redis';
import logger from '../../utils/logger'
import { v4 as uuid } from 'uuid';
import { getCachedFilePath } from '../../utils/cache';

const execAsync = promisify(exec);

export const previewWorker = new Worker('preview', async (job: Job) => {
  const { fileId, key, url, startTime, duration } = job.data;

  logger.info({ fileId, key }, '🎬 Preview job started');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-'));
  const outputPath = path.join(tmpDir, 'preview.mp4');

  try {

    const inputPath = await getCachedFilePath(key);

    await execAsync(`ffmpeg -ss ${startTime} -t ${duration} -i "${inputPath}" -c:v libx264 -c:a aac "${outputPath}"`);

    const previewKey = `previews/${uuid()}-preview.mp4`;

    const previewBuffer = await fs.readFile(outputPath);

    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: previewKey,
      Body: previewBuffer,
      ContentType: 'video/mp4',
    }));

    await prisma.file.update({
      where: { id: fileId },
      data: {
        previewUrl: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${previewKey}`
      }
    });

    logger.info({ previewKey, fileId }, 'Preview uploaded to S3 and DB updated');
  } catch (error) {
    logger.error({ error, fileId }, 'Failed to generate preview');
    throw error;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}, {
  connection
});
console.log('Preview Worker is running on queue: preview');


