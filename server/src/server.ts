import "dotenv/config";
import { buildApp } from "./app";
import { runMonitorTick } from "./collectors/monitor";

const port = Number(process.env.PORT ?? 3001);

buildApp()
  .then((app) => app.listen({ port, host: "0.0.0.0" }))
  .then(() => {
    console.log(`autocomply API listening on :${port}`);
    // Continuous-monitoring scheduler (opt-in via env). Real deploys would use cron;
    // this in-process interval is enough for self-hosted single-org.
    const ms = Number(process.env.MONITOR_INTERVAL_MS ?? 0);
    if (ms > 0) {
      console.log(`monitor scheduler on: every ${ms}ms`);
      setInterval(() => {
        runMonitorTick()
          .then((n) => n > 0 && console.log(`[monitor] ${n} drift event(s)`))
          .catch((e) => console.error("[monitor]", e));
      }, ms);
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
