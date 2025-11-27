import { PrismaClient } from "../generated/prisma/client";
import type { PrismaClient as PrismaClientType } from "../generated/prisma/client";

const PrismaClientSingleton = PrismaClient as unknown as { new (): PrismaClientType };

export const prisma = new PrismaClientSingleton();
export default prisma;