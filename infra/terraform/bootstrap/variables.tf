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
  description = "OCI region identifier, e.g. eu-frankfurt-1."
  type        = string
}

variable "compartment_ocid" {
  description = "OCID of the compartment the state bucket is created in."
  type        = string
}

variable "state_bucket_name" {
  description = "Name of the Object Storage bucket holding remote Terraform state."
  type        = string
  default     = "sentinel-tfstate"
}

variable "freeform_tags" {
  description = "Freeform tags applied to the bucket."
  type        = map(string)
  default = {
    project   = "sentinel"
    managedBy = "terraform"
  }
}
