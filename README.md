# Event-Driven Notification Platform

A production-style distributed backend system designed to handle asynchronous event processing with high reliability and scalability.


# Architecture

Client → API Gateway → RabbitMQ → Worker  
                 ↓  
              Redis (Rate Limiting)

Failures → Retry → Dead Letter Queue (DLQ)

##Features

- JWT-based Authentication
- Redis Sliding Window Rate Limiting
- Asynchronous Event Processing (RabbitMQ)
- Retry Mechanism for Failures
- Dead Letter Queue (DLQ)
- Dockerized Microservices Architecture

## Tech Stack

- Node.js (Express)
- RabbitMQ
- Redis
- Docker & Docker Compose
