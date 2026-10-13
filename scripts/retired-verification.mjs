// Historical scenarios no longer match the current schema and access policy.
// Keep these old paths harmless for saved commands and documentation links.
export function retiredVerification(name) {
  console.error(`${name} 已停用：旧版演示和验收不再执行，也不会连接服务、写数据库或清理目录。`);
  console.error("请使用 npm test 运行当前离线单元/集成验收，或 npm run test:e2e 运行当前隔离浏览器验收。");
  console.error("这不表示历史阶段或真实外部服务已重新通过验收。");
  process.exitCode = 1;
}
