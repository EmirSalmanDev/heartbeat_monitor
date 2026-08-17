# Sentinel — Infrastructure

Terraform for a single Oracle Cloud **Ampere A1** instance (Always Free tier) running the
existing 6-service Compose stack.

```
infra/terraform/
├── bootstrap/            # one-time: Object Storage bucket for remote state
├── modules/
│   ├── network/          # VCN, public subnet, IGW, route table, security list
│   ├── compute/          # A1.Flex instance, reserved public IP, cloud-init
│   └── dns/              # optional OCI DNS A record
└── environments/prod/    # wires the modules together
```

## What actually gets deployed

The instance runs the repo's `docker-compose.yml` and `nginx/nginx.conf` **verbatim** —
`environments/prod/main.tf` reads them with `file()` and cloud-init renders them to
`/opt/sentinel/`. There is no second copy under `infra/`, so the two cannot drift.

Services: `postgres`, `redis`, `migrate` (one-shot), `api`, `worker`, `nginx`.
Postgres and Redis stay on the internal Compose bridge; the security list does not open
5432/6379 despite the published host ports in the Compose file.

## Prerequisites

1. **OCI API signing key** — console → Profile → API Keys → Add API Key. Note the
   fingerprint and download the private key.
2. **Images built for arm64.** The A1 shape is `aarch64`. All base images
   (`node:20-alpine`, `postgres:16-alpine`, `redis:7-alpine`, `nginx:1.27-alpine`) are
   multi-arch, but the three app images must be built for the target platform:

   ```sh
   docker buildx build --platform linux/arm64 \
     -f apps/api/Dockerfile    -t ghcr.io/emirsalmandev/sentinel-api:latest    --push .
   docker buildx build --platform linux/arm64 \
     -f apps/worker/Dockerfile -t ghcr.io/emirsalmandev/sentinel-worker:latest --push .
   docker buildx build --platform linux/arm64 \
     -f apps/web/Dockerfile    -t ghcr.io/emirsalmandev/sentinel-web:latest    --push .
   ```

   Building on an x86 machine without `--platform linux/arm64` produces images the
   instance cannot run — the containers fail with `exec format error`.

## Usage

```sh
# 1. One-time: create the remote state bucket
cd infra/terraform/bootstrap
terraform init && terraform apply

# 2. Point prod at that bucket
#    Uncomment the backend block in environments/prod/backend.tf and paste in
#    the namespace from the bootstrap outputs.

# 3. Plan
cd ../environments/prod
cp terraform.tfvars.example terraform.tfvars   # then fill it in
terraform init
terraform plan
```

`terraform apply` is a deliberate manual step — run it yourself once the plan reads correctly.

## After apply

The stack is installed but **not running**. Cloud-init writes `/opt/sentinel/.env` with
empty placeholders and enables `sentinel.service` without starting it, so the Postgres
volume is never initialised with an empty password. Finish over SSH:

```sh
ssh ubuntu@<public_ip>
sudo vi /opt/sentinel/.env        # POSTGRES_PASSWORD, JWT_SECRET, COOKIE_SECRET,
                                  # and replace CHANGEME in DATABASE_URL
sudo docker login ghcr.io         # only if the GHCR package is private
sudo systemctl start sentinel
```

`sentinel.service` runs a preflight script that refuses to start while those keys are
blank or `DATABASE_URL` still says `CHANGEME`.

## Known simplifications

- **No state locking.** OCI has no free DynamoDB equivalent, and the S3 backend's
  `use_lockfile` needs conditional-write support the OCI compatibility layer lacks.
  Safe for a single operator; two concurrent applies can corrupt state. Bucket
  versioning (enabled in `bootstrap/`) is the recovery path.
- **No TLS yet.** nginx listens on 80 only. 443 is open in the security list so certbot
  can be run on the instance once DNS resolves; there is no free managed cert service on OCI.
- **Single instance, no HA.** Postgres and Redis are containers on one box with no managed
  backups. A boot volume backup policy is the next thing worth adding.
- **`Out of host capacity`** is the normal A1 failure. It is a capacity signal, not a config
  error — retry, or set `availability_domain` to a different AD.

## Deliberately out of scope

Managed Postgres/Redis (OCI's free Autonomous DB is Oracle DB, not Postgres — a migration,
not a lift-and-shift), Kubernetes/OKE, and multi-AZ autoscaling.
