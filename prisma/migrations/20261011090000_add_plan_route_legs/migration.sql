-- 阶段13：城市路线。RouteLeg 保存在 PlanVersion.routeLegs JSON 中。
ALTER TABLE "PlanVersion" ADD COLUMN "routeLegs" TEXT NOT NULL DEFAULT '[]';
