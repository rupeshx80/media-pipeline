import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";

// import { sessionMiddleware } from "./config/session";
// import { contextMiddleware } from "./middlewares/context";

// import uploadRouter from "./routes/upload.route"

const app = express();

app.use(helmet());
app.use(compression());

// app.use(sessionMiddleware); 
// app.use(contextMiddleware);

app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true,
}));

app.use(express.json({ limit: "50mb" }));


// app.use("/api/v3/s3uploader", uploadRouter);

export default app;