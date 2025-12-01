import { createClient } from 'redis';

export const redis = createClient({
    username: 'default',
    password: 'Z46eGq3UaNwUpZ7Nez5iOQwzm2A3zsQb',
    socket: {
        host: 'redis-17425.c256.us-east-1-2.ec2.cloud.redislabs.com',
        port: 17425 ,
        tls:true
    }
});

redis.on('error', err => console.log('Redis Client Error', err));

await redis.connect();

await redis.set('foo', 'bar');
const result = await redis.get('foo');
console.log(result)  // >>> bar