    import express from "express";
    import { redis } from "./redis.js"; // Assume redisClient exports a connected Redis client
    export const router = express.Router();

    const DOCTOR_TTL = 30; // seconds (heartbeat timeout)

    // -----------------------------------------
    // 1. REGISTER / UPDATE DOCTOR AVAILABILITY
    // -----------------------------------------
    router.post("/doctor/status", async (req, res) => {
    try {
        const { doctorID, socketID, specialist, status , role } = req.body;

        if (!doctorID || !socketID || !specialist || !status || !role) {
        return res.status(400).json({ message: "Missing required fields" });
        }

        const key = `doctor:${doctorID}`;

        // If doctor is offline → remove entry
        if (status === "offline") {
        await redis.del(key);
        return res.json({ message: "Doctor set to offline & removed from Redis" });
        }

        // Save or update doctor info
        const data = {
        doctorID,
        socketID,
        specialist,
        status,
        role,
        lastSeen: Date.now()
        };

        await redis.hSet(key, data);
        await redis.expire(key, DOCTOR_TTL); // Auto-remove if no heartbeat

        return res.json({ message: "Doctor status updated", data });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
    });

    // -------------------------
    // 2. DOCTOR HEARTBEAT ENDPOINT
    // -------------------------
    router.post("/doctor/heartbeat", async (req, res) => {
    try {
        const { doctorID } = req.body;
        if (!doctorID) {
        return res.status(400).json({ message: "doctorID missing" });
        }

        const key = `doctor:${doctorID}`;
        const exists = await redis.exists(key);

        if (!exists) {
        return res.status(404).json({ message: "Doctor not found in Redis (offline?)" });
        }

        await redis.hSet(key, "lastSeen", Date.now());
        await redis.expire(key, DOCTOR_TTL); // Refresh TTL

        return res.json({ message: "Heartbeat received, status refreshed" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
    });

