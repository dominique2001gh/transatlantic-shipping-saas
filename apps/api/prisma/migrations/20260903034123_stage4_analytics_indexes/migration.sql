-- Stage 4: additive, index-only migration for Owner/Manager Analytics.
-- No column added/removed/retyped, no default changed, no table created
-- or dropped, no data touched — CREATE INDEX only.

-- CreateIndex
CREATE INDEX "customers_tenantId_createdAt_idx" ON "customers"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "shipments_tenantId_createdAt_idx" ON "shipments"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_tenantId_status_idx" ON "invoices"("tenantId", "status");

-- CreateIndex
CREATE INDEX "invoices_tenantId_dueDate_idx" ON "invoices"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "payments_tenantId_status_paidAt_idx" ON "payments"("tenantId", "status", "paidAt");

-- CreateIndex
CREATE INDEX "payments_tenantId_customerId_idx" ON "payments"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "operational_exceptions_tenantId_createdAt_idx" ON "operational_exceptions"("tenantId", "createdAt");
