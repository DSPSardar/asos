-- AlterTable
ALTER TABLE "leads" ADD COLUMN "product" TEXT;
CREATE INDEX "leads_tenant_id_product_idx" ON "leads"("tenant_id", "product");
