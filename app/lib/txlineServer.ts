// Server-side TxLINE access for API routes. Auth state (guest JWT + API token)
// comes from env or the repo-root state file produced by scripts/e2e.ts.
import axios from "axios";
import * as fs from "fs";
import * as path from "path";

const API_BASE = process.env.TXLINE_API_BASE ?? "https://txline-dev.txodds.com/api";
const JWT_URL = process.env.TXLINE_JWT_URL ?? "https://txline-dev.txodds.com/auth/guest/start";

function loadState(): { jwt?: string; apiToken?: string } {
  if (process.env.TXLINE_JWT && process.env.TXLINE_API_TOKEN) {
    return { jwt: process.env.TXLINE_JWT, apiToken: process.env.TXLINE_API_TOKEN };
  }
  for (const p of [
    path.resolve(process.cwd(), "../.txline-devnet.json"),
    path.resolve(process.cwd(), ".txline-devnet.json"),
  ]) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* keep looking */ }
  }
  return {};
}

const state = loadState();

export const txline = axios.create({ baseURL: API_BASE, timeout: 25000 });
txline.interceptors.request.use(cfg => {
  if (state.jwt) cfg.headers["Authorization"] = `Bearer ${state.jwt}`;
  if (state.apiToken) cfg.headers["X-Api-Token"] = state.apiToken;
  return cfg;
});
txline.interceptors.response.use(r => r, async err => {
  if (err.response?.status === 401 && !err.config._retry) {
    err.config._retry = true;
    const r = await axios.post(JWT_URL);
    state.jwt = r.data.token;
    return txline(err.config);
  }
  throw err;
});
