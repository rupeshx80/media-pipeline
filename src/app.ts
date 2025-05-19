import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import dotenv from 'dotenv';
dotenv.config();



import uploadRouter from "./api-gateway/routes/upload.route"

const app = express();

app.use(helmet());
app.use(compression());

app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true,
}));

app.use(express.json({ limit: "100mb" }));


app.use("/api", uploadRouter);

export default app;