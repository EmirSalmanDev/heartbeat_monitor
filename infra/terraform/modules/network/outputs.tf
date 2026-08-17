output "vcn_id" {
  description = "OCID of the created VCN."
  value       = oci_core_vcn.this.id
}

output "subnet_id" {
  description = "OCID of the public subnet the compute instance attaches to."
  value       = oci_core_subnet.public.id
}

output "security_list_id" {
  description = "OCID of the public security list."
  value       = oci_core_security_list.public.id
}
