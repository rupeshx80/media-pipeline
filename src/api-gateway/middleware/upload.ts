import formidable from "formidable";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../utils/storage";
import prisma from "../../config/db";
import { unlink } from "fs/promises";
import { createReadStream as createReadStreamSync } from "fs";
import { v4 as uuid } from "uuid";
import { IncomingMessage } from "http";
import logger from "../../utils/logger";
import { transcodeQueue, previewQueue } from "../../lib/bullmq-client";

interface UploadTypes {
  key: string;
  url: string;
  fileType: string;
  originalName: string;
  mimetype: string;
  size: number;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
}

const VALID_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/mp4',
  'application/pdf', 'text/plain', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

function getFileSizeLimit(mimeType: string): number {
  if (mimeType.startsWith('video/')) return 500 * 1024 * 1024;  
  if (mimeType.startsWith('audio/')) return 100 * 1024 * 1024;
  if (mimeType.startsWith('image/')) return 25 * 1024 * 1024;
  return 50 * 1024 * 1024;
}

async function processFileUpload(file: formidable.File, bucket: string, region: string): Promise<UploadTypes | null> {
  if (!file?.mimetype || !VALID_MIME_TYPES.has(file.mimetype)) {
    logger.warn({ mimetype: file.mimetype }, "File rejected: invalid MIME type");
    return null;
  }

  const sizeLimit = getFileSizeLimit(file.mimetype);
  if (file.size > sizeLimit) {
    logger.warn({
      filename: file.originalFilename,
      mimetype: file.mimetype,
      size: file.size,
      limit: sizeLimit
    }, "File rejected: exceeds type-specific size limit");
    return null;
  }

  try {
    const sanitizedFilename = (file.originalFilename || 'unnamed').replace(/[^a-zA-Z0-9._-]/g, '_');

    let folder = 'documents';
    if (file.mimetype.startsWith('image/')) folder = 'images';
    if (file.mimetype.startsWith('video/')) folder = 'videos';
    if (file.mimetype.startsWith('audio/')) folder = 'audio';

    const key = `uploads/${folder}/${uuid()}-${sanitizedFilename}`;
    logger.info({ key, mimetype: file.mimetype }, "Processing upload");

    const fileStream = createReadStreamSync(file.filepath);
    
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: file.mimetype,
      ContentDisposition: `attachment; filename="${sanitizedFilename}"`,
      Metadata: {
        originalName: sanitizedFilename
      }
    });

    await s3.send(command);

    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    const fileData = {
      key,
      url,
      fileType: file.mimetype,
      originalName: file.originalFilename || 'unnamed',
      size: file.size,
      duration: null as number | null,
      width: null as number | null,
      height: null as number | null
    };

    const record = await prisma.file.create({ data: fileData });

       
    if (file.mimetype.startsWith('video/')) {
      const jobPromises = [
        transcodeQueue.add("transcode-job", {
          fileId: record.id,
          key: record.key,
          url: record.url,
          originalName: record.originalName
        }),
        previewQueue.add("preview-job", {
          fileId: record.id,
          key: record.key,
          url: record.url,
          startTime: 3,
          duration: 5
        })
      ];

      await Promise.all(jobPromises);
      logger.info({ fileId: record.id }, 'Transcode and preview jobs added to queue');
    }

    return {
      ...record,
      fileType: file.mimetype,
      mimetype: file.mimetype,
    };

  } catch (error) {
    logger.error({ error, file: file.originalFilename }, 'Error processing file');
    return null;
  } finally {
    try {
      await unlink(file.filepath);
    } catch (err) {
      logger.warn({ err, filepath: file.filepath }, 'Failed to delete temporary file');
    }
  }
}

export async function uploadFiles(req: IncomingMessage): Promise<UploadTypes[]> {
  
  const form = formidable({
    maxFileSize: 500 * 1024 * 1024,  //500MB file limit.
    multiples: true,
    keepExtensions: true,
    filter: (part) => {
      if (!part.mimetype) return false;
      if (!VALID_MIME_TYPES.has(part.mimetype)) {
        logger.warn({ mimetype: part.mimetype }, "File rejected: invalid MIME type");
        return false;
      }
      return true;
    }
  });

  return new Promise((resolve, reject) => {
    form.parse(req, async (err, fields, files) => {
      if (err) return reject(new Error(`File parse error: ${err.message}`));
      if (!files.file) return reject(new Error('No files were uploaded'));

      const uploadedFiles = Array.isArray(files.file) ? files.file : [files.file];

      const bucket = process.env.AWS_S3_BUCKET_NAME;
      const region = process.env.AWS_REGION;
      if (!bucket || !region) return reject(new Error('Missing AWS S3 configuration'));

      if (!(prisma as any)._isConnected) {
        await prisma.$connect();
      }

      try {
        const uploadPromises = uploadedFiles.map((file: formidable.File) => 
          processFileUpload(file, bucket, region)
        );

        const uploadResults = await Promise.all(uploadPromises);
        
        const results = uploadResults.filter((result): result is UploadTypes => result !== null);

        if (results.length === 0) {
          return reject(new Error('No valid files were uploaded'));
        }

        resolve(results);

      } catch (error) {
        logger.error({ error }, 'Error in parallel upload processing');
        reject(error);
      }
    });
  });
}