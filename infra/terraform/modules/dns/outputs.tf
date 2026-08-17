output "record_fqdn" {
  description = "The fully-qualified A record managed by this module."
  value       = var.record_name
}

output "zone_name" {
  description = "Name of the DNS zone the record lives in."
  value       = local.zone_name
}
