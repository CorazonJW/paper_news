## Paper summary MCP backend

This project is an MCP-based backend for a multi-user, multi-language "research news" application similar to the iOS News app, but for scientific papers.

### What this backend does

- **User preferences**: Stores each user's fields of study, education level, and preferred language via the `set_user_profile` MCP tool.
- **Paper retrieval (last week)**: Aggregates papers from multiple sources:
  - **arXiv** (preprints, by category).
  - **CrossRef** (journal articles, filtered so that only journals with **impact factor > 3** are returned).
  - **OpenAlex** (large, open index of scholarly works).
  - **PubMed** (via NCBI E-utilities).
  - **Google Scholar** (optional – wired via a configurable API base URL you provide).
- **Report storage**: Provides tools to store and retrieve per-user reports so the host model/app can support:
  - Age/education-level appropriate story-style narratives (e.g. for pre-high-school users).
  - Interactive Q&A about the latest report.
- **Multi-user, multi-session**: All tools are keyed by `userId`, so many users and sessions can share one server.
- **Multi-language**: Exposes supported language codes; the host LLM is responsible for actual translation and tone adaptation.

### Running the MCP HTTP server

1. **Install dependencies**

```bash
npm install
```

> **Note:** This app uses `@modelcontextprotocol/sdk` (the unified MCP TypeScript package). If you see `404` for `@modelcontextprotocol/server`, that package is not published; use the SDK instead. If npm reports "Access token expired or revoked", run `npm logout` unless you use a private registry.

2. **Start in dev mode**

```bash
npm run dev
```

The MCP endpoint will be available at:

```text
POST http://localhost:3000/mcp
```

### Use as an app on your phone (no laptop needed)

To open Paper Story on your phone like an app **without running anything on your laptop**, deploy it to the cloud once. You get a permanent URL; open it on your phone and add it to the home screen. After that, the app works anytime from your phone.

**Deploy to Render (free tier, ~5 min)**

1. **Push this project to GitHub** (if it isn’t already):
   - Create a repo on [github.com](https://github.com/new), then:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

2. **Deploy on Render**
   - Go to [render.com](https://render.com) and sign up (free).
   - **New → Web Service**.
   - Connect your GitHub account and select this repository.
   - Render will detect Node and use `npm start`. If not, set:
     - **Build command:** `npm install && npm run build`
     - **Start command:** `npm start`
   - (Optional) In **Environment**, add `OPENAI_API_KEY` if you want real summaries and Q&A.
   - Click **Create Web Service**. Wait for the first deploy to finish.

3. **Use it on your phone**
   - Copy your app URL (e.g. `https://paper-story-xxxx.onrender.com`).
   - On your phone, open that URL in Safari (iPhone) or Chrome (Android).
   - **Add to Home Screen:** Safari → Share → **Add to Home Screen** (iPhone); Chrome → menu → **Add to Home screen** or **Install app** (Android).
   - Open the new icon anytime. No laptop or tunnel needed.

**Note:** On Render’s free tier, the app may “spin down” after 15 minutes of no use; the first open after that can take 30–60 seconds to wake up. Paid plans keep it always on.

---

### Install on your phone (with your laptop running – tunnel)

If your laptop firewall blocks incoming connections, your phone can’t reach `http://192.168.x.x:3000`. Use a **tunnel** so the app is reachable via a public URL **while your laptop is running**.

1. **Start the server** (Terminal 1):

```bash
npm run dev
```

2. **Start a tunnel** (Terminal 2). Pick one:

**Option A – Cloudflare Tunnel (no password)**  
Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/download-connect-app/) (one-time), then:

```bash
cloudflared tunnel --url http://localhost:3000
```

It will print a URL like `https://random-words.trycloudflare.com`. **No password** – open it on your phone and the app loads.

**Option B – localtunnel (asks for password)**  
```bash
npx localtunnel --port 3000
```

You’ll see a URL like `https://random-name.loca.lt` and a **tunnel password** in the same terminal output. On the phone, when the password page appears, enter that password (copy it from the terminal). If you don’t see it, try the subdomain from the URL (e.g. the `random-name` part) as the password.

**Option C – ngrok** (install from [ngrok.com](https://ngrok.com))

```bash
ngrok http 3000
```

Use the `https://...ngrok.io` URL it prints. Free tier may show a one-time “Visit Site” button instead of a password.

3. **On your phone**
   - Open the tunnel URL in Safari (iPhone) or Chrome (Android).
   - For Cloudflare (Option A): the app loads with no extra step.
   - For localtunnel: enter the tunnel password shown in your terminal.
   - **Add to Home Screen:** Safari → Share → **Add to Home Screen** (iPhone); Chrome → menu → **Add to Home screen** or **Install app** (Android).

4. **Use the app**
   - Open the home-screen icon. The tunnel must be running on your laptop for the app to load. When you’re done, stop the tunnel (Ctrl+C in Terminal 2); start it again next time you want to use the app on your phone.

**Note:** The tunnel URL changes each time you run localtunnel (ngrok can keep a fixed URL with an account). While testing, keep both the server and the tunnel running.

### Testing (no API key or API link required)

You do **not** need to input any API link or API key. The server runs locally and uses public APIs (arXiv, CrossRef) by default.

1. **Terminal 1 – start the server**

```bash
npm run dev
```

2. **Terminal 2 – run the test script**

```bash
npm run test:mcp
```

The test script will connect to `http://127.0.0.1:3000/mcp`, list tools, set a sample user profile, fetch a few recent papers, and list supported languages. To use a different URL (e.g. if the server runs on another port), set `MCP_URL`:

```bash
MCP_URL=http://127.0.0.1:4000/mcp npm run test:mcp
```

### Optional: real summary and report (OpenAI)

The UI can generate **real** summaries and education-level reports using OpenAI. If you don’t set a key, it falls back to short mock text.

1. Create an API key at [platform.openai.com](https://platform.openai.com/api-keys).
2. Set it when starting the server:

```bash
export OPENAI_API_KEY=sk-your-key-here
npm run dev
```

3. In the app, click **Generate today’s papers**. After papers are fetched, the server will call the LLM to summarize them and to write the report for your selected education level and language. Sections will show **Summary & key points** and **Daily report for your level** (without “(demo)”).

Optional: use a different model:

```bash
export OPENAI_MODEL=gpt-4o
```

### Optional external APIs (Google Scholar, higher PubMed quota)

- **PubMed**: by default, the server calls NCBI E-utilities without a key. To increase rate limits, you can set:

```bash
export NCBI_API_KEY=your_ncbi_key_here
```

- **Google Scholar**: there is no official public API. If you have your own proxy or paid API, set:

```bash
export GOOGLE_SCHOLAR_API_BASE=https://your-google-scholar-api.example.com/search
```

The backend will call:

```text
GET $GOOGLE_SCHOLAR_API_BASE?q=<urlencoded fieldsOfStudy>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>&limit=20
```

and expects a JSON response like:

```json
{
  "papers": [
    {
      "id": "string",
      "title": "string",
      "abstract": "string",
      "url": "https://...",
      "publishedAt": "2026-03-01T00:00:00Z",
      "journal": "Journal Name",
      "impactFactor": 5.2,
      "subjects": ["AI", "ML"]
    }
  ]
}
```

If `GOOGLE_SCHOLAR_API_BASE` is not set, Google Scholar is simply skipped.

### Verifying summary and report steps

1. **Demo in the UI (no LLM)**  
   After **Generate today's papers** succeeds, the right panel shows:
   - **Summary & key points (demo)** – same for everyone (mock list of titles + placeholder key points).
   - **Daily report for your level (demo)** – mock narrative that changes by education level (e.g. storytelling for “Before high school”, more technical for “PhD”).  
   This confirms the pipeline: search → summary → report by level.

2. **With a real LLM (MCP)**  
   Use an MCP-capable client (e.g. a chat app that talks to your server’s `/mcp` endpoint):
   - Call `set_user_profile` with fields, education level, language.
   - Call `fetch_recent_papers` to get papers.
   - Use your LLM to summarize the papers and extract key points, then generate the education-level report (e.g. via OpenAI/Claude API).
   - Call `save_user_report` with `rawSummary` and `narrativeByEducationLevel` (one narrative per level you support).
   - Call `get_user_report` to show the stored report and support Q&A.

### Design: search, summary, and report

- **Paper search** and **paper summary** (which papers to fetch and how to summarize/key-point them) are the **same for all users**, driven by fields of study and date range.
- **Report generating** is the only step that differs by education level: the same summary is turned into different narratives (e.g. storytelling for before high school, technical for PhD).

### MCP tools exposed

- **`set_user_profile`**: Save fields of study, education level, and language for a `userId`.
- **`fetch_recent_papers`**: For a given `userId`, fetch papers from the **last 7 days** from arXiv and high-impact journals.
- **`save_user_report`**: Store a report and per-education-level narratives generated by the LLM.
- **`get_user_report`**: Retrieve the latest report for Q&A and display.
- **`list_supported_languages`**: Return the list of language codes the host should support.

These tools are intended to be wired into an MCP-capable LLM host (such as an agent or chat UI) which will:

- Call `set_user_profile` based on the interactive UI where users:
  - Select **fields of study**.
  - Select **education level** (before high school, high school, undergraduate, master, doctor, above doctor).
  - Select **language**.
- Call `fetch_recent_papers` daily and use the returned metadata as context to:
  - Summarize and extract **key points** with the model.
  - Generate the final **user-facing report**, adapting style to the selected education level:
    - For **before high school**: story-telling style with characters, simple language, and concrete examples.
  - Save the resulting report via `save_user_report`.
- Call `get_user_report` when a user opens the app or starts a Q&A session.

### Mobile app and notifications (high-level design)

To satisfy the remaining requirements:

- **Mobile app (downloadable & installable)**:
  - Build a React Native / Expo app with screens for:
    - **Onboarding**: choose fields of study, education level, and language.
    - **Daily feed**: card-style list of generated reports (one per day).
    - **Report detail**: shows the story/summary and provides a chat-like Q&A interface backed by the LLM and `get_user_report`.
  - The app talks to:
    - Your **MCP-aware model endpoint** (for conversation and content generation).
    - This **MCP backend** indirectly via the model, or directly via a thin REST wrapper if needed.

- **Interactive Q&A & terminology links**:
  - The model:
    - Uses `get_user_report` to load the latest report and paper metadata into context.
    - Answers user questions conversationally.
    - Adds inline links (e.g. to Wikipedia/encyclopedia pages) for unfamiliar terminology.

- **Daily notifications**:
  - On the backend side, schedule a cron job (e.g. using `node-cron`) to:
    - Iterate over all known `userId`s.
    - Call `fetch_recent_papers`, ask the model to generate a new report, then `save_user_report`.
  - From your mobile app backend (or a separate service), use:
    - **APNs** for iOS and **FCM** for Android to push "Your new research story is ready" notifications, deep-linking into the report screen.

This repository focuses on the **MCP backend**; the UI and push infrastructure can be added as separate services that call into the MCP-connected model and this server.

