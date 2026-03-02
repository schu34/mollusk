import { Probot } from "probot";
import { registerHandlers } from "./events/handlers.js";
import { startWorker } from "./queue/worker.js";

export default (app: Probot) => {
  registerHandlers(app);
  startWorker(app);
};
