// import express from "express";
// import http from "http";
// import cors from "cors";
// import { WebSocketServer, WebSocket } from "ws";
// import { doctor } from "./doctorRoute.js";
// import { patient } from "./patientRoute.js";
// import { initKafka } from "./kafka.js";


// const app = express();
// app.use(express.json());
// app.use(cors());

// // Routes
// app.use("/api", doctor);
// app.use("/api/patient",patient);

// // Create HTTP server
// const server = http.createServer(app);

// // ---- Extend WebSocket type ----
// interface ExtWebSocket extends WebSocket {
//   id?: string;
// }
// await initKafka();

// // Maps to store socket connections
// const connectedDoctors = new Map<string, ExtWebSocket>();
// const connectedPatients = new Map<string, ExtWebSocket>();

// // Create WebSocket server
// const wss = new WebSocketServer({ server });

// wss.on("connection", (socket: ExtWebSocket) => {
//   console.log("🔗 WebSocket client connected");

//   // Assign random socket ID
//   socket.id = Math.random().toString(36).substring(2, 10);

//   // Handle messages
//   socket.on("message", (msg: string | Buffer) => {
//     console.log("Received:", msg.toString());

//     try {
//       const data = JSON.parse(msg.toString());
//       const { type, id, role } = data;

//       if (type === "register" && id && role) {
//         if (
//           role === "MO" ||
//           role === "CHO" ||
//           role === "specialist" ||
//           role === "Emergency"
//         ) {
//           connectedDoctors.set(id, socket);

//           // Send socket ID to the doctor
//           socket.send(
//             JSON.stringify({
//               type: "registered",
//               socketID: socket.id,
//             })
//           );

//           console.log(`Doctor ${id} registered with socket ID ${socket.id}`);
//         } else if (role === "patient") {
//           connectedPatients.set(id, socket);

//           // Send socket ID to the patient
//           socket.send(
//             JSON.stringify({
//               type: "registered",
//               socketID: socket.id,
//             })
//           );

//           console.log(`Patient ${id} registered with socket ID ${socket.id}`);
//         }
//       }
//     } catch (err) {
//       console.error("Error parsing message:", err);
//     }
//   });

//   // Handle disconnect
//   socket.on("close", () => {
//     console.log(" WebSocket disconnected:", socket.id);

//     // Remove from doctor map
//     for (let [doctorID, s] of connectedDoctors.entries()) {
//       if (s.id === socket.id) {
//         connectedDoctors.delete(doctorID);
//         console.log(`Doctor ${doctorID} removed from connection map`);
//         break;
//       }
//     }

//     // Remove from patient map
//     for (let [patientID, s] of connectedPatients.entries()) {
//       if (s.id === socket.id) {
//         connectedPatients.delete(patientID);
//         console.log(`Patient ${patientID} removed from connection map`);
//         break;
//       }
//     }
//   });
// });

// export { wss, connectedDoctors };
// // Start server
// server.listen(5000, () => {
//   console.log("🚀 Server running on port 5000");
// });

import http from "http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";

console.log("Starting WebRTC Signaler Service...");

// --- TypeScript extended WebSocket ---
declare module "ws" {
  interface WebSocket {
    id?: string;
    userID?: string;
    userType?: "doctor" | "patient";
    level?: "CHO" | "MO" | "CIVIL"; // for doctors
  }
}

// --- In-memory maps per doctor type ---
const choDoctors = new Map<string, WebSocket>();
const moDoctors = new Map<string, WebSocket>();
const civilDoctors = new Map<string, WebSocket>();
const patients = new Map<string, WebSocket>();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- Helper to send JSON safely ---
function sendJSON(ws: WebSocket, obj: unknown) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}

// --- Select doctor based on patient preference or fallback ---
function getAvailableDoctor(preferredLevel?: "CHO" | "MO" | "CIVIL"): WebSocket | null {
  const levelMap: Record<string, Map<string, WebSocket>> = {
    CHO: choDoctors,
    MO: moDoctors,
    CIVIL: civilDoctors,
  };

  // 1️⃣ Try preferred level first
  if (preferredLevel) {
    const map = levelMap[preferredLevel];
    if(!map) return null;
    for (const ws of map.values()) if (ws.readyState === ws.OPEN) return ws;
  }

  // 2️⃣ Fallback: any available doctor
  for (const ws of choDoctors.values()) if (ws.readyState === ws.OPEN) return ws;
  for (const ws of moDoctors.values()) if (ws.readyState === ws.OPEN) return ws;
  for (const ws of civilDoctors.values()) if (ws.readyState === ws.OPEN) return ws;

  return null;
}

// --- WebSocket connection handler ---
wss.on("connection", (socket: WebSocket) => {
  socket.id = Math.random().toString(36).slice(2, 10);
  console.log("WS connected:", socket.id);

  sendJSON(socket, { type: "socket-id", socketID: socket.id });

  socket.on("message", (raw) => {
    let data: any;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // --- Registration ---
    if (data.type === "register" && data.id && data.role) {
      socket.userID = data.id;
      socket.userType = data.role === "patient" ? "patient" : "doctor";

      if (socket.userType === "doctor" && data.level) {
        socket.level = data.level; // CHO/MO/CIVIL
        if (data.level === "CHO") choDoctors.set(data.id, socket);
        else if (data.level === "MO") moDoctors.set(data.id, socket);
        else if (data.level === "CIVIL") civilDoctors.set(data.id, socket);
        console.log(`Doctor registered: ${data.id} (${data.level})`);
      } else {
        patients.set(data.id, socket);
        console.log(`Patient registered: ${data.id}`);
      }

      sendJSON(socket, { type: "registered", socketID: socket.id, id: data.id });
      return;
    }

    // --- Patient requests a call ---
    if (data.type === "call-request" && socket.userType === "patient") {
      const patientID = socket.userID!;
      const patientWs = socket;
      const preferredLevel = data.preferredLevel as "CHO" | "MO" | "CIVIL" | undefined;

      const doctorWs = getAvailableDoctor(preferredLevel);
      if (!doctorWs) {
        sendJSON(patientWs, { type: "no-doctor-available" });
        return;
      }

      // Notify doctor
      sendJSON(doctorWs, { type: "incoming-call", fromPatientID: patientID });  
      // Notify patient
      sendJSON(patientWs, { type: "doctor-assigned", doctorID: doctorWs.userID, doctorLevel: doctorWs.level });
    }

    // --- WebRTC signaling messages ---
    if (["offer", "answer", "ice"].includes(data.type)) {
      console.log(`Relaying ${data.type} from ${socket.userID} to ${data.toUserID} and payload size: ${JSON.stringify(data.payload).length}`);
      const targetID = data.toUserID;
      let targetWs: WebSocket | undefined =
        patients.get(targetID) ||
        choDoctors.get(targetID) ||
        moDoctors.get(targetID) ||
        civilDoctors.get(targetID);

      if (targetWs && targetWs.readyState === targetWs.OPEN) {
        console.log(`Found target WS for ${targetID}, relaying message.`);
        sendJSON(targetWs, {
          type: data.type,
          fromUserID: socket.userID,
          payload: data.payload,
        });
      }
    }

    // --- Handover logic ---
    if (data.type === "handover" && socket.userType === "doctor") {
      const patientID = data.patientID;
      const patientWs = patients.get(patientID);
      if (!patientWs) return;

      // Find another available doctor, excluding current one
      let newDoctorWs: WebSocket | null = null;
      for (const ws of choDoctors.values()) if (ws.userID !== socket.userID && ws.readyState === ws.OPEN) { newDoctorWs = ws; break; }
      if (!newDoctorWs) for (const ws of moDoctors.values()) if (ws.userID !== socket.userID && ws.readyState === ws.OPEN) { newDoctorWs = ws; break; }
      if (!newDoctorWs) for (const ws of civilDoctors.values()) if (ws.userID !== socket.userID && ws.readyState === ws.OPEN) { newDoctorWs = ws; break; }

      if (!newDoctorWs) {
        sendJSON(socket, { type: "handover-failed", reason: "No other doctor available" });
        return;
      }

      // Notify new doctor
      sendJSON(newDoctorWs, { type: "incoming-handover", patientID });
      // Notify patient to renegotiate
      sendJSON(patientWs, { type: "renegotiate", newDoctorID: newDoctorWs.userID });
      console.log(`Patient ${patientID} handed over from ${socket.userID} to ${newDoctorWs.userID}`);
    }
  });

  socket.on("close", () => {
    if (socket.userType === "doctor" && socket.userID) {
      choDoctors.delete(socket.userID);
      moDoctors.delete(socket.userID);
      civilDoctors.delete(socket.userID);
    }
    if (socket.userType === "patient" && socket.userID) {
      patients.delete(socket.userID);
    }
    console.log("WS closed:", socket.id);
  });
});

// --- Start server ---
server.listen(5001, () => console.log("Signaler listening on :5001"));
