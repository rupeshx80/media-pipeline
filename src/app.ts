import './jobs/cron/daily.jobs';
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import path from 'path';
import { transcodeQueue,thumbnailQueue, previewQueue } from './lib/bullmq-client';

import uploadRouter from "./api-gateway/routes/upload.route"

const app = express();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'test.html'));

});

app.use(helmet());
app.use(compression());
app.use(express.static(path.join(__dirname, '..', 'public')));

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(transcodeQueue),
    new BullMQAdapter(thumbnailQueue),   
    new BullMQAdapter(previewQueue),     
  ],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());

app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true,
}));

app.use(express.json({ limit: "100mb" }));


app.use("/api", uploadRouter);


export default app;