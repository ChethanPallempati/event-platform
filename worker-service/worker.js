const amqp = require("amqplib");

const MAX_RETRIES = 3;

async function connectWithRetry() {
    const RETRY_DELAY = 3000; // 3 seconds

    while (true) {
        try {
            console.log("🔄 Trying to connect to RabbitMQ...");
            const connection = await amqp.connect("amqp://rabbitmq");
            return connection;
        } catch (error) {
            console.log(" RabbitMQ not ready, retrying in 3s...");
            await new Promise(res => setTimeout(res, RETRY_DELAY));
        }
    }
}

async function startWorker() {
    try {
        const connection = await connectWithRetry();
        const channel = await connection.createChannel();

        await channel.assertQueue("events", { durable: true });
        await channel.assertQueue("dlq", { durable: true });

        console.log("👷 Worker started... waiting for events");

        channel.consume("events", async (msg) => {
            if (msg !== null) {
                let event = JSON.parse(msg.content.toString());
                event.retryCount = event.retryCount || 0;

                try {
                    console.log(" Processing event:", event);

                    if (event.type === "FAIL_TEST") {
                        throw new Error("Forced failure");
                    }

                    console.log(`📧 Notification sent to user ${event.userId}`);

                    channel.ack(msg);

                } catch (error) {
                    console.error("Processing failed:", error.message);

                    if (event.retryCount < MAX_RETRIES) {
                        event.retryCount++;

                        channel.sendToQueue(
                            "events",
                            Buffer.from(JSON.stringify(event)),
                            { persistent: true }
                        );

                        channel.ack(msg);

                    } else {
                        channel.sendToQueue(
                            "dlq",
                            Buffer.from(JSON.stringify(event)),
                            { persistent: true }
                        );

                        channel.ack(msg);
                    }
                }
            }
        });

    } catch (error) {
        console.error(" Worker error:", error);
    }
}

startWorker();