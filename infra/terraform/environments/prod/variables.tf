# ─── Provider auth ────────────────────────────────────────────────────────────

variable "tenancy_ocid" {
  description = "OCID of the tenancy."
  type        = string
}

variable "user_ocid" {
  description = "OCID of the user whose API signing key is used."
  type        = string
}

variable "fingerprint" {
  description = "Fingerprint of the API signing key."
  type        = string
}

variable "private_key_path" {
  description = "Path to the API signing private key on disk. Never commit this key."
  type        = string
}

variable "region" {
  description = <<-EOT
    OCI region identifier. eu-frankfurt-1 and ap-singapore-1 tend to have the
    best Ampere A1 free-tier capacity.
  EOT
  type        = string
  default     = "eu-frankfurt-1"
}

variable "compartment_ocid" {
  description = "OCID of the compartment all resources are created in."
  type        = string
}

# ─── Network ──────────────────────────────────────────────────────────────────

variable "ssh_ingress_cidr" {
  description = "CIDR allowed to reach port 22. Set to your own address, e.g. \"203.0.113.4/32\"."
  type        = string
}

# ─── Compute ──────────────────────────────────────────────────────────────────

variable "availability_domain" {
  description = "Availability domain override. Leave null unless working around 'Out of host capacity'."
  type        = string
  default     = null
}

variable "instance_ocpus" {
  description = "OCPUs for the instance."
  type        = number
  default     = 2
}

variable "instance_memory_gbs" {
  description = "Memory in GB for the instance."
  type        = number
  default     = 12
}

variable "boot_volume_size_gbs" {
  description = "Boot volume size in GB."
  type        = number
  default     = 100
}

variable "ssh_public_key" {
  description = "SSH public key authorised for the 'ubuntu' user, e.g. file(\"~/.ssh/id_ed25519.pub\")."
  type        = string
}

# ─── Application ──────────────────────────────────────────────────────────────

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

# ─── DNS (optional) ───────────────────────────────────────────────────────────

variable "enable_dns" {
  description = "Manage a DNS A record in OCI DNS. Leave false if the domain lives at an external registrar."
  type        = bool
  default     = false
}

variable "dns_zone_name" {
  description = "DNS zone name, e.g. \"example.com\". Only read when enable_dns is true."
  type        = string
  default     = ""
}

variable "dns_record_name" {
  description = "FQDN of the A record, e.g. \"sentinel.example.com\". Only read when enable_dns is true."
  type        = string
  default     = ""
}

variable "dns_create_zone" {
  description = "Create the zone as well as the record. Only read when enable_dns is true."
  type        = bool
  default     = false
}
