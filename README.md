# ApplyWizard Email Tracker

A Vercel-ready Next.js app for tracking and classifying client emails.

> **You have no coding experience? Perfect — this guide walks you through every step.**

---

## What this project will do (roadmap)

| Phase | What gets built                     | Status        |
|-------|-------------------------------------|---------------|
| 1     | Project setup + homepage            | ✅ Done now   |
| 2     | Connect to Zoho Mail (OAuth)        | 🔜 Next       |
| 3     | Classify emails with AI (OpenAI)    | 🔜 Later      |
| 4     | Store results in Supabase database  | 🔜 Later      |
| 5     | Dashboard to view emails & labels   | 🔜 Later      |

Right now, **Phase 1 is complete**. You have a working Next.js app that runs locally and can be deployed to Vercel.

---

## What's inside the project

```
applywizard-email-tracker/
├── app/
│   ├── layout.tsx        ← Sets the page title and loads global styles
│   ├── page.tsx          ← The homepage you see in the browser
│   ├── globals.css       ← Global design tokens and reset styles
│   └── api/
│       └── zoho/         ← Future Zoho API routes live here
├── .env.example          ← Template for your secret keys (safe to share)
├── .gitignore            ← Tells Git what NOT to upload (e.g. secrets)
├── next.config.ts        ← Next.js configuration
├── tsconfig.json         ← TypeScript configuration
└── package.json          ← Project dependencies and scripts
```

---

## Requirements

Before you start, make sure you have:

- [Node.js](https://nodejs.org/) version **20.9 or newer**
  - To check: open your Terminal and type `node -v`
- **npm** — comes bundled with Node.js automatically

---

## Running the app locally (step by step)

### Step 1 — Install project packages

Open your Terminal, navigate to this folder, then run:

```bash
npm install
```

This downloads all the code libraries the project needs. It only needs to run once (or after you add new packages).

### Step 2 — Start the development server

```bash
npm run dev
```

You'll see output like:
```
▲ Next.js 16.x
- Local: http://localhost:3000
```

### Step 3 — Open the app

Open your browser and go to:

```
http://localhost:3000
```

You should see the **ApplyWizard Email Tracker** homepage.

To stop the server, press **Ctrl + C** in your Terminal.

---

## Setting up your secret environment variables

Secret keys (like API passwords) are **never** stored directly in code. Instead:

1. Copy the example file to create your private local file:
   ```bash
   cp .env.example .env.local
   ```
2. Open `.env.local` in a text editor and fill in your real values when prompted in later phases.

> ⚠️ **Never share `.env.local` with anyone or upload it to GitHub.** It is already listed in `.gitignore` so Git will automatically ignore it.

The variables you'll need in future phases are pre-listed in [`.env.example`](.env.example).

---

## Checking the project for errors

```bash
npm run lint      # Checks for code style issues
npm run build     # Builds the production version (confirms everything compiles)
```

---

## Deploying to Vercel (free hosting)

1. Push this project to a **GitHub repository**.
2. Go to [vercel.com/new](https://vercel.com/new) and sign in with GitHub.
3. Import your repository — Vercel will detect Next.js automatically.
4. Click **Deploy**. Your app will be live in ~1 minute.

> When you are ready to add Zoho/AI/Supabase keys, add them in Vercel's **Project → Settings → Environment Variables** panel. Never put real keys in `.env.example`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `command not found: npm` | Install Node.js from [nodejs.org](https://nodejs.org) |
| Port 3000 already in use | Run `npm run dev -- -p 3001` to use port 3001 |
| Page shows old content | Hard-refresh the browser: **Cmd+Shift+R** (Mac) / **Ctrl+Shift+R** (Windows) |
| TypeScript errors in editor | Run `npm install` to make sure all types are installed |

---

*Built with [Next.js](https://nextjs.org) · Deployed on [Vercel](https://vercel.com)*
