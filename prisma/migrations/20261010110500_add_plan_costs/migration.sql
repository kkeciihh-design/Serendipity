-- 阶段09：预算。CostItem 保存在 PlanVersion.costs JSON 中。
ALTER TABLE "PlanVersion" ADD COLUMN "costs" TEXT NOT NULL DEFAULT '[]';
