// signalingServer.ts
import http from "http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { producer, consumer, initKafka } from "./kafka.js";
import { redis } from "./redis.js"; // your existing redis client

console.log("Starting Signaler Service...");

// In-memory maps for live sockets (per-process)
const connectedDoctors = new Map<string, WebSocket>();   // doctorID -> ws
const connectedPatients = new Map<string, WebSocket>();  // patientID -> ws

// Extend type (if TS)
declare module "ws" {
  interface WebSocket {
    id?: string;
    userID?: string;
    userType?: "doctor" | "patient";
  }
}

async function startSignaler() {
  await initKafka();

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  // Utility: send JSON safely
  function sendJSON(ws: WebSocket, obj: unknown) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }

  // When the process receives a cross-instance call request via Kafka
  await consumer.subscribe({ topic: "call-requests", fromBeginning: false });
  consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      let payload;
      try { payload = JSON.parse(message.value.toString()); } catch { return; }

      // Example payload: { event: "connect-patient-to-doctor", patientID, patientSocketID, doctorID, doctorSocketID, caseType }
      if (payload.event === "connect-patient-to-doctor") {
        const { doctorID, patientID, doctorSocketID, patientSocketID, caseType } = payload;

        // Try to find doctor socket in THIS process
        const doctorWs = connectedDoctors.get(doctorID);
        const patientWs = connectedPatients.get(patientID);
        console.log("Call request for patient", patientID, "to doctor", doctorID);

        // Notify doctor if connected here
        if (doctorWs && doctorWs.readyState === doctorWs.OPEN) {
          console.log(1)
          sendJSON(doctorWs, {
            type: "incoming-call",
            from: patientID,
            patientSocketID,
            caseType,
          });
        }

        // Also notify patient (if connected here) that doctor has been selected
        if (patientWs && patientWs.readyState === patientWs.OPEN) {
          console.log(2)
          sendJSON(patientWs, {
            type: "doctor-assigned",
            doctorID,
            doctorSocketID,
            caseType,
          });
        }
      }
      console.log("Processed call-requests event");
      // You can extend other event handlers (e.g., cancel, preempt)
    },
  });
  await consumer.subscribe({ topic: "call-handover", fromBeginning: false });

consumer.run({
  eachMessage: async ({ message }) => {
    if (!message.value) return;
    let payload;

    try { payload = JSON.parse(message.value.toString()); } catch { return; }

    if (payload.event === "handover-request") {
      const {
        fromDoctorID,
        fromDoctorSocketID,
        newDoctorID,
        newDoctorSocketID,
        patientID,
        caseType
      } = payload;

      // Get sockets from in-memory map
      const oldDoctorWS = connectedDoctors.get(fromDoctorID);
      const newDoctorWS = connectedDoctors.get(newDoctorID);
      const patientWS = connectedPatients.get(patientID);

      // 1. Notify OLD DOCTOR that handover is starting
      if (oldDoctorWS) {
        sendJSON(oldDoctorWS, {
          type: "handover-start",
          newDoctorID
        });
      }

      // 2. Notify NEW DOCTOR of incoming handover
      if (newDoctorWS) {
        sendJSON(newDoctorWS, {
          type: "incoming-handover",
          patientID,
          patientSocketID: patientWS?.id || null,
          caseType,
          fromDoctorID
        });
      }

      // 3. Notify PATIENT to renegotiate with the NEW doctor
      if (patientWS) {
        sendJSON(patientWS, {
          type: "renegotiate",
          newDoctorID,
          newDoctorSocketID
        });
      }
    }
  },
});


  // WS connection handling
  wss.on("connection", (socket: WebSocket) => {
    socket.id = Math.random().toString(36).slice(2, 10);
    console.log("ws connected:", socket.id);

    // Immediately tell client its socket ID
    sendJSON(socket, { type: "socket-id", socketID: socket.id });

    socket.on("message", async (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return; }

      // REGISTER from client: { type: "register", id, role }
      if (data.type === "register" && data.id && data.role) {
        const { id, role } = data;
        socket.userID = id;
        socket.userType = role === "patient" ? "patient" : "doctor";

        if (socket.userType === "doctor") {
          connectedDoctors.set(id, socket);
          console.log(`doctor registered: ${id}`);
        } else {
          connectedPatients.set(id, socket);
          console.log(`patient registered: ${id}`);
        }

        // Optionally send back confirmation
        sendJSON(socket, { type: "registered", socketID: socket.id, id });
        return;
      }

      // SIGNALING MESSAGES: offer/answer/ice
      // Structure expected:
      // { type: "offer" | "answer" | "ice", toSocketID: "xxx", payload: {...} }
      if (["offer", "answer", "ice", "hangup"].includes(data.type)) {
        const targetSocketID = data.toSocketID;
        // We need to find the live socket object by socket.id among both maps
        let targetWs: WebSocket | undefined;
        for (const ws of connectedDoctors.values()) if (ws.id === targetSocketID) { targetWs = ws; break; }
        for (const ws of connectedPatients.values()) if (ws.id === targetSocketID) { targetWs = ws; break; }

        if (targetWs && targetWs.readyState === targetWs.OPEN) {
          sendJSON(targetWs, {
            type: data.type,
            fromSocketID: socket.id,
            fromUserID: socket.userID || null,
            payload: data.payload || null,
          });
        } else {
          // target not connected here: publish to Kafka so other instance can deliver
          await producer.send({
            topic: "signaling-events",
            messages: [{
              value: JSON.stringify({
                event: "remote-signal",
                toSocketID: targetSocketID,
                type: data.type,
                fromSocketID: socket.id,
                fromUserID: socket.userID || null,
                payload: data.payload || null,
              }),
            }],
          });
        }
        return;
      }

      // Example: client requests a call; we can also trigger redis lookup & kafka push from here, but
      // your existing /api/patient/find-doctor REST endpoint handles matchmaking and pushes call-requests to Kafka.
    });

    socket.on("close", () => {
      // cleanup
      if (socket.userType === "doctor" && socket.userID) {
        connectedDoctors.delete(socket.userID);
      }
      if (socket.userType === "patient" && socket.userID) {
        connectedPatients.delete(socket.userID);
      }
      console.log("ws closed:", socket.id);
    });
  });

  // Kafka consumer for cross-instance signaling-events (deliver offers/answers/ice)
  await consumer.subscribe({ topic: "signaling-events", fromBeginning: false });
  consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      let payload;
      try { payload = JSON.parse(message.value.toString()); } catch { return; }

      if (payload.event === "remote-signal") {
        const { toSocketID, type, fromSocketID, fromUserID, payload: p } = payload;
        // find target socket in this process
        let targetWs: WebSocket | undefined;
        for (const ws of connectedDoctors.values()) if (ws.id === toSocketID) { targetWs = ws; break; }
        for (const ws of connectedPatients.values()) if (ws.id === toSocketID) { targetWs = ws; break; }

        if (targetWs && targetWs.readyState === targetWs.OPEN) {
          sendJSON(targetWs, { type, fromSocketID, fromUserID, payload: p });
        }
      }
    }
  });

  server.listen(5001, () => console.log("Signaler listening on :5001"));
}

startSignaler().catch(console.error);
