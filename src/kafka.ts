import { Kafka } from "kafkajs";

// Replace these with your Confluent Cloud details
const BROKER = "pkc-619z3.us-east1.gcp.confluent.cloud:9092"; // bootstrap server
const API_KEY = "YFSVVFHMPBMV3NIP";       // username
const API_SECRET = "cfltlalWArXVMDdOQfM3ZoWQhD5eM2Xwoo31krUcuxthv9bYa3XLM9LVginxiGhQ"; // password

const kafka = new Kafka({
  clientId: "telemedicine-service",
  brokers: [BROKER],
  ssl: true, // required for Confluent Cloud
  sasl: {
    mechanism: "plain", // Confluent Cloud supports PLAIN
    username: API_KEY,
    password: API_SECRET,
  },
});

export const producer = kafka.producer();
export const consumer = kafka.consumer({ groupId: "signaler-group" });

export async function initKafka() {
  try {
    await producer.connect();
    console.log("Kafka Producer connected ✅");

    await consumer.connect();
    console.log("Kafka Consumer connected ✅");
  } catch (err) {
    console.error("Kafka connection error:", err);
  }
}
