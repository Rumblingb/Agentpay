-- Migration: add contact_email + contact_name to principal_payment_methods
-- Run once against Supabase Direct connection (port 5432)
-- These columns let charge-saved resolve the OTP recipient without a Stripe API call.

ALTER TABLE principal_payment_methods
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_name  text;

-- Back-fill from Stripe customer email is not possible here — the columns
-- will populate on the next checkout completion or confirm-setup call.
