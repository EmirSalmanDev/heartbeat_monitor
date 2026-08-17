terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 8.27"
    }
  }
}

# ─── VCN ──────────────────────────────────────────────────────────────────────

resource "oci_core_vcn" "this" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = [var.vcn_cidr]
  display_name   = "${var.name_prefix}-vcn"
  dns_label      = replace(var.name_prefix, "-", "")
  freeform_tags  = var.freeform_tags
}

# ─── Internet gateway + route table ───────────────────────────────────────────

resource "oci_core_internet_gateway" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name_prefix}-igw"
  enabled        = true
  freeform_tags  = var.freeform_tags
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name_prefix}-rt-public"
  freeform_tags  = var.freeform_tags

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.this.id
  }
}

# ─── Security list ────────────────────────────────────────────────────────────
# Note: OCI security lists are stateful by default, so no matching egress rule
# is needed for return traffic on the ingress ports below.

resource "oci_core_security_list" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name_prefix}-sl-public"
  freeform_tags  = var.freeform_tags

  # All egress — the stack pulls images from GHCR and pings arbitrary monitor URLs.
  egress_security_rules {
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
    protocol         = "all"
    description      = "Allow all outbound (image pulls, outbound monitor pings)"
  }

  ingress_security_rules {
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    protocol    = "6" # TCP
    description = "HTTP"

    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    protocol    = "6"
    description = "HTTPS (reserved for the certbot/TLS follow-up; nginx listens on 80 today)"

    tcp_options {
      min = 443
      max = 443
    }
  }

  ingress_security_rules {
    source      = var.ssh_ingress_cidr
    source_type = "CIDR_BLOCK"
    protocol    = "6"
    description = "SSH, restricted to the operator's address"

    tcp_options {
      min = 22
      max = 22
    }
  }

  # ICMP path-MTU / unreachable, scoped to the VCN. Without this, TCP sessions
  # that need fragmentation stall rather than fail cleanly.
  ingress_security_rules {
    source      = var.vcn_cidr
    source_type = "CIDR_BLOCK"
    protocol    = "1" # ICMP
    description = "Path MTU discovery within the VCN"

    icmp_options {
      type = 3
      code = 4
    }
  }
}

# ─── Public subnet ────────────────────────────────────────────────────────────
# Deliberately NOT exposing 5432/6379: Postgres and Redis stay on the internal
# Compose bridge network. The published host ports in docker-compose.yml are
# still blocked at the security-list layer.

resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.this.id
  cidr_block                 = var.subnet_cidr
  display_name               = "${var.name_prefix}-subnet-public"
  dns_label                  = "public"
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.public.id]
  prohibit_public_ip_on_vnic = false
  freeform_tags              = var.freeform_tags
}
