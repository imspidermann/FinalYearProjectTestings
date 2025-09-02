import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import cors from "cors";
import { readFileSync } from "fs";
import { join } from "path";
import { handleCallConnection, handleFrontendConnection } from "./session/sessionManager";

dotenv.config();
const PORT = parseInt(process.env.PORT || "8081", 10);
const PUBLIC_URL = process.env.PUBLIC_URL || "";

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const twimlPath = join(__dirname, "twiml.xml");
const twimlTemplate = readFileSync(twimlPath, "utf8");

app.get("/public-url", (req, res) => res.json({ publicUrl: PUBLIC_URL }));

app.all("/twiml", (req, res) => {
  const wsUrl = new URL(PUBLIC_URL);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `/call`;
  const content = twimlTemplate.replace("{{WS_URL}}", wsUrl.toString());
  res.type("text/xml").send(content);
});

// static frontend debug UI
app.use("/debug", express.static(join(__dirname, "frontend")));

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 1) {
    ws.close();
    return;
  }
  const type = parts[0];
  if (type === "call") {
    handleCallConnection(ws);
  } else if (type === "logs" || type === "frontend") {
    handleFrontendConnection(ws);
  } else {
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`TwiML endpoint: POST ${PUBLIC_URL || `http://localhost:${PORT}`}/twiml`);
  console.log(`Debug UI: ${PUBLIC_URL || `http://localhost:${PORT}`}/debug/debug.html`);
});