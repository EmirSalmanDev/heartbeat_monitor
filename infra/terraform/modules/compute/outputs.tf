output "instance_id" {
  description = "OCID of the compute instance."
  value       = oci_core_instance.this.id
}

output "public_ip" {
  description = "Reserved public IP address of the instance. Point the DNS A record here."
  value       = oci_core_public_ip.this.ip_address
}

output "private_ip" {
  description = "Private IP address of the instance inside the VCN."
  value       = oci_core_instance.this.private_ip
}

output "ssh_command" {
  description = "Ready-to-paste SSH command for the default user."
  value       = "ssh ubuntu@${oci_core_public_ip.this.ip_address}"
}
