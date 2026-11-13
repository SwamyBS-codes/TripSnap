terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "tripvault"
}

variable "upload_origins" {
  type    = list(string)
  default = ["http://localhost:3000"]
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "originals" {
  bucket = "${var.name}-originals-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "processed" {
  bucket = "${var.name}-processed-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "originals" {
  bucket                  = aws_s3_bucket.originals.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "processed" {
  bucket                  = aws_s3_bucket.processed.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "originals" {
  bucket = aws_s3_bucket.originals.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "processed" {
  bucket = aws_s3_bucket.processed.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "originals" {
  bucket = aws_s3_bucket.originals.id
  rule {
    id     = "transition-old-originals"
    status = "Enabled"
    filter {}
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "originals" {
  bucket = aws_s3_bucket.originals.id
  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = var.upload_origins
    allowed_headers = ["Content-Type", "x-amz-*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# Attach this instance profile to the EC2 instance running the API and worker.
data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "tripvault_backend" {
  name               = "${var.name}-backend-ec2"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

data "aws_iam_policy_document" "tripvault_s3_access" {
  statement {
    sid       = "ListTripVaultBuckets"
    actions   = ["s3:ListBucket", "s3:ListBucketMultipartUploads"]
    resources = [aws_s3_bucket.originals.arn, aws_s3_bucket.processed.arn]
  }
  statement {
    sid = "ManageTripVaultObjects"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts"
    ]
    resources = [
      "${aws_s3_bucket.originals.arn}/*",
      "${aws_s3_bucket.processed.arn}/*"
    ]
  }
}

resource "aws_iam_role_policy" "tripvault_s3_access" {
  name   = "${var.name}-bucket-access"
  role   = aws_iam_role.tripvault_backend.id
  policy = data.aws_iam_policy_document.tripvault_s3_access.json
}

resource "aws_iam_instance_profile" "tripvault_backend" {
  name = "${var.name}-backend"
  role = aws_iam_role.tripvault_backend.name
}

output "originals_bucket" {
  value = aws_s3_bucket.originals.bucket
}

output "processed_bucket" {
  value = aws_s3_bucket.processed.bucket
}

output "backend_instance_profile" {
  value = aws_iam_instance_profile.tripvault_backend.name
}
