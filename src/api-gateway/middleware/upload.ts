import formidable from "formidable";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../utils/storage";
import prisma from "../../config/db";
import { readFile, unlink } from "fs/promises";
import { v4 as uuid } from "uuid";
import { IncomingMessage } from "http";
import logger from "../../utils";

interface User {
  id: string;
}

interface UploadTypes {
  key: string;
  url: string;
  fileType: string;
  originalName: string;
  size: number;
  user: User;
}

const VALID_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

export async function uploadFiles(
  req: IncomingMessage,
  user: User
): Promise<UploadTypes[]> {

  const form = formidable({
    maxFileSize: 10 * 1024 * 1024, //10 MB
    multiples: true,
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, async (err, fields, files) => {

      if (err) return reject(new Error(`File parse error: ${err.message}`));
      if (!files.file) return reject(new Error('No files were uploaded'));

      const uploadedFiles = Array.isArray(files.file) ? files.file : [files.file];
      const results: UploadTypes[] = [];

      for (const file of uploadedFiles) {
        if (!file) continue;

        if (!VALID_MIME_TYPES.has(file.mimetype || '')) {
          continue;
        }

        try {
          const buffer = await readFile(file.filepath);
          const sanitizedFilename = (file.originalFilename || 'unnamed').replace(/[^a-zA-Z0-9._-]/g, '_');
          const key = `uploads/${user.id}/${uuid()}-${sanitizedFilename}`;
          logger.info({ key }, "S3 KEY")

          const bucket = process.env.AWS_S3_BUCKET_NAME;
          logger.info({ bucket }, "Bucket")
          const region = process.env.AWS_REGION;
          if (!bucket || !region) throw new Error('Missing AWS S3 configuration');

          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: buffer,
              ContentType: file.mimetype || 'application/octet-stream',
              ContentDisposition: `attachment; filename="${sanitizedFilename}"`,
            })
          );

          const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

          const record = await prisma.file.create({
            data: {
              key,
              url,
              fileType: file.mimetype || 'application/octet-stream',
              originalName: file.originalFilename || 'unnamed',
              size: file.size,
              user: { connect: { id: user.id } },
            },
            include: { user: true },
          });

          results.push(record as UploadTypes);

        } catch (error) {
          console.error('Error processing file:', error);
        } finally {
          try {
            await unlink(file.filepath);
          } catch {
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