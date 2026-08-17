output "public_ip" {
  description = "Reserved public IP of the Sentinel instance."
  value       = module.compute.public_ip
}

output "ssh_command" {
  description = "SSH into the instance."
  value       = module.compute.ssh_command
}

output "app_url" {
  description = "URL the stack serves once started. Plain HTTP until certbot is run."
  value       = var.enable_dns ? "http://${var.dns_record_name}" : "http://${module.compute.public_ip}"
}

output "next_steps" {
  description = "Manual steps required after apply — the stack does not self-start."
  value       = <<-EOT
    The instance is provisioned but the stack is NOT running yet.

      1. ssh ubuntu@${module.compute.public_ip}
      2. sudo vi /opt/sentinel/.env
         Fill in POSTGRES_PASSWORD, JWT_SECRET, COOKIE_SECRET, and replace
         CHANGEME in DATABASE_URL with the same POSTGRES_PASSWORD value.
      3. sudo docker login ghcr.io          # only if the GHCR package is private
      4. sudo systemctl start sentinel
      5. sudo docker compose -f /opt/sentinel/docker-compose.yml ps

    Images must already exist at ${var.registry}/sentinel-{api,worker,web}:${var.image_tag}.
    Build them for arm64 before starting — see infra/terraform/README.md.
  EOT
}
