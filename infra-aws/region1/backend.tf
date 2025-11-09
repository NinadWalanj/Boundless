terraform {
  backend "s3" {
    bucket         = "ninad-tf-state-1234" # change to your actual bucket from bootstrap output
    key            = "region1/eks/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "tf-locks" # change to your actual table from bootstrap output
    encrypt        = true
  }
}
