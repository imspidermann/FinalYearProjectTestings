import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import dotenv from "dotenv";
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import cors from "cors";
import { handleCallConnection, handleFrontendConnection } from "./sessionManager";

dotenv.config();

const PORT = parseInt(process.env.PORT || "8081", 10);
const PUBLIC_URL = process.env.PUBLIC_URL || "";

const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new WebSocketServer({server});

app.use(express.urlencoded({ extended: false }));

const twimlPath = join(__dirname, "twiml.xml");
const twimlTemplate = readFileSync(twimlPath, "utf-8");

app.get("/public-url", (req, res) => {
  res.json({
    publicUrl: PUBLIC_URL
  })
});

app.all("/twiml", (req, res) => {
  // build ws url : public URL + /call
  const wsUrl = new URL(PUBLIC_URL);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `/call`;

  const twimlContent = twimlTemplate.replace("{{WS_URL}}", wsUrl.toString());
  res.type("text/xml").send(twimlContent);
});


//health check
app.get("/healthz", (req, res) => res.send("ok"));

// Websocket routing 
wss.on("connection", (ws : WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if(parts.length < 1){
    ws.close();
    return;
  }

  const type = parts[0];

  if(type === "call") {
    handleCallConnection(ws);
  } else if (type === "logs" || type === "fronted") {
    handleFrontendConnection(ws);
  } else {
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`TwiML endpoint: POST ${PUBLIC_URL || `http://localhost:${PORT}`}/twiml`);
});







