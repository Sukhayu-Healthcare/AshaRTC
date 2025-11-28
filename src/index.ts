import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { router } from "./doctorRoute.js";

const app = express();
app.use(express.json());
app.use(cors());

// Routes
app.use("/api", router);

// Create HTTP server
const server = http.createServer(app);

// ---- FIX #1: Extend WebSocket type ----
interface ExtWebSocket extends WebSocket {
  id?: string;
}

// Map to store doctor socket connections
const connectedDoctors = new Map<string, ExtWebSocket>();

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (socket: ExtWebSocket) => {
  console.log("🔗 WebSocket client connected");

  // Assign a random ID
  socket.id = Math.random().toString(36).substring(2, 10);

  // ---- FIX #2: Add type for msg ----
  socket.on("message", (msg: string | Buffer) => {
    console.log("Received:", msg.toString());
  });

  socket.on("close", () => {
    console.log(" WebSocket disconnected:", socket.id);

    // Remove doctor from connectedDoctors map
    for (let [doctorID, s] of connectedDoctors.entries()) {
      if (s.id === socket.id) {
        connectedDoctors.delete(doctorID);
        console.log(`Doctor ${doctorID} removed from connection map`);
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
