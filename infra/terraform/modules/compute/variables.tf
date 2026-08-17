variable "compartment_ocid" {
  description = "OCID of the compartment the instance is created in."
  type        = string
}

variable "subnet_id" {
  description = "OCID of the subnet to attach the primary VNIC to."
  type        = string
}

variable "name_prefix" {
  description = "Prefix applied to the display name of every resource in this module."
  type        = string
  default     = "sentinel"
}

variable "availability_domain" {
  description = <<-EOT
    Availability domain name to place the instance in. Leave null to use the
    first AD in the region. Ampere A1 free capacity is per-AD — if apply fails
    with "Out of host capacity", set this explicitly and retry against another.
  EOT
  type        = string
  default     = null
}

# ─── Shape ────────────────────────────────────────────────────────────────────

variable "instance_shape" {
  description = "Compute shape. VM.Standard.A1.Flex is the Always Free Ampere shape."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "instance_ocpus" {
  description = "OCPUs allocated. The Always Free A1 allowance is 4 across the tenancy; this stack is sized at 2."
  type        = number
  default     = 2
}

variable "instance_memory_gbs" {
  description = "Memory in GB. Always Free A1 allowance is 24 across the tenancy; this stack is sized at 12."
  type        = number
  default     = 12
}

variable "boot_volume_size_gbs" {
  description = <<-EOT
    Boot volume size. Always Free block storage totals 200GB across the
    tenancy, and each instance needs at least 50GB. 100GB leaves headroom for
    the Postgres volume and Redis AOF while keeping room for a second instance.
  EOT
  type        = number
  default     = 100

  validation {
    condition     = var.boot_volume_size_gbs >= 50 && var.boot_volume_size_gbs <= 200
    error_message = "Boot volume must be between 50GB and the 200GB Always Free ceiling."
  }
}

# ─── Image ────────────────────────────────────────────────────────────────────

variable "operating_system" {
  description = "OS name as reported by the OCI images API."
  type        = string
  default     = "Canonical Ubuntu"
}

variable "operating_system_version" {
  description = "OS version as reported by the OCI images API."
  type        = string
  default     = "24.04"
}

variable "image_ocid" {
  description = "Pin a specific image OCID. Leave null to resolve the latest matching aarch64 image at plan time."
  type        = string
  default     = null
}

# ─── Access ───────────────────────────────────────────────────────────────────

variable "ssh_public_key" {
  description = "SSH public key authorised for the default 'ubuntu' user."
  type        = string

  validation {
    condition     = can(regex("^(ssh-rsa|ssh-ed25519|ecdsa-sha2-)", trimspace(var.ssh_public_key)))
    error_message = "ssh_public_key must be an OpenSSH public key, not a path or a private key."
  }
}

# ─── Application payload ──────────────────────────────────────────────────────

variable "compose_file_content" {
  description = "Raw contents of the repo's docker-compose.yml, rendered onto the instance at /opt/sentinel/docker-compose.yml."
  type        = string
}

variable "nginx_conf_content" {
  description = "Raw contents of the repo's nginx/nginx.conf, rendered onto the instance at /opt/sentinel/nginx/nginx.conf."
  type        = string
}

variable "registry" {
  description = "Container registry prefix the Compose file pulls images from."
  type        = string
  default     = "ghcr.io/emirsalmandev"
}

variable "image_tag" {
  description = "Image tag to deploy."
  type        = string
  default     = "latest"
}

variable "freeform_tags" {
  description = "Freeform tags applied to every taggable resource."
  type        = map(string)
  default     = {}
}
