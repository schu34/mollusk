import { Probot } from "probot";
import { registerHandlers } from "./events/handlers.js";

export default (app: Probot) => {
  registerHandlers(app);
};
