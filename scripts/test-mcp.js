/**
 * Test script for the Paper Summary MCP server.
 *
 * Usage:
 *   1. Start the server in another terminal:  npm run dev
 *   2. Run this script:                      node scripts/test-mcp.js
 *
 * No API keys or external API links are required. The server uses public
 * APIs (arXiv, CrossRef) and runs entirely on localhost.
 */

const path = require("path");
const { Client } = require("@modelcontextprotocol/sdk/client");
const { StreamableHTTPClientTransport } = require(path.join(
  __dirname,
  "..",
  "node_modules",
  "@modelcontextprotocol",
  "sdk",
  "dist",
  "cjs",
  "client",
  "streamableHttp.js"
));

const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:3000/mcp";

async function main() {
  console.log("Connecting to MCP server at", MCP_URL, "\n");

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  const client = new Client(
    { name: "paper-summary-test", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  // 1. List available tools
  const { tools } = await client.listTools();
  console.log("Available tools:", tools.map((t) => t.name).join(", "));

  // 2. Set a user profile
  const setProfile = await client.callTool({
    name: "set_user_profile",
    arguments: {
      userId: "test-user-1",
      fieldsOfStudy: ["ai", "ml"],
      educationLevel: "undergraduate",
      language: "en",
    },
  });
  console.log("\nset_user_profile result:", JSON.stringify(setProfile, null, 2).slice(0, 500) + "...");

  // 3. Fetch recent papers (may take a few seconds)
  console.log("\nFetching recent papers...");
  const papersResult = await client.callTool({
    name: "fetch_recent_papers",
    arguments: { userId: "test-user-1", maxResults: 5 },
  });
  const content = papersResult.content?.[0];
  const data = content?.type === "text" && content.text ? (() => { try { return JSON.parse(content.text); } catch { return null; } })() : null;
  if (data?.papers) {
    console.log("Papers found:", data.papers.length);
    data.papers.slice(0, 2).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.title?.slice(0, 60)}...`);
    });
  } else {
    console.log("fetch_recent_papers result:", JSON.stringify(papersResult, null, 2).slice(0, 600));
  }

  // 4. List supported languages
  const langResult = await client.callTool({
    name: "list_supported_languages",
    arguments: {},
  });
  const langContent = langResult.content?.[0];
  const langData = langContent?.type === "text" && langContent.text ? (() => { try { return JSON.parse(langContent.text); } catch { return langContent.text; } })() : langResult;
  console.log("\nlist_supported_languages:", JSON.stringify(langData, null, 2));

  await client.close();
  console.log("\nDone. Server is still running; start it with 'npm run dev' if you haven't.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  if (err.message?.includes("ECONNREFUSED")) {
    console.error("\nMake sure the MCP server is running in another terminal:  npm run dev");
  }
  process.exit(1);
});
