#!/bin/bash
# Phase B: attach the configured build and submit for review.
cd ~/Agentpay/apps/power-cabinet
BUILD_NUMBER="$(node -p "require('./app.json').expo.ios.buildNumber")"
fastlane deliver \
  --api_key_path fastlane/asc_api_key.json \
  --app_identifier com.agentpay.powercabinet \
  --app_version 1.0.0 \
  --build_number "$BUILD_NUMBER" \
  --skip_binary_upload true \
  --skip_screenshots true \
  --skip_metadata true \
  --force true \
  --submit_for_review true \
  --automatic_release true \
  --run_precheck_before_submit false \
  --submission_information '{"export_compliance_uses_encryption": false, "add_id_info_uses_idfa": false}' 2>&1 | tail -40
