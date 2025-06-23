import formidable from "formidable";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../utils/storage";
import prisma from "../../config/db";
import { readFile, unlink } from "fs/promises";
import { v4 as uuid } from "uuid";
import { IncomingMessage } from "http";
import logger from "../../utils";
import { transcodeQueue } from "../../libs/bullmq-client"; 

interface UploadTypes {
  key: string;
  url: string;
  fileType: string;
  originalName: string;
  size: number;
  duration?: number;
  width?: number;
  height?: number;
}

const VALID_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac',
  'application/pdf', 'text/plain', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

function getFileSizeLimit(mimeType: string): number {
  if (mimeType.startsWith('video/')) return 500 * 1024 * 1024;
  if (mimeType.startsWith('audio/')) return 100 * 1024 * 1024;
  if (mimeType.startsWith('image/')) return 25 * 1024 * 1024;
  return 50 * 1024 * 1024;
}

export async function uploadFiles(req: IncomingMessage): Promise<UploadTypes[]> {
  const form = formidable({
    maxFileSize: 500 * 1024 * 1024,
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
      const results: UploadTypes[] = [];

      const bucket = process.env.AWS_S3_BUCKET_NAME;
      const region = process.env.AWS_REGION;
      if (!bucket || !region) return reject(new Error('Missing AWS S3 configuration'));

      for (const file of uploadedFiles) {
        if (!file?.mimetype || !VALID_MIME_TYPES.has(file.mimetype)) continue;

        const sizeLimit = getFileSizeLimit(file.mimetype);
        if (file.size > sizeLimit) {
          logger.warn({
            filename: file.originalFilename,
            mimetype: file.mimetype,
            size: file.size,
            limit: sizeLimit
          }, "File rejected: exceeds type-specific size limit");
          continue;
        }

        try {
          const buffer = await readFile(file.filepath);
          const sanitizedFilename = (file.originalFilename || 'unnamed').replace(/[^a-zA-Z0-9._-]/g, '_');

          let folder = 'documents';
          if (file.mimetype.startsWith('image/')) folder = 'images';
          if (file.mimetype.startsWith('video/')) folder = 'videos';
          if (file.mimetype.startsWith('audio/')) folder = 'audio';

          const key = `uploads/${folder}/${uuid()}-${sanitizedFilename}`;
          logger.info({ key, mimetype: file.mimetype }, "Processing upload");

          const mediaMetadata: Record<string, any> = {};

          const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
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
            duration: null,
            width: null,
            height: null
          };

          const record = await prisma.file.create({ data: fileData });

          if (file.mimetype.startsWith('video/')) {
            await transcodeQueue.add("transcode-job", {
              fileId: record.id,
              key: record.key,
              url: record.url
            });

            logger.info({ fileId: record.id }, 'Transcode job added to queue');
          }

          results.push(record as UploadTypes);
        } catch (error) {
          logger.error({ error, file: file.originalFilename }, 'Error processing file');
        } finally {
          try {
            await unlink(file.filepath);
          } catch (err) {
            logger.warn({ err, filepath: file.filepath }, 'Failed to delete temporary file');
          }
        }
      }

      if (results.length === 0) {
        return reject(new Error('No valid files were uploaded'));
      }

      resolve(results);
    });
  });
}
