import cron from 'node-cron';
import { transcodeQueue , thumbnailQueue, previewQueue} from '../../libs/bullmq-client';
import logger from '../../utils';
import { ListObjectsV2Command,DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../../api-gateway/utils/storage';
import prisma from '../../config/db';

const BUCKET = process.env.AWS_S3_BUCKET_NAME!;
const PREFIX = 'uploads/';
const AGE_LIMIT_MS = 24 * 60 * 60 * 1000; //24 hours

export const retryFailedJobs = async () => {
  logger.info('Retrying failed jobs...');

  for (const queue of [transcodeQueue, thumbnailQueue, previewQueue]) {
    const failedJobs = await queue.getFailed();

    for (const job of failedJobs) {
      try {
        await job.retry();
        logger.info(`Retried job: ${job.name} (${job.id}) in ${queue.name}`);
      } catch (err) {
        logger.error({ err }, `Failed to retry job ${job.id} in ${queue.name}`);
      }

      
      const updatedJob = await queue.getJob(job.id);
      if ((updatedJob?.attemptsMade ?? 0) >= 2) {
        await updatedJob?.remove();
        logger.info(`Removed permanently failed job: ${job.name} (${job.id}) from ${queue.name}`);
      }
    }
  }

  logger.info('Retry & cleanup of failed jobs completed.');
};


const cleanupOrphanS3Files = async () => {
  logger.info("Starting orphan S3 file cleanup...");

  const listResponse = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: PREFIX,
  }));

  const now = Date.now();
  const objects = listResponse.Contents || [];

  for (const obj of objects) {
    const key = obj.Key!;
    const lastModified = obj.LastModified?.getTime() || 0;
    const age = now - lastModified;

    if (age < AGE_LIMIT_MS) continue;

    const dbRecord = await prisma.file.findFirst({ where: { key } });
    if (dbRecord) continue;

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    logger.info(`Deleted orphaned S3 file: ${key}`);
  }

  logger.info("S3 orphan cleanup completed.");
};

cron.schedule('0 2 * * *', async () => {
  logger.info('Running daily maintenance jobs...');
  try {
    await prisma.$connect();
    await retryFailedJobs();
    await cleanupOrphanS3Files();
  } catch (err) {
    logger.error({ err }, 'Daily cron job failed');
  } finally {
    await prisma.$disconnect();
    logger.info('Daily maintenance jobs done');
  }
});