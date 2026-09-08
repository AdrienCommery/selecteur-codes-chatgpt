import { readFileSync } from "node:fs";
import path from "node:path";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const rootDir = process.cwd();
const widgetHtml = readFileSync(path.join(rootDir, "public", "widget.html"), "utf8");
const commands = readFileSync(path.join(rootDir, "data", "commands_fr.jsonl"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .map((row) => ({
    id: row.id,
    code: row.code,
    page: row.page,
    categoryNumber: row.category_number,
    category: row.category_fr || row.category,
    categoryDescription: row.category_description_fr || "",
    description: row.description_fr || row.description,
  }));

const categories = Array.from(
  new Map(
    commands.map((command) => [
      command.categoryNumber,
      {
        value: String(command.categoryNumber),
        number: command.categoryNumber,
        name: command.category,
        description: command.categoryDescription,
        count: 0,
      },
    ])
  ).values()
)
  .map((category) => ({
    ...category,
    count: commands.filter((command) => command.categoryNumber === category.number).length,
  }))
  .sort((a, b) => a.number - b.number);

const TEMPLATE_URI = "ui://widget/command-picker/v1.html";
const MAX_RESULTS = 80;
const OPENAI_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_SIZE = "1024x1024";
const DEFAULT_IMAGE_QUALITY = "medium";

const commandSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  categoryNumber: z.number().int(),
  category: z.string(),
  description: z.string(),
});

const categorySchema = z.object({
  value: z.string(),
  number: z.number().int(),
  name: z.string(),
  description: z.string(),
  count: z.number().int(),
});

const catalogueOutputSchema = {
  categories: z.array(categorySchema),
  commands: z.array(commandSchema),
  totalCommands: z.number().int(),
  visibleCommands: z.number().int(),
  selectedCategory: z.string(),
  query: z.string(),
};

const pickerInputSchema = {
  category: z.string().optional().describe("Numéro de catégorie, ou all pour toutes les catégories."),
  query: z.string().max(160).optional().describe("Recherche libre dans le code, la catégorie et la description."),
  limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
};

const visualGenerationInputSchema = {
  commandCode: z.string().min(1),
  commandDescription: z.string().min(1),
  referenceImageBase64: z.string().min(1),
  referenceMimeType: z.string().min(1).optional(),
  referenceFileName: z.string().optional(),
  referenceRole: z.string().optional(),
  preserve: z.string().max(500).optional(),
  context: z.string().max(6000).optional(),
  goal: z.string().max(4000).optional(),
  tone: z.string().max(2000).optional(),
  format: z.string().max(500).optional(),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).optional(),
  quality: z.enum(["low", "medium", "high"]).optional(),
};

const visualGenerationOutputSchema = {
  ok: z.boolean(),
  message: z.string(),
  commandCode: z.string().optional(),
  imageDataUrl: z.string().optional(),
  promptUsed: z.string().optional(),
  model: z.string().optional(),
  size: z.string().optional(),
  quality: z.string().optional(),
};

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");

function findCommands({ category = "all", query = "", limit = MAX_RESULTS } = {}) {
  const selectedCategory = category || "all";
  const normalizedQuery = normalize(query).trim();
  const filtered = commands.filter((command) => {
    const categoryMatches = selectedCategory === "all" || String(command.categoryNumber) === String(selectedCategory);
    if (!categoryMatches) return false;
    if (!normalizedQuery) return true;
    return normalize(`${command.code} ${command.category} ${command.description}`).includes(normalizedQuery);
  });
  return {
    selectedCategory,
    query: String(query ?? "").trim(),
    matches: filtered,
    visible: filtered.slice(0, Math.min(limit, MAX_RESULTS)),
  };
}

function catalogueResult(filters, statusText) {
  const { selectedCategory, query, matches, visible } = findCommands(filters);
  return {
    structuredContent: {
      categories,
      commands: visible.map((command) => ({
        id: command.id,
        code: command.code,
        categoryNumber: command.categoryNumber,
        category: command.category,
        description: command.description,
      })),
      totalCommands: commands.length,
      visibleCommands: matches.length,
      selectedCategory,
      query,
    },
    content: [{ type: "text", text: statusText ?? `${matches.length} commande(s) correspondent aux filtres actuels.` }],
  };
}

function buildVisualPrompt({
  commandCode,
  commandDescription,
  referenceRole,
  preserve,
  context,
  goal,
  tone,
  format,
}) {
  const sections = [
    `Utilise la commande ${commandCode}.`,
    `Description de référence : ${commandDescription}`,
    `L'image fournie est la référence visuelle principale à utiliser comme ${referenceRole || "image principale à modifier"}.`,
    "N'utilise aucune autre image ou interface comme base visuelle.",
  ];

  if (preserve?.trim()) {
    sections.push(`Éléments à préserver impérativement : ${preserve.trim()}.`);
  }

  const optional = [
    ["Contexte / données", context],
    ["Résultat attendu", goal],
    ["Ton / contraintes", tone],
    ["Format de sortie", format],
  ];

  for (const [label, value] of optional) {
    if (value?.trim()) {
      sections.push(`${label} :\n${value.trim()}`);
    }
  }

  sections.push("Exécute directement la tâche demandée et réponds en français.");
  return sections.join("\n\n");
}

async function generateVisualWithOpenAI({
  referenceImageBase64,
  referenceMimeType,
  referenceFileName,
  size,
  quality,
  ...promptArgs
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("La variable OPENAI_API_KEY est absente du serveur Vercel.");
  }

  const prompt = buildVisualPrompt(promptArgs);
  const mimeType = /^image\//.test(referenceMimeType || "") ? referenceMimeType : "image/jpeg";
  const extension = mimeType.split("/")[1] === "jpeg" ? "jpg" : mimeType.split("/")[1] || "png";
  const fileName = referenceFileName || `reference.${extension}`;
  const imageBytes = Buffer.from(referenceImageBase64, "base64");
  const imageFile = new File([imageBytes], fileName, { type: mimeType });

  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("image[]", imageFile);
  form.append("prompt", prompt);
  form.append("size", size || DEFAULT_IMAGE_SIZE);
  form.append("quality", quality || DEFAULT_IMAGE_QUALITY);

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal: AbortSignal.timeout(180000),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Erreur OpenAI ${response.status}`;
    throw new Error(message);
  }

  const image = Array.isArray(payload?.data) ? payload.data[0] : null;
  const b64 = image?.b64_json;
  if (!b64) {
    throw new Error("Aucune image n’a été renvoyée par OpenAI.");
  }

  const outputMimeType = image?.mime_type || "image/png";
  return {
    imageDataUrl: `data:${outputMimeType};base64,${b64}`,
    promptUsed: image?.revised_prompt || prompt,
    model: OPENAI_IMAGE_MODEL,
    size: size || DEFAULT_IMAGE_SIZE,
    quality: quality || DEFAULT_IMAGE_QUALITY,
  };
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
};

const generativeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: false,
};

function createMcpServer() {
  const server = new McpServer(
    { name: "1000-commandes-gpt", version: "0.4.0" },
    {
      instructions:
        "Cette application est un sélecteur interactif de 1 000 commandes GPT en français. " +
        "Lorsque l’utilisateur sélectionne, active ou invoque cette application, appelle immédiatement " +
        "render_command_picker avec les filtres par défaut (category=all, query vide, limit=80) afin " +
        "d’afficher le sélecteur. Ne demande pas à l’utilisateur d’écrire une commande supplémentaire avant de l’afficher.",
    }
  );

  registerAppResource(server, "command-picker-widget-v1", TEMPLATE_URI, {}, async () => ({
    contents: [{
      uri: TEMPLATE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: widgetHtml,
      _meta: {
        ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
        "openai/widgetDescription": "Sélecteur français des 1 000 commandes GPT avec sélection explicite d’une image de référence et génération visuelle pilotée côté serveur OpenAI.",
        "openai/widgetPrefersBorder": true,
        "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
      },
    }],
  }));

  registerAppTool(server, "render_command_picker", {
    title: "Ouvrir le sélecteur de commandes GPT",
    description: "Affiche immédiatement le sélecteur interactif des 1 000 commandes GPT en français.",
    inputSchema: pickerInputSchema,
    outputSchema: catalogueOutputSchema,
    annotations: readOnlyAnnotations,
    _meta: {
      ui: { resourceUri: TEMPLATE_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": TEMPLATE_URI,
      "openai/toolInvocation/invoking": "Ouverture du catalogue…",
      "openai/toolInvocation/invoked": "Catalogue prêt",
      "openai/widgetAccessible": true,
    },
  }, async (args) => catalogueResult({ ...args, limit: args?.limit ?? MAX_RESULTS }, "Le sélecteur des commandes GPT est prêt."));

  registerAppTool(server, "search_commands", {
    title: "Rechercher dans les commandes GPT",
    description: "Recherche des commandes GPT françaises par catégorie, code ou description.",
    inputSchema: pickerInputSchema,
    outputSchema: catalogueOutputSchema,
    annotations: readOnlyAnnotations,
    _meta: {
      ui: { visibility: ["model", "app"] },
      "openai/toolInvocation/invoking": "Recherche dans le catalogue…",
      "openai/toolInvocation/invoked": "Résultats trouvés",
    },
  }, async (args) => catalogueResult(args));

  registerAppTool(server, "generate_visual_command", {
    title: "Générer un visuel à partir d’une image de référence",
    description: "Utilise l’image sélectionnée dans le widget comme référence native et génère le visuel via l’API OpenAI côté serveur.",
    inputSchema: visualGenerationInputSchema,
    outputSchema: visualGenerationOutputSchema,
    annotations: generativeAnnotations,
    _meta: {
      ui: { visibility: ["app"] },
      "openai/toolInvocation/invoking": "Génération du visuel…",
      "openai/toolInvocation/invoked": "Visuel généré",
      "openai/widgetAccessible": true
    },
  }, async (args) => {
    try {
      const result = await generateVisualWithOpenAI(args);
      return {
        structuredContent: {
          ok: true,
          message: "Visuel généré avec succès.",
          commandCode: args.commandCode,
          imageDataUrl: result.imageDataUrl,
          promptUsed: result.promptUsed,
          model: result.model,
          size: result.size,
          quality: result.quality,
        },
        content: [{ type: "text", text: "Visuel généré avec succès." }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue lors de la génération visuelle.";
      return {
        isError: true,
        structuredContent: {
          ok: false,
          message,
          commandCode: args.commandCode,
        },
        content: [{ type: "text", text: message }],
      };
    }
  });

  return server;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.url === "/" || req.url === "/api/index") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("1000 Commandes GPT MCP server");
    return;
  }

  if (!["POST", "GET", "DELETE"].includes(req.method || "")) {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("Erreur lors du traitement MCP :", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("Erreur interne du serveur");
    }
  }
}
