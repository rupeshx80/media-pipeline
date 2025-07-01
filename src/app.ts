import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import dotenv from 'dotenv';
dotenv.config();
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { transcodeQueue } from './libs/bullmq-client';


import uploadRouter from "./api-gateway/routes/upload.route"

const app = express();

app.use(helmet());
app.use(compression());

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(transcodeQueue)],
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