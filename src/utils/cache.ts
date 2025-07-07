import path from 'path';
import fs from 'fs/promises';
import { createWriteStream, existsSync } from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import os from 'os';
import { s3 } from '../api-gateway/utils/storage';

const SHARED_CACHE_DIR = path.join(os.tmpdir(), 's3-cache'); 

export async function getCachedFilePath(s3Key: string): Promise<string> {
  await fs.mkdir(SHARED_CACHE_DIR, { recursive: true });

  const hash = crypto.createHash('sha256').update(s3Key).digest('hex');
  const filePath = path.join(SHARED_CACHE_DIR, `${hash}${path.extname(s3Key)}`);

  if (existsSync(filePath)) {
    return filePath; 
  }

  const bucket = process.env.AWS_S3_BUCKET_NAME!;
  const s3Object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));

  const writeStream = createWriteStream(filePath);
  await pipeline(s3Object.Body as NodeJS.ReadableStream, writeStream);

  return filePath;
}
