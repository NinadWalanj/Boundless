variable "region" {
  type        = string
  description = "AWS region for Region one"
  default     = "us-east-1"
}

variable "tf_bucket" {
  type        = string
  description = "S3 bucket for Terraform state"
}

variable "tf_lock_table" {
  type        = string
  description = "DynamoDB table for state locks"
}

variable "cluster_name" {
  type        = string
  description = "EKS cluster name"
  default     = "mr-app-r1"
}

variable "node_instance_types" {
  type    = list(string)
  default = ["t3.small"]
}

variable "node_desired_size" {
  type    = number
  default = 2
}

variable "node_min_size" {
  type    = number
  default = 2
}

variable "node_max_size" {
  type    = number
  default = 4
}
