
import express from "express";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));

const allowedOrigin = process.env.ALLOWED_ORIGIN;
const requests = new Map();
const conversations = new Map();

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && origin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

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
  const conversationId = req.body?.conversationId;

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Écris un message." });
  }

  if (message.length > 4000) {
    return res.status(400).json({ error: "Message trop long." });
  }

  if (
    typeof conversationId !== "string" ||
    conversationId.length < 1 ||
    conversationId.length > 100
  ) {
    return res.status(400).json({
      error: "Identifiant de conversation invalide. Actualise la page et réessaie."
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

    const history = conversations.get(conversationId) || [];
    let searchContext = "";

    if (
      /recherche|sur internet|sur le web|actualit[eé]s|aujourd'hui|aujourd’hui|dernier|dernière|récent|récente|météo|prix actuel|qui est actuellement/i.test(message)
    ) {
      try {
        const searchResponse = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query: message,
            search_depth: "basic",
            max_results: 5,
            include_answer: true
          })
        });

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          searchContext = JSON.stringify(searchData);
        }
      } catch (error) {
        console.error("Erreur recherche Web:", error.message);
      }
    }
    const response = await client.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content:
            "Tu es IZZY AI, un assistant intelligent, naturel, amical et honnête. Réponds dans la langue de l'utilisateur. Utilise le contexte des messages précédents disponibles. Donne des réponses utiles, précises et faciles à comprendre. Explique les sujets complexes étape par étape. Évite les répétitions. Si tu ne connais pas une information ou ne peux pas vérifier un fait récent, dis-le honnêtement. Ne prétends jamais avoir effectué une recherche ou une action que tu n'as pas réellement effectuée."
        },
        ...history,
        { role: "user", content: message.trim() }
      ],
      max_tokens: 800
    });

    const reply = response.choices?.[0]?.message?.content;

    if (!reply) {
      return res.status(502).json({
        error: "IZZY AI n'a pas reçu de réponse valide."
      });
    }

    const updatedHistory = [
      ...history,
      { role: "user", content: message.trim() },
      { role: "assistant", content: reply }
    ].slice(-20);

    conversations.set(conversationId, updatedHistory);

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
