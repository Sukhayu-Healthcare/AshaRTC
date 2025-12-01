import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { doctor } from "./doctorRoute.js";
import { patient } from "./patientRoute.js";
import { initKafka } from "./kafka.js";


const app = express();
app.use(express.json());
app.use(cors());

// Routes
app.use("/api", doctor);
app.use("/api/patient",patient);

// Create HTTP server
const server = http.createServer(app);

// ---- Extend WebSocket type ----
interface ExtWebSocket extends WebSocket {
  id?: string;
}
await initKafka();

// Maps to store socket connections
const connectedDoctors = new Map<string, ExtWebSocket>();
const connectedPatients = new Map<string, ExtWebSocket>();

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (socket: ExtWebSocket) => {
  console.log("🔗 WebSocket client connected");

  // Assign random socket ID
  socket.id = Math.random().toString(36).substring(2, 10);

  // Handle messages
  socket.on("message", (msg: string | Buffer) => {
    console.log("Received:", msg.toString());

    try {
      const data = JSON.parse(msg.toString());
      const { type, id, role } = data;

      if (type === "register" && id && role) {
        if (
          role === "MO" ||
          role === "CHO" ||
          role === "specialist" ||
          role === "Emergency"
        ) {
          connectedDoctors.set(id, socket);

          // Send socket ID to the doctor
          socket.send(
            JSON.stringify({
              type: "registered",
              socketID: socket.id,
            })
          );

          console.log(`Doctor ${id} registered with socket ID ${socket.id}`);
        } else if (role === "patient") {
          connectedPatients.set(id, socket);

          // Send socket ID to the patient
          socket.send(
            JSON.stringify({
              type: "registered",
              socketID: socket.id,
            })
          );

          console.log(`Patient ${id} registered with socket ID ${socket.id}`);
        }
      }
    } catch (err) {
      console.error("Error parsing message:", err);
    }
  });

  // Handle disconnect
  socket.on("close", () => {
    console.log(" WebSocket disconnected:", socket.id);

    // Remove from doctor map
    for (let [doctorID, s] of connectedDoctors.entries()) {
      if (s.id === socket.id) {
        connectedDoctors.delete(doctorID);
        console.log(`Doctor ${doctorID} removed from connection map`);
        break;
      }
    }

    // Remove from patient map
    for (let [patientID, s] of connectedPatients.entries()) {
      if (s.id === socket.id) {
        connectedPatients.delete(patientID);
        console.log(`Patient ${patientID} removed from connection map`);
        break;
      }
    }
  });
});

export { wss, connectedDoctors };


// Start server
server.listen(5000, () => {
  console.log("🚀 Server running on port 5000");
});
