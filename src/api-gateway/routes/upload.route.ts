import express, { Request, Response } from 'express';
import { uploadFiles } from '../middleware/upload';
import { IncomingMessage } from 'http';
import { deleteOriginalVideo } from '../../queues/workers/transcode.worker';
import { handlePostUpload } from '../../services/thumbnail.handler';
import logger from '../../utils';

const router = express.Router();

router.post('/upload', async (req: Request, res: Response) => {
  try {
    const result = await uploadFiles(req as unknown as IncomingMessage);

    await handlePostUpload(result);

    logger.info({ fileCount: result.length }, 'Thumbnail uploaded successful');

    res.status(200).json({ success: true, files: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});


router.post('/delete', deleteOriginalVideo)

export default router;
