-- ============================================================
-- Migration: Enforce one primary contact per customer
-- File: 20260528000001_customer_contacts_primary_unique.sql
-- Fix:
--   Add UNIQUE partial index on customer_contacts(customer_id)
--   WHERE is_primary = true — guarantees at most 1 primary
--   contact per customer at DB level, preventing race conditions
--   when multiple users concurrently set a contact as primary.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_contacts_one_primary
  ON public.customer_contacts (customer_id)
  WHERE (is_primary = true);
