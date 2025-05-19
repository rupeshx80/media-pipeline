// server.ts
import express from "express";
import app from "./app";
import prisma from "./config/db";

const PORT = process.env.PORT ?? 4000;

async function main() {
    try {
        await prisma.$connect();
        console.log("Connected to Postgres!");


        app.listen(PORT, () => {
            console.log(`Main server running on PORT: ${PORT}`);
        });


    } catch (error) {
        console.error("Initialization failed:", error);
        process.exit(1);
    }
}

main();
