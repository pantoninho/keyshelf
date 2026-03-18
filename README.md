# keyshelf

A CLI config and secrets manager with pluggable backends. Define all your keys in a single `keyshelf.yaml` file, store secrets encrypted locally or in cloud secret managers, and inject them into your processes at runtime.

## Install

```bash
npm install -g keyshelf
```

Or from source:

```bash
git clone <repo-url> && cd keyshelf
npm install && npm run build
npm link
```

Requires Node.js 20+.

## Quick Start

```bash
# Initialize a project (generates an age keypair)
keyshelf init my-app

# Set a plaintext value
keyshelf set database/url postgres://localhost/db

# Set an encrypted secret (stored as ciphertext in keyshelf.yaml)
keyshelf set api/key s3cret --provider age

# Set a secret in AWS Secrets Manager for production
keyshelf set database/password hunter2 --env production --provider awssm

# Read a value back
keyshelf get api/key
keyshelf get database/password --env production

# Run a command with all keys injected as env vars
keyshelf run --env production -- node server.js

# Export keys as dotenv or JSON
keyshelf export --env production
keyshelf export --env production --format json
```

Key paths are converted to environment variables: `database/url` becomes `DATABASE_URL`, `api/secret-key` becomes `API_SECRET_KEY`.

## Configuration

`keyshelf.yaml` lives at the root of your project and is designed to be committed to version control:

```yaml
project: my-app
publicKey: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
pulumi:
  cwd: ./infra

keys:
  database/url:
    default: postgres://localhost/db
    staging: !awssm my-app/staging/database/url
    production: !awssm my-app/production/database/url

  api/key:
    default: !age |
      -----BEGIN AGE ENCRYPTED FILE-----
      YWdlLWVuY3J5cHRpb24...
      -----END AGE ENCRYPTED FILE-----

  cdn/endpoint:
    default: !pulumi prod.cdnEndpoint

  auth/token:
    production: !gcsm projects/my-gcp-project/secrets/my-app__production__auth__token
```

| Field       | Description                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------- |
| `project`   | Project name. Used as a prefix in cloud secret stores and to locate the age private key.     |
| `publicKey` | age public key (`age1...`). Required for the age provider.                                   |
| `pulumi`    | Optional. `cwd` points to the Pulumi project directory. Required for the `!pulumi` provider. |
| `keys`      | Map of key paths to environment-specific values.                                             |

### Values

- **Plain strings** — stored and returned as-is, no encryption. Useful for non-sensitive defaults.
- **Tagged values** — prefixed with a provider tag (`!age`, `!awssm`, `!gcsm`, `!pulumi`). Resolved at runtime by the corresponding provider.

### Environments

Each key can have values for any number of named environments, plus an optional `default` fallback. When resolving a key:

1. If an env-specific value exists, use it
2. Otherwise, fall back to `default`
3. Error if neither exists

Environment names are arbitrary strings — use whatever fits your workflow (`dev`, `staging`, `production`, `ci`, etc.).

## Providers

### `!age` — Local Encryption

Encrypts secrets with [age](https://age-encryption.org/) and stores the ciphertext directly in `keyshelf.yaml`. Uses a pure JavaScript implementation — no external tools needed.

- **Public key** — stored in `keyshelf.yaml`, used to encrypt. Anyone with the repo can add secrets.
- **Private key** — stored at `~/.config/keyshelf/<project>/key` (mode `0600`), never committed. Required to decrypt.

```bash
keyshelf set api/key s3cret --provider age
```

To onboard a team member or set up CI, share the private key through a secure channel and place it at the same path.

### `!awssm` — AWS Secrets Manager

Stores secrets in AWS Secrets Manager. Uses ambient AWS credentials (env vars, `~/.aws/credentials`, instance roles, etc.).

```bash
keyshelf set database/password hunter2 --env production --provider awssm
```

Secrets are named `<project>/<env>/<key>` (e.g., `my-app/production/database/password`).

### `!gcsm` — GCP Secret Manager

Stores secrets in Google Cloud Secret Manager. Uses Application Default Credentials. The GCP project is resolved from `GOOGLE_CLOUD_PROJECT` or `gcloud config get-value project`.

```bash
keyshelf set database/password hunter2 --env production --provider gcsm
```

Secret IDs use `__` as separators (e.g., `my-app__production__database__password`), so key paths must not contain `__`.

### `!pulumi` — Pulumi Stack Outputs (read-only)

Pulls values from Pulumi stack outputs. Requires the `pulumi` CLI on your PATH and a `pulumi.cwd` entry in your config.

```yaml
pulumi:
  cwd: ./infra

keys:
  api/endpoint:
    default: !pulumi prod.apiEndpoint
```

The reference format is `<stack>.<outputName>`. This provider is read-only — values are set through your Pulumi program, not through keyshelf.

## Commands

### `keyshelf init <project>`

Creates `keyshelf.yaml` and generates an age keypair.

- Stores the private key at `~/.config/keyshelf/<project>/key`
- Writes the public key into `keyshelf.yaml`

### `keyshelf set <key> [value]`

Sets a key's value. If `value` is omitted, reads from stdin.

| Flag         | Description                              | Default          |
| ------------ | ---------------------------------------- | ---------------- |
| `--env`      | Target environment                       | `default`        |
| `--provider` | Storage backend (`age`, `awssm`, `gcsm`) | none (plaintext) |

```bash
# Plaintext
keyshelf set database/url postgres://localhost/db

# Encrypted with age
keyshelf set api/key --provider age <<< "s3cret"

# Stored in AWS Secrets Manager
keyshelf set database/password hunter2 --env prod --provider awssm
```

### `keyshelf get <key>`

Resolves and prints a key's value to stdout.

| Flag    | Description        | Default   |
| ------- | ------------------ | --------- |
| `--env` | Target environment | `default` |

Falls back to the `default` environment if no env-specific value exists.

### `keyshelf run --env <env> -- <command...>`

Resolves all keys for the given environment and spawns the command with them as environment variables.

| Key path         | Env var          |
| ---------------- | ---------------- |
| `database/url`   | `DATABASE_URL`   |
| `api/secret-key` | `API_SECRET_KEY` |
| `app.port`       | `APP_PORT`       |

Exits with the subprocess's exit code.

```bash
keyshelf run --env production -- node server.js
keyshelf run --env staging -- docker compose up
```

### `keyshelf export --env <env>`

Resolves all keys and prints them to stdout.

| Flag       | Description                      | Default  |
| ---------- | -------------------------------- | -------- |
| `--format` | Output format (`dotenv`, `json`) | `dotenv` |

```bash
keyshelf export --env prod > .env
keyshelf export --env staging --format json | jq .
```

## Deployment Integrations

`keyshelf run` is the universal mechanism for injecting secrets at runtime. The patterns below show how to wire it into different deployment targets.

### Docker

Any Docker-based platform (Cloud Run, ECS, Kubernetes, Fly.io) works the same way — add keyshelf to your image and use it as the entrypoint:

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app .
RUN npm install -g keyshelf
ENTRYPOINT ["keyshelf", "run", "--env", "prod", "--"]
CMD ["node", "dist/server.js"]
```

`keyshelf.yaml` is already in the image (it's safe to commit). How you provide credentials depends on the provider:

- **`!awssm` / `!gcsm`** — The service's IAM role or service account handles auth. No extra configuration needed.
- **`!age`** — Mount the private key at runtime (see platform-specific examples below).

### Cloud Run

```bash
docker build -t gcr.io/my-project/my-app .
docker push gcr.io/my-project/my-app

gcloud run deploy my-app \
  --image gcr.io/my-project/my-app \
  --region us-central1
```

For `!gcsm`, the Cloud Run service account needs the `Secret Manager Secret Accessor` role.

For `!age`, mount the private key from GCP Secret Manager:

```bash
gcloud secrets create keyshelf-key --data-file=$HOME/.config/keyshelf/my-app/key

gcloud run deploy my-app \
  --image gcr.io/my-project/my-app \
  --set-secrets="/root/.config/keyshelf/my-app/key=keyshelf-key:latest"
```

### ECS / Fargate

Use keyshelf as the entrypoint in your task definition:

```json
{
  "containerDefinitions": [
    {
      "name": "my-app",
      "image": "123456789.dkr.ecr.us-east-1.amazonaws.com/my-app",
      "entryPoint": ["keyshelf", "run", "--env", "prod", "--"],
      "command": ["node", "dist/server.js"]
    }
  ]
}
```

The task execution role needs `secretsmanager:GetSecretValue` for `!awssm` references.

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: my-app
          image: my-app:latest
          command: ["keyshelf", "run", "--env", "prod", "--"]
          args: ["node", "dist/server.js"]
```

For `!age`, create a secret and mount it:

```yaml
volumes:
  - name: keyshelf-key
    secret:
      secretName: keyshelf-key
containers:
  - name: my-app
    volumeMounts:
      - name: keyshelf-key
        mountPath: /root/.config/keyshelf/my-app
        readOnly: true
```

### AWS Lambda

Lambda supports wrapping the runtime entrypoint via `AWS_LAMBDA_EXEC_WRAPPER`. This works for all Lambda runtimes (Node.js, Python, Go, Java).

#### 1. Create a wrapper script

```bash
#!/bin/bash
# keyshelf-wrapper
export $(keyshelf export --env "${KEYSHELF_ENV:-prod}" --format dotenv | xargs)
exec "$@"
```

#### 2. Package as a Lambda Layer

```bash
mkdir -p layer/bin
cp keyshelf-wrapper layer/bin/keyshelf-wrapper
chmod +x layer/bin/keyshelf-wrapper

# Include the keyshelf CLI
npm pack keyshelf
tar -xzf keyshelf-*.tgz -C layer/

cd layer && zip -r ../keyshelf-layer.zip .
aws lambda publish-layer-version \
  --layer-name keyshelf \
  --zip-file fileb://keyshelf-layer.zip \
  --compatible-runtimes nodejs20.x python3.12
```

#### 3. Attach the layer and configure

```bash
aws lambda update-function-configuration \
  --function-name my-function \
  --layers arn:aws:lambda:us-east-1:123456789:layer:keyshelf:1 \
  --environment "Variables={AWS_LAMBDA_EXEC_WRAPPER=/opt/bin/keyshelf-wrapper,KEYSHELF_ENV=prod}"
```

The Lambda execution role needs `secretsmanager:GetSecretValue` for `!awssm` references. Include `keyshelf.yaml` in your function's deployment package.

### CI/CD (deploy-time injection)

If you prefer not to run keyshelf at runtime, use `keyshelf export` in your CI pipeline to set environment variables at deploy time:

```bash
# AWS Lambda
keyshelf export --env prod --format json | \
  jq -c '.' | \
  xargs -I{} aws lambda update-function-configuration \
    --function-name my-function \
    --environment 'Variables={}'

# Cloud Run
keyshelf export --env prod --format dotenv > .env
gcloud run services update my-app --update-env-vars-file .env
rm .env

# Kubernetes
keyshelf export --env prod --format dotenv | \
  kubectl create secret generic my-app-secrets --from-env-file=/dev/stdin
```

This resolves secrets once at deploy time. Rotation requires a redeploy.

## Development

```bash
npm install            # install dependencies
npm run dev -- <args>  # run without building
npm test               # run tests
npm run build          # build to dist/
```

### E2E Tests

Cloud provider e2e tests are opt-in via environment variables:

```bash
KEYSHELF_AWS_E2E=1 npm test    # run AWS Secrets Manager e2e tests
KEYSHELF_GCP_E2E=1 npm test    # run GCP Secret Manager e2e tests
KEYSHELF_PULUMI_E2E=1 npm test # run Pulumi e2e tests
```
