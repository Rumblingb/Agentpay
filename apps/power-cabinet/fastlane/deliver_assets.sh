#!/bin/bash
# Phase A: push metadata + screenshots to the 1.0.0 App Store version (no review submit)
cd ~/Agentpay/apps/power-cabinet
fastlane deliver \
  --api_key_path fastlane/asc_api_key.json \
  --app_identifier com.agentpay.powercabinet \
  --app_version 1.0.0 \
  --screenshots_path fastlane/screenshots \
  --metadata_path fastlane/metadata \
  --skip_binary_upload true \
  --overwrite_screenshots true \
  --force true \
  --submit_for_review false \
  --run_precheck_before_submit false \
  --precheck_include_in_app_purchases false 2>&1 | tail -40
