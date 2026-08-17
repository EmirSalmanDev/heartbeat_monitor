variable "compartment_ocid" {
  description = "OCID of the compartment holding the DNS zone."
  type        = string
}

variable "create_zone" {
  description = "Create the OCI DNS zone. Set false if the zone already exists and only the record should be managed."
  type        = bool
  default     = false
}

variable "zone_name" {
  description = "DNS zone name, e.g. \"example.com\"."
  type        = string
}

variable "record_name" {
  description = "Fully-qualified record to create, e.g. \"sentinel.example.com\"."
  type        = string
}

variable "target_ip" {
  description = "IPv4 address the A record resolves to — normally the compute module's public_ip output."
  type        = string
}

variable "ttl" {
  description = "Record TTL in seconds. Kept low so a rebuild's IP change propagates quickly."
  type        = number
  default     = 300
}

variable "freeform_tags" {
  description = "Freeform tags applied to every taggable resource."
  type        = map(string)
  default     = {}
}
