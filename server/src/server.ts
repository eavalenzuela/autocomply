import "dotenv/config";
import { buildApp } from "./app";
import { runMonitorTick } from "./collectors/monitor";
import { exportCatalogToFile } from "./catalog";

const port = Number(process.env.PORT ?? 3001);
const CATALOG_DEFAULT_INTERVAL_MS = 6 * 3600 * 1000; // 6h

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

    // Scheduled catalog export to a file (opt-in via CATALOG_EXPORT_PATH) so an
    // external syncer can pick it up; runs once on boot then on an interval.
    const catalogPath = process.env.CATALOG_EXPORT_PATH;
    if (catalogPath) {
      const cms = Number(process.env.CATALOG_EXPORT_INTERVAL_MS ?? CATALOG_DEFAULT_INTERVAL_MS);
      const runExport = () =>
        exportCatalogToFile(catalogPath, new Date().toISOString())
          .then((r) => console.log(`[catalog] exported ${r.frameworks} fw / ${r.controls} controls → ${catalogPath}`))
          .catch((e) => console.error("[catalog]", e));
      console.log(`catalog export scheduler on: ${catalogPath} every ${cms}ms`);
      runExport();
      if (cms > 0) setInterval(runExport, cms);
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
