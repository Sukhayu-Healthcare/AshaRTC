import { createClient } from 'redis';

export const redis = createClient({
  url: "redis://default:Z46eGq3UaNwUpZ7Nez5iOQwzm2A3zsQb@redis-17425.c256.us-east-1-2.ec2.cloud.redislabs.com:17425",
});

redis.on('error', err => console.log('Redis Client Error', err));

await redis.connect();

await redis.set('foo', 'bar');
console.log(await redis.get('foo'));
