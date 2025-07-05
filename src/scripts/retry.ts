import prisma from '../config/db';
import { retryFailedJobs } from '../jobs/cron/daily.jobs';

(async () => {
  await prisma.$connect();
  await retryFailedJobs();
  await prisma.$disconnect();
})();
