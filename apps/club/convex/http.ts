import { httpRouter } from "convex/server";
import { GROK_CALLBACK_PATH } from "../lib/longitudinal/grokCallback.ts";
import { authComponent, createAuth } from "./auth";
import * as grokCompanyResearch from "./grokCompanyResearch";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({ path: GROK_CALLBACK_PATH, method: "POST", handler: grokCompanyResearch.post });
http.route({ path: GROK_CALLBACK_PATH, method: "GET", handler: grokCompanyResearch.get });

export default http;
