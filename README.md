# Multi Region Read Heavy App

A production style learning project that demonstrates how to build a resilient multi region system with a single write region and a separate read region.
It brings together distributed systems patterns, Kubernetes, and DevOps in a compact and useful app you can run locally and in AWS.

## Tech stack

* Node.js with Express for all three services
* PostgreSQL for persistence
* Kafka for the event stream
* Docker for container images
* Kubernetes on AWS using EKS
* Terraform for infrastructure as code
* Amazon ECR for image registry
* Route 53, Application Load Balancer, and AWS Certificate Manager for entry and TLS

## Cloud architecture on AWS

### High level request path

1. Route 53 answers DNS for your app domain
2. Either CloudFront or an Application Load Balancer terminates TLS with a certificate from AWS Certificate Manager
3. AWS Load Balancer Controller provisions the load balancer and connects it to Kubernetes Ingress
4. Ingress routes to the Read API or Write API Services inside the cluster

### EKS layout

1. New VPC with three public subnets in supported availability zones for the cluster
2. One managed node group sized for a small footprint to start
3. Control plane logs to CloudWatch for basic observability
4. IAM roles for the cluster and node group with registry pull permission

### Databases in AWS

1. Region 1 uses a managed relational instance for writes
2. Region 2 uses a separate relational instance for the read model that is populated by the Replicator
