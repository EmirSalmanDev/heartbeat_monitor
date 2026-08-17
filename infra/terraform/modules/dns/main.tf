terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 8.27"
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Optional. Only useful if the domain's nameservers already point at OCI DNS.
# If the domain is parked at an external registrar (Cloudflare, Namecheap, …),
# do not enable this module — create the A record there instead, pointing at
# the compute module's `public_ip` output.
#
# TLS is deliberately not handled here. There is no free managed certificate
# service on OCI, so the intended path is certbot on the instance once this
# record resolves. See infra/terraform/README.md.
# ─────────────────────────────────────────────────────────────────────────────

resource "oci_dns_zone" "this" {
  count = var.create_zone ? 1 : 0

  compartment_id = var.compartment_ocid
  name           = var.zone_name
  zone_type      = "PRIMARY"
  scope          = "GLOBAL"
  freeform_tags  = var.freeform_tags
}

locals {
  zone_name = var.create_zone ? oci_dns_zone.this[0].name : var.zone_name
}

resource "oci_dns_rrset" "apex" {
  zone_name_or_id = local.zone_name
  domain          = var.record_name
  rtype           = "A"
  compartment_id  = var.compartment_ocid
  # `scope` intentionally omitted — the provider infers it from the zone and
  # deprecated the argument.

  items {
    domain = var.record_name
    rtype  = "A"
    rdata  = var.target_ip
    ttl    = var.ttl
  }
}
