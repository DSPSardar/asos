-- Lead currency: BRL default -> PKR, and backfill the rows it produced.
--
-- 'BRL' was a leftover from the template ASOS was built from. No tenant is
-- Brazilian, so every BRL row is the default leaking through rather than a
-- real currency choice. 17 of them are CLOSED_WON with money attached, and
-- those were reported to the Meta Conversions API as Brazilian real —
-- roughly 50x the value of a rupee — which mispriced those conversions for
-- ad optimisation.
--
-- The real default now lives in tenant.settings.defaultCurrency
-- (see src/utils/currency.js); this column default is only the fallback for
-- rows written outside the service layer.

ALTER TABLE "leads" ALTER COLUMN "currency" SET DEFAULT 'PKR';

-- Only rewrite the untouched default. A tenant that has deliberately set some
-- other currency keeps it; this is deliberately not a blanket update.
UPDATE "leads" SET "currency" = 'PKR' WHERE "currency" = 'BRL';

-- Seed every existing tenant's explicit default so the setting is visible and
-- editable rather than relying on the code fallback. jsonb_set with the
-- create-missing flag leaves any tenant that already has one untouched.
UPDATE "tenants"
SET "settings" = jsonb_set(
      COALESCE("settings", '{}'::jsonb),
      '{defaultCurrency}',
      '"PKR"'::jsonb,
      true
    )
WHERE COALESCE("settings", '{}'::jsonb) -> 'defaultCurrency' IS NULL;
