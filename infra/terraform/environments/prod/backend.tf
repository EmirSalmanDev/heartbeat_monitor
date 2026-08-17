# ─────────────────────────────────────────────────────────────────────────────
# Remote state on OCI Object Storage via its S3-compatible API.
#
# Commented out on purpose: `terraform init` fails against a bucket that does
# not exist yet, which would block `validate` in CI. Run infra/terraform/bootstrap
# first, then uncomment this block, fill in the two placeholders from the
# bootstrap outputs, and run `terraform init -migrate-state`.
#
# Credentials come from a Customer Secret Key (OCI console → your user →
# Customer Secret Keys), exported as AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
# They are NOT the API signing key used by the provider above.
#
# Known simplification: no state locking. OCI has no free DynamoDB equivalent,
# and `use_lockfile` on the S3 backend requires real S3 conditional writes,
# which the OCI compatibility layer does not implement. Single-operator only —
# two concurrent applies can corrupt state. Bucket versioning (enabled in
# bootstrap) is the recovery path, not a substitute.
# ─────────────────────────────────────────────────────────────────────────────

# terraform {
#   backend "s3" {
#     bucket = "sentinel-tfstate"
#     key    = "prod/terraform.tfstate"
#     region = "eu-frankfurt-1"
#
#     endpoints = {
#       s3 = "https://<NAMESPACE>.compat.objectstorage.eu-frankfurt-1.oraclecloud.com"
#     }
#
#     # OCI's S3 layer speaks enough of the protocol for state storage, but not
#     # the newer validation handshakes the AWS provider expects.
#     skip_region_validation      = true
#     skip_credentials_validation = true
#     skip_requesting_account_id  = true
#     skip_metadata_api_check     = true
#     skip_s3_checksum            = true
#     use_path_style              = true
#   }
# }
