-- 阶段14：门到门交通。手动 Ticket 保存在 PlanVersion.tickets JSON 中。
ALTER TABLE "PlanVersion" ADD COLUMN "tickets" TEXT NOT NULL DEFAULT '[]';
