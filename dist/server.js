"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
// Load SDK server modules by path so Node resolves the correct .js at runtime
const sdkServerDir = path_1.default.join(__dirname, "..", "node_modules", "@modelcontextprotocol", "sdk", "dist", "cjs", "server");
const { McpServer } = require(path_1.default.join(sdkServerDir, "mcp.js"));
const { StreamableHTTPServerTransport } = require(path_1.default.join(sdkServerDir, "streamableHttp.js"));
const dayjs_1 = __importDefault(require("dayjs"));
const undici_1 = require("undici");
// --------- In-memory stores (replace with DB in production) ----------
const userProfiles = new Map();
const userReports = new Map();
// Very small example IF map. In a real app this would come from
// a regularly-updated data source like Journal Citation Reports.
const journalImpactFactors = {
    Nature: 64,
    Science: 56,
    Cell: 41,
    "Proceedings of the National Academy of Sciences": 12, // PNAS
    Lancet: 80,
    "New England Journal of Medicine": 90,
};
// Optional external APIs (leave blank or set via environment variables).
// If these are empty, the corresponding sources will be skipped.
const GOOGLE_SCHOLAR_API_BASE = process.env.GOOGLE_SCHOLAR_API_BASE || ""; // e.g. https://your-scholar-proxy.example.com
// Example mapping from generic field name to arXiv category query fragments.
const fieldToArxivCategory = {
    ai: ["cs.AI", "cs.LG"],
    ml: ["cs.LG", "stat.ML"],
    physics: ["physics.gen-ph"],
    math: ["math.GM"],
    biology: ["q-bio.*", "q-bio.BM"],
    bio: ["q-bio.*", "q-bio.BM"],
};
// --------- Helper functions ----------
async function fetchRecentArxivPapers(fieldsOfStudy, daysBack = 7) {
    const since = (0, dayjs_1.default)().subtract(daysBack, "day");
    const categories = new Set();
    for (const field of fieldsOfStudy) {
        const lower = field.toLowerCase();
        const mapped = fieldToArxivCategory[lower];
        if (mapped) {
            mapped.forEach((c) => categories.add(c));
        }
    }
    if (categories.size === 0) {
        // Fallback: just use cs.AI
        categories.add("cs.AI");
    }
    const categoryQuery = Array.from(categories)
        .map((c) => `cat:${c}`)
        .join(" OR ");
    // arXiv API (Atom feed)
    const searchQuery = encodeURIComponent(`${categoryQuery} AND submittedDate:[${since.format("YYYYMMDD")}0000 TO *]`);
    const url = `http://export.arxiv.org/api/query?search_query=${searchQuery}&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending`;
    const { body } = await (0, undici_1.request)(url);
    const xml = await body.text();
    // For brevity, do a very light-weight parse. For a production app,
    // use a full Atom parser like fast-xml-parser.
    const entries = xml.split("<entry>").slice(1);
    const papers = entries.map((entry) => {
        const getTag = (tag) => {
            const open = `<${tag}>`;
            const close = `</${tag}>`;
            const start = entry.indexOf(open);
            const end = entry.indexOf(close);
            if (start === -1 || end === -1)
                return "";
            return entry.substring(start + open.length, end).trim();
        };
        const id = getTag("id");
        const title = getTag("title").replace(/\s+/g, " ");
        const summary = getTag("summary").replace(/\s+/g, " ");
        const published = getTag("published");
        // Find first link with rel="alternate"
        let paperUrl = "";
        const linkMatch = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/);
        if (linkMatch) {
            paperUrl = linkMatch[1];
        }
        const authorNames = [];
        const authorBlocks = entry.match(/<author>[\s\S]*?<\/author>/g) ?? [];
        for (const block of authorBlocks) {
            const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/);
            if (nameMatch)
                authorNames.push(nameMatch[1].trim());
        }
        return {
            id,
            title,
            abstract: summary,
            url: paperUrl || id,
            source: "arxiv",
            publishedAt: published,
            authors: authorNames.length ? authorNames : undefined,
        };
    });
    return papers;
}
async function fetchRecentJournalPapers(fieldsOfStudy, daysBack = 7) {
    const since = (0, dayjs_1.default)().subtract(daysBack, "day").format("YYYY-MM-DD");
    const today = (0, dayjs_1.default)().format("YYYY-MM-DD");
    const highImpactJournals = Object.entries(journalImpactFactors)
        .filter(([, ifValue]) => ifValue > 3)
        .map(([name]) => name);
    if (highImpactJournals.length === 0)
        return [];
    // We will use CrossRef works API as an example.
    // See https://api.crossref.org/swagger-ui/index.html for details.
    const queryJournals = encodeURIComponent(highImpactJournals.join(" "));
    const queryFields = encodeURIComponent(fieldsOfStudy.join(" "));
    const url = `https://api.crossref.org/works?query=${queryFields}&filter=from-pub-date:${since},until-pub-date:${today},type:journal-article&rows=20&sort=published&order=desc`;
    const { body } = await (0, undici_1.request)(url, {
        headers: {
            "User-Agent": "paper-summary-mcp (mailto:example@example.com)",
        },
    });
    const json = await body.json();
    const items = json?.message?.items ?? [];
    const papers = items
        .map((item) => {
        const journal = (item["container-title"] && item["container-title"][0]) || "";
        const impactFactor = journalImpactFactors[journal];
        if (!impactFactor || impactFactor <= 3) {
            return null;
        }
        const title = (item.title && item.title[0]) || "";
        const doi = item.DOI;
        const paperUrl = item.URL || (doi ? `https://doi.org/${doi}` : "");
        const publishedDateParts = item["published-print"]?.["date-parts"]?.[0] || item["published-online"]?.["date-parts"]?.[0];
        const publishedAt = publishedDateParts
            ? (0, dayjs_1.default)(publishedDateParts.join("-")).toISOString()
            : "";
        const authors = item.author?.map((a) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean);
        return {
            id: doi || paperUrl || title,
            title,
            abstract: item.abstract ?? "",
            url: paperUrl,
            source: "journal",
            publishedAt,
            authors: authors?.length ? authors : undefined,
            journal,
            impactFactor,
            subjects: item.subject,
        };
    })
        .filter((p) => p !== null);
    return papers;
}
// OpenAlex: large, free index of scholarly works across many publishers.
// See https://docs.openalex.org/api-entities/works
async function fetchRecentOpenAlexPapers(fieldsOfStudy, daysBack = 7) {
    const since = (0, dayjs_1.default)().subtract(daysBack, "day").format("YYYY-MM-DD");
    const today = (0, dayjs_1.default)().format("YYYY-MM-DD");
    const search = encodeURIComponent(fieldsOfStudy.join(" "));
    const url = `https://api.openalex.org/works?search=${search}&filter=from_publication_date:${since},to_publication_date:${today}&sort=publication_date:desc&per-page=20`;
    const { body } = await (0, undici_1.request)(url);
    const json = await body.json();
    const results = json?.results ?? [];
    const papers = results.map((item) => {
        const id = item.id || item.doi || item.display_name;
        const title = item.display_name || "";
        const abstract = item.abstract_inverted_index
            ? Object.keys(item.abstract_inverted_index).join(" ")
            : "";
        const doi = item.doi;
        const url = doi ? `https://doi.org/${doi}` : item.primary_location?.source?.homepage_url || item.primary_location?.landing_page_url || "";
        const publishedAt = item.publication_date
            ? (0, dayjs_1.default)(item.publication_date).toISOString()
            : "";
        const journal = item.host_venue?.display_name || "";
        const authors = item.authorships?.map((a) => a.author?.display_name).filter(Boolean);
        return {
            id,
            title,
            abstract,
            url,
            source: "journal",
            publishedAt,
            authors: authors?.length ? authors : undefined,
            journal,
            impactFactor: undefined,
            subjects: item.concepts?.map((c) => c.display_name),
        };
    });
    return papers;
}
// PubMed via NCBI E-utilities (no key required, but you can optionally
// set NCBI_API_KEY in your environment to increase rate limits).
// Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/
async function fetchRecentPubMedPapers(fieldsOfStudy, daysBack = 7) {
    const since = (0, dayjs_1.default)().subtract(daysBack, "day").format("YYYY/MM/DD");
    const today = (0, dayjs_1.default)().format("YYYY/MM/DD");
    const term = encodeURIComponent(fieldsOfStudy.join(" "));
    const apiKey = process.env.NCBI_API_KEY;
    const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` +
        `?db=pubmed&term=${term}` +
        `&datetype=pdat&mindate=${since}&maxdate=${today}` +
        `&retmode=json&retmax=20` +
        (apiKey ? `&api_key=${apiKey}` : "");
    const searchResp = await (0, undici_1.request)(esearchUrl);
    const searchJson = (await searchResp.body.json());
    const ids = searchJson?.esearchresult?.idlist ?? [];
    if (!ids.length)
        return [];
    const idParam = ids.join(",");
    const esummaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` +
        `?db=pubmed&id=${idParam}&retmode=json` +
        (apiKey ? `&api_key=${apiKey}` : "");
    const summaryResp = await (0, undici_1.request)(esummaryUrl);
    const summaryJson = (await summaryResp.body.json());
    const result = summaryJson?.result ?? {};
    const papers = ids
        .map((id) => {
        const item = result[id];
        if (!item)
            return null;
        const title = item.title || "";
        const journal = item.fulljournalname || "";
        const pubdate = item.pubdate || "";
        const publishedAt = pubdate ? (0, dayjs_1.default)(pubdate).toISOString() : "";
        const paperUrl = `https://pubmed.ncbi.nlm.nih.gov/${id}/`;
        const abstract = ""; // PubMed abstract would require an additional efetch; omitted for brevity.
        const authors = item.authors?.map((a) => a.name ?? a).filter(Boolean);
        return {
            id,
            title,
            abstract,
            url: paperUrl,
            source: "journal",
            publishedAt,
            authors: authors?.length ? authors : undefined,
            journal,
            impactFactor: journalImpactFactors[journal],
            subjects: item.meshheadings,
        };
    })
        .filter((p) => p !== null);
    return papers;
}
// Google Scholar is not an official public API. If you have your own
// proxy or paid API, set GOOGLE_SCHOLAR_API_BASE to its base URL. If this
// is empty, the function will return no results and be skipped.
async function fetchRecentGoogleScholarPapers(fieldsOfStudy, daysBack = 7) {
    if (!GOOGLE_SCHOLAR_API_BASE) {
        return [];
    }
    const since = (0, dayjs_1.default)().subtract(daysBack, "day").format("YYYY-MM-DD");
    const today = (0, dayjs_1.default)().format("YYYY-MM-DD");
    const query = encodeURIComponent(fieldsOfStudy.join(" "));
    const url = `${GOOGLE_SCHOLAR_API_BASE}?q=${query}&from=${since}&to=${today}&limit=20`;
    const { body } = await (0, undici_1.request)(url);
    const json = (await body.json());
    // Expected generic shape:
    // { papers: [{ id, title, abstract, url, publishedAt, journal, subjects[] }, ...] }
    const items = json?.papers ?? [];
    const papers = items.map((item) => ({
        id: item.id || item.url || item.title,
        title: item.title || "",
        abstract: item.abstract || "",
        url: item.url || "",
        source: "journal",
        publishedAt: item.publishedAt || "",
        journal: item.journal || "",
        impactFactor: item.impactFactor,
        subjects: item.subjects,
    }));
    return papers;
}
/** Pick the one paper that best matches the user's selected fields (by keyword overlap in title + abstract). */
function pickBestMatchingPaper(papers, fieldsOfStudy) {
    if (papers.length === 0)
        return null;
    const keywords = fieldsOfStudy.map((f) => f.toLowerCase().trim()).filter(Boolean);
    if (keywords.length === 0)
        return papers[0];
    let best = papers[0];
    let bestScore = 0;
    for (const p of papers) {
        const text = `${(p.title || "")} ${(p.abstract || "")}`.toLowerCase();
        const score = keywords.reduce((acc, kw) => acc + (text.includes(kw) ? 1 : 0), 0);
        if (score > bestScore) {
            bestScore = score;
            best = p;
        }
    }
    return best;
}
// Demo: mock paper summary for a single focus paper.
function buildMockSummary(focusPaper) {
    if (!focusPaper)
        return "";
    return `Summary of the selected paper:\n\n${focusPaper.title}\n\n${(focusPaper.abstract || "").slice(0, 400)}…\n\nKey points (demo):\n• This paper best matches your selected interests.\n• Use an LLM (set OPENAI_API_KEY) for a real summary and key-point extraction.`;
}
function buildMockStructuredSummary(focusPaper) {
    if (!focusPaper)
        return null;
    return {
        summary: (focusPaper.abstract || focusPaper.title || "").slice(0, 500) + (focusPaper.abstract && focusPaper.abstract.length > 500 ? "…" : ""),
        keyPoints: ["This paper best matches your selected interests.", "Set OPENAI_API_KEY for real key-point extraction."],
        dataset: "Not specified (demo)",
        datasetUrl: "",
        methods: "See abstract (demo).",
    };
}
// Demo: mock report narrative for the focus paper by education level.
function buildMockReportByLevel(focusPaper, educationLevel, language) {
    const level = educationLevel.replace(/_/g, " ");
    if (!focusPaper)
        return `No paper to report for ${level} (${language}).`;
    const title = (focusPaper.title || "").slice(0, 80);
    const templates = {
        before_high_school: `Once upon a time, researchers wrote a paper that fits your interests! It's called: "${title}…" Imagine a short story that explains this discovery in simple words, with maybe a character who learns something new. (Demo; set OPENAI_API_KEY for a real story-style report.)`,
        high_school: `This week’s pick for you: "${title}…" Think of it like a magazine article—we’d explain the main idea with analogies and light technical terms. (Demo; use an LLM for a real report.)`,
        undergraduate: `Selected paper: "${title}…" A standard science explainer would summarize the aim, method, and main result. (Demo; use an LLM for a real summary.)`,
        master: `Focus paper: "${title}…" A master-level digest would add more technical detail and methodology. (Demo; use an LLM for a real report.)`,
        doctor: `Research-level focus: "${title}…" A PhD-level summary would be concise and assume research literacy. (Demo; use an LLM for a real report.)`,
        above_doctor: `Expert digest of: "${title}…" Assume deep expertise; keep it concise. (Demo; use an LLM for a real report.)`,
    };
    return templates[educationLevel] ?? templates.undergraduate;
}
// --------- LLM-based summary and report (optional: set OPENAI_API_KEY) ----------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
async function chatCompletion(messages) {
    if (!OPENAI_API_KEY)
        return "";
    const res = await (0, undici_1.request)("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            messages,
            max_tokens: 2000,
        }),
    });
    const raw = await res.body.json();
    if (res.statusCode !== 200) {
        const err = raw?.error?.message ?? JSON.stringify(raw);
        throw new Error(`OpenAI API: ${res.statusCode} ${err}`);
    }
    const content = raw?.choices?.[0]?.message?.content;
    if (typeof content !== "string")
        throw new Error("OpenAI API: no content in response");
    return content;
}
/** Build a structured summary (summary, key points, dataset, methods) for a single paper. */
async function buildStructuredSummaryWithLLM(focusPaper) {
    const input = `Title: ${focusPaper.title}\nAbstract: ${(focusPaper.abstract || "").slice(0, 2000)}`;
    const system = "You are a concise science writer. For the given paper, respond with a JSON object only (no markdown) with these keys: " +
        '"summary" (2 short paragraphs), "keyPoints" (array of 4-6 strings), "dataset" (short description of data used, or "Not specified"), "datasetUrl" (URL to dataset if mentioned, or empty string), "methods" (brief methods description).';
    const user = `Paper:\n\n${input}`;
    const raw = await chatCompletion([{ role: "system", content: system }, { role: "user", content: user }]);
    try {
        const parsed = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, "").trim());
        if (parsed && typeof parsed.summary === "string")
            return parsed;
    }
    catch {
        // fallback: return as plain summary
    }
    return null;
}
/** Build an education-level-specific report from the summary (for the selected level only). */
async function buildReportWithLLM(summary, educationLevel, language) {
    const level = educationLevel.replace(/_/g, " ");
    const system = `You write a short daily research report for a reader. Education level: ${level}. Language: ${language}. ` +
        `Adapt tone and depth: before_high_school = storytelling, simple, concrete; high_school = light technical, analogies; undergraduate = standard explainer; master/doctor = more technical; above_doctor = expert-level, concise. Output in ${language} only.`;
    const user = `Using this summary and key points, write a 1–2 paragraph "today's research" report suited to the ${level} level:\n\n${summary}`;
    return chatCompletion([{ role: "system", content: system }, { role: "user", content: user }]);
}
// --------- MCP server setup ----------
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "2mb" }));
// Serve static frontend assets
app.use(express_1.default.static(path_1.default.join(__dirname, "..", "public")));
// Simple REST endpoint the frontend can call to fetch recent papers
// without going through MCP client code.
app.post("/ui/generate", async (req, res) => {
    try {
        const { fieldsOfStudy, educationLevel, language, maxResults = 10, } = req.body ?? {};
        if (!Array.isArray(fieldsOfStudy) || fieldsOfStudy.length === 0) {
            res.status(400).json({ error: "fieldsOfStudy must be a non-empty array of strings." });
            return;
        }
        if (!educationLevel) {
            res.status(400).json({ error: "educationLevel is required." });
            return;
        }
        // Same fallback logic as the MCP tool: prefer last 7 days, but
        // widen to 30 days if nothing is found so the UI doesn't look empty.
        let [arxiv, journals, openAlex, pubmed, scholar] = await Promise.all([
            fetchRecentArxivPapers(fieldsOfStudy, 7),
            fetchRecentJournalPapers(fieldsOfStudy, 7),
            fetchRecentOpenAlexPapers(fieldsOfStudy, 7),
            fetchRecentPubMedPapers(fieldsOfStudy, 7),
            fetchRecentGoogleScholarPapers(fieldsOfStudy, 7),
        ]);
        let papers = [...arxiv, ...journals, ...openAlex, ...pubmed, ...scholar];
        if (papers.length === 0) {
            [arxiv, journals, openAlex, pubmed, scholar] = await Promise.all([
                fetchRecentArxivPapers(fieldsOfStudy, 30),
                fetchRecentJournalPapers(fieldsOfStudy, 30),
                fetchRecentOpenAlexPapers(fieldsOfStudy, 30),
                fetchRecentPubMedPapers(fieldsOfStudy, 30),
                fetchRecentGoogleScholarPapers(fieldsOfStudy, 30),
            ]);
            papers = [
                ...arxiv,
                ...journals,
                ...openAlex,
                ...pubmed,
                ...scholar,
            ];
        }
        papers = papers.slice(0, Math.min(maxResults, 50));
        // Summary and report focus on the one paper that best matches the user's selected interests.
        const focusPaper = papers.length > 0 ? (pickBestMatchingPaper(papers, fieldsOfStudy) ?? papers[0]) : null;
        let structuredSummary = focusPaper ? buildMockStructuredSummary(focusPaper) : null;
        let summary = focusPaper ? buildMockSummary(focusPaper) : "";
        let report = buildMockReportByLevel(focusPaper, educationLevel, language ?? "en");
        let summarySource = "mock";
        let reportSource = "mock";
        if (focusPaper && OPENAI_API_KEY) {
            try {
                const llmStructured = await buildStructuredSummaryWithLLM(focusPaper);
                if (llmStructured) {
                    structuredSummary = llmStructured;
                    summary = llmStructured.summary + "\n\nKey points:\n" + (llmStructured.keyPoints?.map((k) => "• " + k).join("\n") ?? "");
                    summarySource = "llm";
                    const llmReport = await buildReportWithLLM(summary, educationLevel, language ?? "en");
                    if (llmReport) {
                        report = llmReport;
                        reportSource = "llm";
                    }
                }
            }
            catch (err) {
                // eslint-disable-next-line no-console
                console.error("LLM summary/report failed, using mock:", err?.message);
            }
        }
        res.json({
            generatedAt: new Date().toISOString(),
            fieldsOfStudy,
            educationLevel,
            language: language ?? "en",
            papers,
            focusPaper: focusPaper ?? undefined,
            structuredSummary: structuredSummary ?? undefined,
            summary: summary || undefined,
            report: report || undefined,
            summarySource,
            reportSource,
        });
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error("Error in /ui/generate:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Related papers (same fields, any date in last 90 days) for the report card.
app.get("/ui/related-papers", async (req, res) => {
    try {
        const fieldsParam = req.query.fields;
        const fieldsOfStudy = typeof fieldsParam === "string" ? fieldsParam.split(",").map((f) => f.trim()).filter(Boolean) : [];
        const limit = Math.min(parseInt(String(req.query.limit || "5"), 10) || 5, 20);
        if (fieldsOfStudy.length === 0) {
            res.json({ papers: [] });
            return;
        }
        const [arxiv, journals, openAlex] = await Promise.all([
            fetchRecentArxivPapers(fieldsOfStudy, 90),
            fetchRecentJournalPapers(fieldsOfStudy, 90),
            fetchRecentOpenAlexPapers(fieldsOfStudy, 90),
        ]);
        const papers = [...arxiv, ...journals, ...openAlex].slice(0, limit);
        res.json({ papers });
    }
    catch (err) {
        console.error("Error in /ui/related-papers:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Trend in the field over the last month (LLM summary when OPENAI_API_KEY set).
app.post("/ui/trend", async (req, res) => {
    try {
        const { fieldsOfStudy, language = "en" } = req.body ?? {};
        if (!Array.isArray(fieldsOfStudy) || fieldsOfStudy.length === 0) {
            res.status(400).json({ error: "fieldsOfStudy required." });
            return;
        }
        const [arxiv, journals, openAlex] = await Promise.all([
            fetchRecentArxivPapers(fieldsOfStudy, 30),
            fetchRecentJournalPapers(fieldsOfStudy, 30),
            fetchRecentOpenAlexPapers(fieldsOfStudy, 30),
        ]);
        const papers = [...arxiv, ...journals, ...openAlex].slice(0, 25);
        if (papers.length === 0) {
            res.json({ trend: "No recent papers in this field in the last month.", source: "mock" });
            return;
        }
        const titles = papers.map((p) => p.title).join("\n• ");
        if (!OPENAI_API_KEY) {
            res.json({ trend: `Last 30 days: ${papers.length} papers. Topics include: ${titles.slice(0, 400)}… Set OPENAI_API_KEY for a narrative trend summary.`, source: "mock" });
            return;
        }
        const system = `You are a science analyst. In ${language}, write a short paragraph summarizing the trend and main themes in this field over the last month. Use plain text.`;
        const user = `Paper titles from the last 30 days:\n• ${titles}`;
        const trend = await chatCompletion([{ role: "system", content: system }, { role: "user", content: user }]);
        res.json({ trend: trend || "", source: "llm" });
    }
    catch (err) {
        console.error("Error in /ui/trend:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Q&A about the report; optional terminology/concept links (LLM returns markdown).
app.post("/ui/ask", async (req, res) => {
    try {
        const { reportContext, question } = req.body ?? {};
        if (!reportContext || !question) {
            res.status(400).json({ error: "reportContext and question required." });
            return;
        }
        if (!OPENAI_API_KEY) {
            res.json({ answer: "Set OPENAI_API_KEY to enable Q&A about the report." });
            return;
        }
        const system = "You answer questions about a research report. Be concise. When mentioning important terms or concepts, use markdown links when helpful, e.g. [concept](https://en.wikipedia.org/wiki/Concept).";
        const user = `Report:\n${reportContext}\n\nQuestion: ${question}`;
        const answer = await chatCompletion([{ role: "system", content: system }, { role: "user", content: user }]);
        res.json({ answer: answer || "" });
    }
    catch (err) {
        console.error("Error in /ui/ask:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
app.post("/mcp", async (req, res) => {
    const server = new McpServer({
        name: "paper-summary-mcp",
        version: "0.1.0",
    });
    // --- Tool: set_user_profile ---
    server.registerTool("set_user_profile", {
        title: "Set or update a user's profile and preferences",
        description: "Stores the user's fields of study, education level, and preferred language so that later tools can fetch and summarize relevant papers.",
        inputSchema: zod_1.z.object({
            userId: zod_1.z.string().min(1),
            fieldsOfStudy: zod_1.z.array(zod_1.z.string()).min(1),
            educationLevel: zod_1.z.enum([
                "before_high_school",
                "high_school",
                "undergraduate",
                "master",
                "doctor",
                "above_doctor",
            ]),
            language: zod_1.z.string().default("en"),
        }),
    }, async ({ userId, fieldsOfStudy, educationLevel, language, }) => {
        const profile = {
            userId,
            fieldsOfStudy,
            educationLevel,
            language,
        };
        userProfiles.set(userId, profile);
        return {
            content: [
                {
                    type: "text",
                    text: `Profile saved for user ${userId}. Fields: ${fieldsOfStudy.join(", ")}. Level: ${educationLevel}. Language: ${language}.`,
                },
            ],
        };
    });
    // --- Tool: fetch_recent_papers ---
    server.registerTool("fetch_recent_papers", {
        title: "Fetch recent papers for a user",
        description: "Fetches papers from arXiv and high-impact journals (>3 impact factor) from the last week, based on the user's saved fields of study.",
        inputSchema: zod_1.z.object({
            userId: zod_1.z.string().min(1),
            maxResults: zod_1.z.number().int().positive().max(50).default(20),
        }),
    }, async ({ userId, maxResults, }) => {
        const profile = userProfiles.get(userId);
        if (!profile) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No profile found for user ${userId}. Call set_user_profile first.`,
                    },
                ],
                isError: true,
            };
        }
        // First try strict \"last 7 days\" window
        let [arxiv, journals, openAlex, pubmed, scholar] = await Promise.all([
            fetchRecentArxivPapers(profile.fieldsOfStudy, 7),
            fetchRecentJournalPapers(profile.fieldsOfStudy, 7),
            fetchRecentOpenAlexPapers(profile.fieldsOfStudy, 7),
            fetchRecentPubMedPapers(profile.fieldsOfStudy, 7),
            fetchRecentGoogleScholarPapers(profile.fieldsOfStudy, 7),
        ]);
        let combined = [...arxiv, ...journals, ...openAlex, ...pubmed, ...scholar];
        // If nothing found, fall back to a 30‑day window so the user
        // still sees something even when the last week is quiet or
        // category filters are too strict.
        if (combined.length === 0) {
            [arxiv, journals, openAlex, pubmed, scholar] = await Promise.all([
                fetchRecentArxivPapers(profile.fieldsOfStudy, 30),
                fetchRecentJournalPapers(profile.fieldsOfStudy, 30),
                fetchRecentOpenAlexPapers(profile.fieldsOfStudy, 30),
                fetchRecentPubMedPapers(profile.fieldsOfStudy, 30),
                fetchRecentGoogleScholarPapers(profile.fieldsOfStudy, 30),
            ]);
            combined = [
                ...arxiv,
                ...journals,
                ...openAlex,
                ...pubmed,
                ...scholar,
            ];
        }
        combined = combined.slice(0, maxResults);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        userId,
                        generatedAt: new Date().toISOString(),
                        papers: combined,
                    }),
                },
            ],
        };
    });
    // --- Tool: save_user_report ---
    server.registerTool("save_user_report", {
        title: "Store a generated report for a user",
        description: "Saves the model-generated summary and optional education-level narratives so the app can show them later, and use them for interactive Q&A.",
        inputSchema: zod_1.z.object({
            userId: zod_1.z.string().min(1),
            language: zod_1.z.string().default("en"),
            rawSummary: zod_1.z.string().min(1),
            narrativeByEducationLevel: zod_1.z
                .record(zod_1.z.enum([
                "before_high_school",
                "high_school",
                "undergraduate",
                "master",
                "doctor",
                "above_doctor",
            ]), zod_1.z.string().min(1))
                .optional(),
        }),
    }, async ({ userId, language, rawSummary, narrativeByEducationLevel, }) => {
        const report = {
            userId,
            createdAt: new Date().toISOString(),
            language,
            rawSummary,
            narrativeByEducationLevel: narrativeByEducationLevel ?? {},
        };
        userReports.set(userId, report);
        return {
            content: [
                {
                    type: "text",
                    text: `Report stored for user ${userId} at ${report.createdAt}.`,
                },
            ],
        };
    });
    // --- Tool: get_user_report ---
    server.registerTool("get_user_report", {
        title: "Get the latest stored report for a user",
        description: "Returns the last report saved for this user so that the app or model can support interactive Q&A and show the story-style narrative.",
        inputSchema: zod_1.z.object({
            userId: zod_1.z.string().min(1),
        }),
    }, async ({ userId }) => {
        const report = userReports.get(userId);
        if (!report) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No report found for user ${userId}.`,
                    },
                ],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(report),
                },
            ],
        };
    });
    // --- Tool: list_supported_languages ---
    server.registerTool("list_supported_languages", {
        title: "List supported language codes for reports",
        description: "Returns language codes that the host model should support when generating summaries and reports. The host model is responsible for actual translation.",
        inputSchema: zod_1.z.object({}),
    }, async () => {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        languages: ["en", "zh", "es", "fr", "de", "ja", "ko"],
                    }),
                },
            ],
        };
    });
    // --- Transport wiring ---
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
app.listen(Number(PORT), HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`MCP server listening on http://localhost:${PORT}/mcp`);
    if (HOST === "0.0.0.0") {
        // eslint-disable-next-line no-console
        console.log(`App (for phone/laptop): http://<this-machine-ip>:${PORT}/`);
    }
});
