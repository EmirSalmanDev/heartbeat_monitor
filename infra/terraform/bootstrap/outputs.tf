output "state_bucket_name" {
  description = "Bucket name to reference from environments/prod/backend.tf."
  value       = oci_objectstorage_bucket.tfstate.name
}

output "namespace" {
  description = "Object Storage namespace — needed to build the S3-compatible endpoint in backend.tf."
  value       = data.oci_objectstorage_namespace.this.namespace
}

output "s3_compatible_endpoint" {
  description = "The endpoint value to paste into environments/prod/backend.tf."
  value       = "https://${data.oci_objectstorage_namespace.this.namespace}.compat.objectstorage.${var.region}.oraclecloud.com"
}
