# Application Architecture

## Overview

This document describes a multi region deployment with a primary region that supports both read and write operations and a secondary region that currently supports only read operations.

The design uses a single write leader in Region 1 to ensure strong consistency for writes, and asynchronous replication to Region 2, which results in eventual consistency for reads across regions.

## Regions and Components

There are two deployment regions in this application, referred to as Region 1 and Region 2.

### Region 1 components

* Write API  
* Read API  
* Relational database  
* Replication logic  

Region 1 functions as the primary region and supports both read and write operations.

### Region 2 components

* Read API  
* Relational database  
* Replication logic  

Region 2 currently functions as a read only replica. A future enhancement may introduce write capability in Region 2.

## Consistency Model

* All write requests are routed to Region 1.  
* After data is written to the primary relational database, it is published to Kafka using an outbox pattern.  
* Region 2 consumes Kafka events and persists the data into its own regional relational database.  

With this design, the system is strongly consistent for writes because there is a single write leader in Region 1. Read operations across regions are eventually consistent, since Region 2 may briefly lag behind Region 1 while replication is in progress.

## Data Flow Overview

Client
  │
  ↓
Route53 global DNS
  │
  ├► Region 1 primary
  │     Write API → RDS primary → Outbox table → Kafka producer
  │     Read API  → Redis → RDS primary
  │
  └► Region 2 replica
        Kafka consumer → RDS replica → Redis
        Read API       → Redis → RDS replica


## End-to-End Request Example

Client browser
   │
   ↓
Route53 global DNS with health checks
   │
   ↓
Application load balancer in Region 1
   │
   ↓
Ingress in EKS
   │
   ↓
Kubernetes Service → Write API deployment → RDS primary
                                   │
                                   ↓
                                Outbox table → Kafka → Region 2 consumer → RDS replica → Redis



## Tech stack

* Node.js with Express for all services
* PostgreSQL for persistence
* Kafka for the event stream
* Docker for container images
* Kubernetes on AWS using EKS
* Terraform for infrastructure as code
* Amazon ECR for image registry
* Route 53, Application Load Balancer, and AWS Certificate Manager for entry and TLS

