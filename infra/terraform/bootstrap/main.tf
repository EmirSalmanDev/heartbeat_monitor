terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 8.27"
    }
  }

  # Deliberately local state. This configuration creates the bucket that every
  # other configuration stores its state in, so it cannot store its own state
  # there. Commit terraform.tfstate for this directory only, or accept that
  # re-running it on a fresh machine will want to recreate the bucket
  # (it is idempotent in practice — import it if that happens).
}

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

data "oci_objectstorage_namespace" "this" {
  compartment_id = var.compartment_ocid
}

resource "oci_objectstorage_bucket" "tfstate" {
  compartment_id = var.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.this.namespace
  name           = var.state_bucket_name

  access_type   = "NoPublicAccess"
  storage_tier  = "Standard"
  versioning    = "Enabled" # poor man's undo for a corrupted state file
  freeform_tags = var.freeform_tags
}
