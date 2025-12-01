import express from "express";
import { redis } from "./redis.js";
import { producer } from "./kafka.js"; // Kafka producer instance

export const patient = express.Router();

// GET ALL DOCTORS KEYS
async function getAllDoctorsFromRedis() {
  const keys = await redis.keys("doctor:*");
  const doctors = [];

  for (const key of keys) {
    const data = await redis.hGetAll(key);
    console.log("Doctor data from Redis:", data);
    if (data && Object.keys(data).length > 0) {
      doctors.push(data);
    }
  }
  return doctors;
}

/**
 * Patient search endpoint:
 * patientID  
 * caseType    → "normal", "emergency"
 * role        → doctor role needed (MO, CHO, specialist)
 */
patient.post("/patient/find-doctor", async (req, res) => {
  try {
    const { patientID, caseType, role, patientSocketID } = req.body;

    if (!patientID || !caseType || !role || !patientSocketID) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // STEP 1 → Get all doctors from Redis
    const doctors = await getAllDoctorsFromRedis();

    // STEP 2 → Filter available doctors
    const availableDoctors = doctors.filter(
      (d) => d.status === "ONLINE" && d.role === role
    );

    if (availableDoctors.length === 0) {
      return res.status(404).json({ message: "No available doctor found" });
    }

    // STEP 3 → Select doctor
    let selectedDoctor;

    if (caseType === "emergency") {
      // Emergency: pick ANY emergency-capable doctor
      selectedDoctor = availableDoctors[0];
    } else {
      // Normal: pick the first available doctor with lowest load (TODO add load system)
      selectedDoctor = availableDoctors[0];
    }

    const doctorSocketID = selectedDoctor?.socketID;

    // STEP 4 → Push to Kafka (doctor + patient pairing event)
    await producer.send({
      topic: "call-requests",
      messages: [
        {
          value: JSON.stringify({
            event: "connect-patient-to-doctor",
            patientID,
            patientSocketID,
            doctorID: selectedDoctor?.doctorID,
            doctorSocketID: doctorSocketID,
            role,
            caseType,
            timestamp: Date.now(),
          }),
        },
      ],
    });

    return res.json({
      message: "Doctor assigned",
      doctor: {
        doctorID: selectedDoctor?.doctorID,
        specialist: selectedDoctor?.specialist,
        role: selectedDoctor?.role,
        socketID: selectedDoctor?.socketID,
      },
    });
  } catch (err) {
    console.error("Error in find-doctor:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});
