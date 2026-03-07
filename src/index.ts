import { Probot } from "probot";
import { initApp } from "./app.js";
import { registerHandlers } from "./events/handlers.js";
import { startWorker } from "./queue/worker.js";

export default (app: Probot) => {
  initApp(app);
  registerHandlers();
  startWorker();
};
