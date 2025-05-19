import express, { Request, Response } from 'express';
import { uploadFiles } from '../middleware/upload';
import { IncomingMessage } from 'http';

const router = express.Router();

router.post('/upload', async (req: Request, res: Response) => {
  try {
    const result = await uploadFiles(req as unknown as IncomingMessage);
    res.status(200).json({ success: true, files: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
