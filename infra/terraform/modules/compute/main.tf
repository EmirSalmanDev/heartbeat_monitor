terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 8.27"
    }
  }
}

# ─── Placement ────────────────────────────────────────────────────────────────

data "oci_identity_availability_domains" "this" {
  compartment_id = var.compartment_ocid
}

locals {
  availability_domain = coalesce(
    var.availability_domain,
    data.oci_identity_availability_domains.this.availability_domains[0].name,
  )
}

# ─── Image ────────────────────────────────────────────────────────────────────
# Resolved at plan time rather than pinned, so a rebuild picks up the current
# patched image. Pin var.image_ocid if you need byte-identical rebuilds.

data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = var.operating_system
  operating_system_version = var.operating_system_version
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

locals {
  image_ocid = coalesce(
    var.image_ocid,
    try(data.oci_core_images.ubuntu_arm.images[0].id, null),
  )

  cloud_init = templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {
    compose_file_b64 = base64encode(var.compose_file_content)
    nginx_conf_b64   = base64encode(var.nginx_conf_content)
    registry         = var.registry
    image_tag        = var.image_tag
  })
}

# ─── Instance ─────────────────────────────────────────────────────────────────

resource "oci_core_instance" "this" {
  compartment_id      = var.compartment_ocid
  availability_domain = local.availability_domain
  display_name        = "${var.name_prefix}-app"
  shape               = var.instance_shape
  freeform_tags       = var.freeform_tags

  shape_config {
    ocpus         = var.instance_ocpus
    memory_in_gbs = var.instance_memory_gbs
  }

  source_details {
    source_type             = "image"
    source_id               = local.image_ocid
    boot_volume_size_in_gbs = var.boot_volume_size_gbs
  }

  create_vnic_details {
    subnet_id = var.subnet_id
    # The ephemeral public IP is skipped in favour of the reserved one below,
    # so the address survives instance replacement and the DNS record stays valid.
    assign_public_ip = false
    hostname_label   = var.name_prefix
  }

  metadata = {
    ssh_authorized_keys = trimspace(var.ssh_public_key)
    user_data           = base64encode(local.cloud_init)
  }

  # The image data source re-resolves on every plan; without this the instance
  # would show a destroy/recreate diff each time Canonical publishes a build.
  lifecycle {
    ignore_changes = [source_details[0].source_id]
  }
}

# ─── Reserved public IP ───────────────────────────────────────────────────────

data "oci_core_vnic_attachments" "this" {
  compartment_id = var.compartment_ocid
  instance_id    = oci_core_instance.this.id
}

data "oci_core_private_ips" "this" {
  vnic_id = data.oci_core_vnic_attachments.this.vnic_attachments[0].vnic_id
}

resource "oci_core_public_ip" "this" {
  compartment_id = var.compartment_ocid
  display_name   = "${var.name_prefix}-public-ip"
  lifetime       = "RESERVED"
  private_ip_id  = data.oci_core_private_ips.this.private_ips[0].id
  freeform_tags  = var.freeform_tags
}
