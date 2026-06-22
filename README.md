# ApplyWizard Email Tracker

A minimal Next.js starter for the ApplyWizard Email Tracker. It currently shows a simple homepage only.

Zoho OAuth, AI classification, Supabase storage, APIs, and the dashboard are intentionally not implemented yet.

## Requirements

- [Node.js](https://nodejs.org/) 20.9 or newer
- npm (included with Node.js)

## Run locally

1. Install the project packages:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

The values in `.env.example` are placeholders for later phases. They are not needed for the current homepage. Never put real secret values in `.env.example` or commit them to Git.

## Check the project

```bash
npm run lint
npm run build
```

## Deploy to Vercel

Import this repository into [Vercel](https://vercel.com/new). Vercel will detect Next.js and use the default build settings.
