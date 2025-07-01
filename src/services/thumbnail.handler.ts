import { thumbnailQueue } from '../libs/bullmq-client';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils';

export const handlePostUpload = async (files: any[]) => {
  for (const file of files) {
    const { id: fileId, key, mimetype } = file;
     if (!mimetype || !key) {
    logger.warn('Skipping file due to missing key or mimetype:', file);
    continue;
  }

    if (mimetype.startsWith('video')) {
      await thumbnailQueue.add('generate-thumbnail', {
        fileId,
        key,
        type: 'video',
      });
    }

    if (mimetype.startsWith('audio')) {
      await thumbnailQueue.add('generate-thumbnail', {
        fileId,
        key,
        type: 'audio',
      });
    }

  }
};
