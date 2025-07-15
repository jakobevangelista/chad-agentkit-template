# Chad

> **Heads-up:**  
> This repo is **not a runnable project**—it’s a **reference snippet** that shows how to wire an LLM “agent network” with Inngest AgentKit, ClickHouse, and Convex.  Clone or copy pieces at your own risk; you’ll still need to add real database code, environment variables, and UI if you want a working app.

---

## What’s in here?

| File | Purpose |
|------|---------|
| `index.ts` | A fully-commented TypeScript file that: <br>• Defines a `get_meet_results` tool for ClickHouse <br>• Builds three agents (Router / Query / Summary) <br>• Shows how to create a network with Inngest AgentKit <br>• Stubs out Convex-style chat-history functions |

---

## What’s **not** included?

* No `.env` or API keys  
* No ClickHouse client instantiation (`client.query` is referenced but not imported)  
* No Convex schema / functions (history methods are placeholders)  
* No UI—this is strictly the server-side agent logic  
* No build scripts or package.json

---

## Why keep it like this?

The goal is to give engineers a **concise, copy-pasteable blueprint** of:

1. Declaring a typed tool with Zod  
2. Prompting an LLM to output valid parameters  
3. Orchestrating multiple models with AgentKit

Everything else—frontend, deployment, auth—stays out of the way so you can drop the patterns into your own stack.

---

## If you want to run it anyway…

1. Replace the `// TODO` stubs with real database calls  
2. Add a ClickHouse client (`@clickhouse/client`) and import it  
3. Create a minimal `package.json` with `@inngest/agent-kit`, `zod`, and your choice of LLM SDKs  
4. Provide Anthropic / Gemini keys and ClickHouse creds

At that point, you can execute the function in a Node script or trigger it via Inngest.

---

## License

MIT © 2025 Jakob Evangelista

