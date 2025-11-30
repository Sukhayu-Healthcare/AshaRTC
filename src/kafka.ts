import { Kafka } from "kafkajs";

const kafka = new Kafka({
  clientId: "telemedicine-service",
  brokers: ["localhost:9092"],
});

export const producer = kafka.producer();
export const consumer = kafka.consumer({ groupId: "signaler-group" });

export async function initKafka() {
    await producer.connect();
    await consumer.connect();
  }