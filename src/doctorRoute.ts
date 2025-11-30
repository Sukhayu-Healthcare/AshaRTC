    import express from "express";
    import { redis } from "./redis.js"; // Assume redisClient exports a connected Redis client
    import { producer } from "./kafka.js"; // Kafka producer instance
    export const doctor = express.Router();

    const DOCTOR_TTL = 30; // seconds (heartbeat timeout)

    // -----------------------------------------
    // 1. REGISTER / UPDATE DOCTOR AVAILABILITY
    // -----------------------------------------
    doctor.post("/doctor/status", async (req, res) => {
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
    doctor.post("/doctor/heartbeat", async (req, res) => {
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


    // doctorRoute.ts
doctor.post("/call/handover", async (req, res) => {
    try {
      const { doctorID, patientID, currentDoctorSocketID, targetRole, caseType } = req.body;
  
      if (!doctorID || !patientID || !currentDoctorSocketID || !targetRole) {
        return res.status(400).json({ message: "Missing required fields" });
      }
  
      // 1. Get all doctors from redis
      const keys = await redis.keys("doctor:*");
      let availableDoctors = [];
  
      for (const key of keys) {
        const d = await redis.hGetAll(key);
        if (d.status === "online" && d.role === targetRole) {
          availableDoctors.push(d);
        }
      }
  
      if (availableDoctors.length === 0) {
        return res.status(404).json({ message: "No doctor available for handover" });
      }
  
      // Select first available specialist (can apply load balancer here)
      const newDoctor = availableDoctors[0];
  
      // 2. Push handover event to Kafka → signalling server
      await producer.send({
        topic: "call-handover",
        messages: [
          {
            value: JSON.stringify({
              event: "handover-request",
              fromDoctorID: doctorID,
              fromDoctorSocketID: currentDoctorSocketID,
              newDoctorID: newDoctor?.doctorID,
              newDoctorSocketID: newDoctor?.socketID,
              patientID,
              caseType,
            }),
          },
        ],
      });
  
      return res.json({
        message: "Handover request sent",
        assignedDoctor: newDoctor,
      });
  
    } catch (err) {
      console.error("Handover error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  
