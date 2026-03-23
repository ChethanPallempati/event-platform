const express = require("express");
const amqp = require("amqplib");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const { createClient } = require("redis");

const app = express();
app.use(express.json());

//  JWT Secret
const JWT_SECRET = "supersecretkey"; // move to env later

//  Redis Setup
const redisClient = createClient({
    url: "redis://redis:6379"
});

redisClient.connect()
    .then(() => console.log(" Connected to Redis"))
    .catch(console.error);

//  RabbitMQ Setup
let channel;

async function connectQueueWithRetry() {
    const RETRY_DELAY = 3000;

    while (true) {
        try {
            console.log(" Connecting to RabbitMQ...");
            const connection = await amqp.connect("amqp://rabbitmq");
            channel = await connection.createChannel();

            await channel.assertQueue("events", { durable: true });

            console.log("Connected to RabbitMQ");
            break;
        } catch (error) {
            console.log(" RabbitMQ not ready, retrying in 3s...");
            await new Promise(res => setTimeout(res, RETRY_DELAY));
        }
    }
}

// Auth Middleware
function authenticate(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "Invalid token format" });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ error: "Invalid token" });
    }
}

//  Rate Limiter (uses JWT user)
async function rateLimiter(req, res, next) {
    const userId = req.user.userId;

    const key = `rate:${userId}`;
    const windowSize = 60; // seconds
    const maxRequests = 5;

    const currentTime = Date.now();

    let requests = await redisClient.get(key);
    requests = requests ? JSON.parse(requests) : [];

    const validRequests = requests.filter(
        timestamp => currentTime - timestamp < windowSize * 1000
    );

    if (validRequests.length >= maxRequests) {
        return res.status(429).json({
            error: "Too many requests. Try again later."
        });
    }

    validRequests.push(currentTime);

    await redisClient.set(key, JSON.stringify(validRequests));

    next();
}

// Validation Middleware
function validateEvent(req, res, next) {
    const { type, message } = req.body;

    if (!type || !message) {
        return res.status(400).json({
            error: "Invalid event payload. Required: type, message"
        });
    }

    next();
}

//  Login Route (Generate JWT)
app.post("/login", (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId required" });
    }

    const token = jwt.sign(
        { userId },
        JWT_SECRET,
        { expiresIn: "1h" }
    );

    res.json({ token });
});

//  Health Check Route
app.get("/", (req, res) => {
    res.send(" Event Platform API is running");
});

//  Main Event Route (SECURED)
app.post("/event", authenticate, rateLimiter, validateEvent, (req, res) => {

    if (!channel) {
        return res.status(503).json({
            error: "Service unavailable. Try again later."
        });
    }

    const userId = req.user.userId;

    const event = {
        ...req.body,
        userId // override from JWT (secure)
    };

    const eventId = uuidv4();

    const enrichedEvent = {
        eventId,
        ...event,
        createdAt: new Date().toISOString()
    };

    //  Send to RabbitMQ (persistent)
    channel.sendToQueue(
        "events",
        Buffer.from(JSON.stringify(enrichedEvent)),
        { persistent: true }
    );

    console.log(" Event sent to queue:", enrichedEvent);

    res.status(202).json({
        message: "Event queued",
        eventId
    });
});

//  Start Server AFTER RabbitMQ is ready
async function startServer() {
    await connectQueueWithRetry();

    app.listen(3000, () => {
        console.log(" API Gateway running on port 3000");
    });
}

startServer();