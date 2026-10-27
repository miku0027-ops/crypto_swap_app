#!/usr/bin/env bash
# Deploy the existing Firebase/Cloud Run architecture after the one-time provisioning
# documented in docs/BACKEND.md. Never stores, requests, or prints credentials.
set -euo pipefail

readonly PROJECT='hoplane-b9ac1'
readonly REGION='asia-south1'
readonly SERVICE='hoplane-api'
readonly RUNTIME="hoplane-runtime@${PROJECT}.iam.gserviceaccount.com"
readonly ORIGIN="https://${PROJECT}.web.app"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail() { printf '%s\n' "$*" >&2; exit 1; }
for tool in node npm gcloud firebase curl jq; do
  command -v "$tool" >/dev/null || fail "Missing ${tool}. Use Node 24, Google Cloud CLI and Firebase CLI; see docs/BACKEND.md."
done
[[ "$(node -p 'process.versions.node.split(".")[0]')" == '24' ]] || fail 'Node.js 24 is required.'
[[ "$(node -p 'JSON.parse(require("fs").readFileSync(".firebaserc", "utf8")).projects.default')" == "$PROJECT" ]] || fail 'Firebase project does not match the fixed deployment target.'
[[ -z "${VITE_API_BASE_URL:-}" || "${VITE_API_BASE_URL}" == '/api' ]] || fail 'Firebase deployment requires the same-origin /api backend.'
for file in .env .env.local .env.production .env.production.local; do
  if [[ -f "$file" ]] && grep -Eq '^[[:space:]]*VITE_API_BASE_URL[[:space:]]*=' "$file"; then
    fail "Remove the API URL override from ${file}; this deployment uses same-origin /api."
  fi
done

printf '%s\n' "Checking authenticated access to ${PROJECT} (no cloud writes yet)…"
gcloud projects describe "$PROJECT" --format='value(projectId)' >/dev/null || fail 'Google Cloud authentication or project access failed. Reconnect the deployment identity.'
[[ "$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)')" == 'True' ]] || fail 'An enabled billing account (Firebase Blaze) is required for the Cloud Run backend.'
firebase hosting:sites:list --project="$PROJECT" --non-interactive >/dev/null || fail 'Firebase Hosting authentication or project access failed.'

enabled="$(gcloud services list --project="$PROJECT" --enabled --format='value(config.name)')"
for api in run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com firebasehosting.googleapis.com firebaserules.googleapis.com; do
  [[ $'\n'"$enabled"$'\n' == *$'\n'"$api"$'\n'* ]] || fail "Enable ${api} using the one-time provisioning guide in docs/BACKEND.md."
done
[[ "$(gcloud firestore databases describe --database='(default)' --project="$PROJECT" --format='value(type)')" == 'FIRESTORE_NATIVE' ]] || fail 'The default Native-mode Firestore database is required; see the provisioning guide.'
gcloud artifacts repositories describe hoplane --location="$REGION" --project="$PROJECT" >/dev/null || fail 'Provision the hoplane Docker repository first; see docs/BACKEND.md.'
gcloud iam service-accounts describe "$RUNTIME" --project="$PROJECT" >/dev/null || fail 'Provision the runtime identity and its Firestore role first; see docs/BACKEND.md.'

build_flags=()
if [[ -n "${HOPLANE_BUILD_SERVICE_ACCOUNT:-}" ]]; then
  [[ "$HOPLANE_BUILD_SERVICE_ACCOUNT" =~ ^[a-z][a-z0-9-]*@hoplane-b9ac1\.iam\.gserviceaccount\.com$ ]] || fail 'Build identity must belong to hoplane-b9ac1.'
  build_flags+=("--service-account=projects/${PROJECT}/serviceAccounts/${HOPLANE_BUILD_SERVICE_ACCOUNT}")
fi

printf '%s\n' 'Building the frontend and compiling the backend…'
npm ci
npm run typecheck
npm run build

printf '%s\n' 'Deploying Firestore rules/indexes and TTL policies…'
firebase deploy --project="$PROJECT" --only firestore:rules,firestore:indexes --non-interactive
for collection in hoplane_auth_challenges hoplane_sessions hoplane_rate_limits hoplane_quotes hoplane_transfers; do
  gcloud firestore fields ttls update ttl --project="$PROJECT" --database='(default)' --collection-group="$collection" --enable-ttl --quiet
done
indexes="$(gcloud firestore indexes composite list --database='(default)' --project="$PROJECT" --format=json)"
printf '%s' "$indexes" | jq -e 'any(.[]; (.name | contains("/collectionGroups/hoplane_transfers/")) and .state == "READY" and any(.fields[]; .fieldPath == "owner" and .order == "ASCENDING") and any(.fields[]; .fieldPath == "createdAt" and .order == "DESCENDING"))' >/dev/null || fail 'The transfer index is still building. Wait until it is READY, then rerun this command.'

printf '%s\n' 'Building and testing the production container in Cloud Build…'
build_id="$(gcloud builds submit . --project="$PROJECT" --config=cloudbuild.yaml --substitutions="_EXPECTED_PROJECT_ID=${PROJECT},_REGION=${REGION},_REPOSITORY=hoplane" "${build_flags[@]}" --async --format='value(id)')"
[[ "$build_id" =~ ^[a-zA-Z0-9-]+$ ]] || fail 'Cloud Build did not return a valid build ID.'
gcloud builds log "$build_id" --project="$PROJECT" --stream
[[ "$(gcloud builds describe "$build_id" --project="$PROJECT" --format='value(status)')" == 'SUCCESS' ]] || fail 'Cloud Build failed. Hosting has not been changed.'
digest="$(gcloud builds describe "$build_id" --project="$PROJECT" --format='value(results.images[0].digest)')"
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Cloud Build did not return an immutable image digest.'
readonly IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/hoplane/hoplane-api@${digest}"

printf '%s\n' 'Deploying the API with mainnet and fund execution disabled…'
gcloud run deploy "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --image="$IMAGE" --service-account="$RUNTIME" \
  --env-vars-file=deploy/cloudrun.firebase.yaml \
  --port=8080 --memory=512Mi --cpu=1 --min-instances=0 --max-instances=3 \
  --concurrency=40 --timeout=60s --allow-unauthenticated --quiet \
  --startup-probe='httpGet.path=/api/ready,httpGet.port=8080,initialDelaySeconds=0,periodSeconds=10,timeoutSeconds=5,failureThreshold=12' \
  --liveness-probe='httpGet.path=/api/health,httpGet.port=8080,periodSeconds=30,timeoutSeconds=5,failureThreshold=3'

printf '%s\n' 'Publishing Firebase Hosting with the same-origin API rewrite…'
firebase deploy --project="$PROJECT" --only hosting --non-interactive

printf '%s\n' 'Checking the published website and API…'
html="$(curl --fail --silent --show-error --max-time 60 "$ORIGIN/")"
[[ "$html" == *'<html'* ]] || fail 'Hosting did not return the application HTML.'
curl --fail --silent --show-error --max-time 60 "$ORIGIN/api/health" | jq -e '.status == "ok" and .service == "hoplane-api"' >/dev/null
curl --fail --silent --show-error --max-time 60 "$ORIGIN/api/ready" | jq -e '.status == "ready" and .capabilities.storage == "firestore" and .capabilities.execution == false' >/dev/null
curl --fail --silent --show-error --max-time 60 "$ORIGIN/api/config" | jq -e '.capabilities.sync == true and .capabilities.execution == false and (.networks.mainnet | length) == 0' >/dev/null
printf 'Deployed: %s\nImage: %s\n' "$ORIGIN" "$IMAGE"
