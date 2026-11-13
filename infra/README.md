# AWS deployment starter

`main.tf` creates private encrypted originals/processed buckets, strict public access blocks, upload CORS, and an originals lifecycle transition. It does not deploy compute, database, Kafka, IAM roles, CloudFront distribution/OAC, signing keys, or S3-to-Kafka event bridge. Add least-privilege IAM and a private networking plan before applying in a real account. For the expected small-group workload, prefer managed SQS + DLQ and ECS/Fargate workers over self-managed Kafka unless replay/multiple consumer requirements justify Kafka.


Terraform also creates an EC2 role and instance profile with access limited to TripVault originals and processed buckets. Attach the output `backend_instance_profile` to the EC2 instance that runs the API and worker. The AWS SDK uses the instance profile automatically when `S3_ENDPOINT`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` are unset. Do not put access keys in the application environment.
