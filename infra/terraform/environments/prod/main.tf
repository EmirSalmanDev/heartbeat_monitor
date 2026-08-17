locals {
  name_prefix = "sentinel"

  freeform_tags = {
    project     = "sentinel"
    environment = "prod"
    managedBy   = "terraform"
  }

  # Repo root, relative to this directory. The instance runs the committed
  # docker-compose.yml and nginx.conf verbatim — reading them here rather than
  # keeping a second copy under infra/ means the two cannot drift apart.
  repo_root = "${path.module}/../../../.."
}

module "network" {
  source = "../../modules/network"

  compartment_ocid = var.compartment_ocid
  name_prefix      = local.name_prefix
  ssh_ingress_cidr = var.ssh_ingress_cidr
  freeform_tags    = local.freeform_tags
}

module "compute" {
  source = "../../modules/compute"

  compartment_ocid    = var.compartment_ocid
  subnet_id           = module.network.subnet_id
  name_prefix         = local.name_prefix
  availability_domain = var.availability_domain

  instance_ocpus       = var.instance_ocpus
  instance_memory_gbs  = var.instance_memory_gbs
  boot_volume_size_gbs = var.boot_volume_size_gbs

  ssh_public_key = var.ssh_public_key

  compose_file_content = file("${local.repo_root}/docker-compose.yml")
  nginx_conf_content   = file("${local.repo_root}/nginx/nginx.conf")

  registry  = var.registry
  image_tag = var.image_tag

  freeform_tags = local.freeform_tags
}

module "dns" {
  source = "../../modules/dns"
  count  = var.enable_dns ? 1 : 0

  compartment_ocid = var.compartment_ocid
  create_zone      = var.dns_create_zone
  zone_name        = var.dns_zone_name
  record_name      = var.dns_record_name
  target_ip        = module.compute.public_ip
  freeform_tags    = local.freeform_tags
}
