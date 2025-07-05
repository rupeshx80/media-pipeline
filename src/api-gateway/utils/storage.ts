import { S3Client } from "@aws-sdk/client-s3";

// console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY);
// console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_KEY);
// console.log("AWS_REGION loaded:", process.env.AWS_REGION);


export const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_SECRET_KEY!,
  },
});