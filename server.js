
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
const conversations = new Map();

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

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({
      error: "La clé API Groq n'est pas configurée sur Render."
    });
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1"
    });

    const response = await client.chat.completions.create({
      model: "openai/gpt-oss-120b",messages: [
        {
          role: "system",
          content:
            "Tu es IZZY AI, un assistant intelligent, naturel, amical et honnête. Réponds dans la langue de l’utilisateur. Comprends le contexte de ses messages précédents lorsqu’il est disponible. Donne des réponses utiles, précises et faciles à comprendre. Pour les questions complexes, explique les choses étape par étape. Évite les répétitions et les longues introductions inutiles. Si tu ne connais pas une information ou si tu ne peux pas vérifier un fait récent, dis-le honnêtement. Ne prétends jamais avoir effectué une recherche sur Internet ou une action que tu n’as pas réellement effectuée."
        },
        {
          role: "user",
          content: message.trim()
        }
      ],
      max_tokens: 800
    });

    const reply = response.choices?.[0]?.message?.content;

    if (!reply) {
      return res.status(502).json({
        error: "IZZY AI n'a pas reçu de réponse valide."
      });
    }

    return res.json({ reply });
  } catch (error) {
    console.error("Erreur Groq:", error.status || "", error.message);

    if (error.status === 401) {
      return res.status(502).json({
        error: "La clé API Groq est invalide. Vérifie GROQ_API_KEY sur Render."
      });
    }

    if (error.status === 429) {
      return res.status(429).json({
        error: "La limite Groq est atteinte. Réessaie plus tard."
      });
    }

    return res.status(502).json({
      error: "IZZY AI rencontre un problème avec le service IA. Réessaie plus tard."
    });
  }
});

app.listen(port, () => {
  console.log(`IZZY AI server running on port ${port}`);
});
