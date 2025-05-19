import { PrismaClient } from "../generated/prisma"; 

const prisma = new PrismaClient({
  log: ['query', 'error', 'info', 'warn']
})

export default prisma;
