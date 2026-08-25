-- dsp_phase_changed automations keyed off leads.updated_at, which any update
-- bumps — a roster re-import would have looked like every student changing
-- phase at once. This column is stamped only when importStudents sees the
-- phase actually move; it stays NULL for existing rows on purpose.

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "dsp_phase_changed_at" TIMESTAMP(3);

