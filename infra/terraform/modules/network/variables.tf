variable "compartment_ocid" {
  description = "OCID of the compartment the network resources are created in."
  type        = string
}

variable "name_prefix" {
  description = "Prefix applied to the display name of every resource in this module."
  type        = string
  default     = "sentinel"
}

variable "vcn_cidr" {
  description = "CIDR block for the VCN."
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_cidr" {
  description = "CIDR block for the public subnet. Must sit inside var.vcn_cidr."
  type        = string
  default     = "10.0.1.0/24"
}

variable "ssh_ingress_cidr" {
  description = <<-EOT
    CIDR allowed to reach port 22. Defaults to a value that must be overridden —
    leaving SSH open to 0.0.0.0/0 on a box holding the Postgres volume is the
    single most likely way this instance gets compromised.
  EOT
  type        = string

  validation {
    condition     = var.ssh_ingress_cidr != "0.0.0.0/0"
    error_message = "Refusing to open SSH to the whole internet. Set ssh_ingress_cidr to your own IP (e.g. \"203.0.113.4/32\")."
  }
}

variable "freeform_tags" {
  description = "Freeform tags applied to every taggable resource."
  type        = map(string)
  default     = {}
}
