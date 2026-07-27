-- CreateTable: knowledge_gaps was added to schema.prisma but never got a migration,
-- causing every prisma.knowledgeGap.findMany() call to fail with "table does not exist".

CREATE TABLE "knowledge_gaps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "times_asked" INTEGER NOT NULL DEFAULT 1,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "example_lead" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_gaps_tenant_id_resolved_idx" ON "knowledge_gaps"("tenant_id", "resolved");

-- CreateIndex
CREATE INDEX "knowledge_gaps_tenant_id_created_at_idx" ON "knowledge_gaps"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
