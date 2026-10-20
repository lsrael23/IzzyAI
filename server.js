
import express from "express";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));

const allowedOrigin = process.env.ALLOWED_ORIGIN;

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && origin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type"
    );
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

const requests = new Map();

app.get("/", (req, res) => {
  res.send("IZZY AI server is running!");
});

app.post("/chat", async (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const record = requests.get(ip);

  if (record && now - record.start < 60000 && record.count >= 10) {
    return res.status(429).json({
      error: "Trop de messages. Réessaie dans une minute."
    });
  }

  if (!record || now - record.start >= 60000) {
    requests.set(ip, { start: now, count: 1 });
  } else {
    record.count++;
  }

  const message = req.body?.message;

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      error: "Écris un message."
    });
  }

  if (message.length > 4000) {
    return res.status(400).json({
      error: "Message trop long."
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: "La clé IA n'est pas configurée."
    });
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions:
        "Tu es IZZY AI, un assistant amical, naturel, utile et honnête. Réponds dans la langue de l'utilisateur.",
      input: message.trim()
    });

    res.json({ reply: response.output_text });
  } catch (error) {
    console.error("Erreur IA:", error.message);
    res.status(500).json({
      error: "IZZY AI rencontre un problème. Réessaie plus tard."
    });
  }
});

app.listen(port, () => {
  console.log(`IZZY AI server running on port ${port}`);
});
