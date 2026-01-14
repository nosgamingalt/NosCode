# NOScode - Vercel Deployment Guide

## Prerequisites

1. **PostgreSQL Database** - You'll need a PostgreSQL database. Options:
   - **Vercel Postgres** (Recommended): Create directly in Vercel dashboard
   - **Neon**: https://neon.tech (Free tier available)
   - **Supabase**: https://supabase.com (Free tier available)
   - **Railway**: https://railway.app (Free tier available)

2. **Hugging Face API Token**: Get from https://huggingface.co/settings/tokens

## Local Development Setup

1. Install dependencies:
```bash
npm install
```

2. Set up PostgreSQL database (if running locally):
```bash
# Install PostgreSQL from https://www.postgresql.org/download/
# Create database
createdb noscode
```

3. Configure environment variables:
```bash
# Copy example env file
copy .env.example .env

# Edit .env and add:
HF_TOKEN=your_huggingface_token
DATABASE_URL=postgresql://postgres:password@localhost:5432/noscode
NODE_ENV=development
```

4. Run the server:
```bash
node server.js
```

The database tables will be created automatically on first run.

## Vercel Deployment

### Step 1: Create Vercel Postgres Database

1. Go to your Vercel dashboard: https://vercel.com/dashboard
2. Click "Storage" → "Create Database"
3. Select "Postgres" → Click "Continue"
4. Name your database (e.g., "noscode-db") → Click "Create"
5. Copy the `DATABASE_URL` connection string

### Step 2: Deploy to Vercel

1. Install Vercel CLI (if not already installed):
```bash
npm install -g vercel
```

2. Login to Vercel:
```bash
vercel login
```

3. Deploy:
```bash
vercel
```

4. Follow the prompts:
   - Set up and deploy? **Y**
   - Which scope? Select your account
   - Link to existing project? **N**
   - Project name? **noscode** (or your preferred name)
   - In which directory? **./** (current directory)
   - Auto-detected settings? **Y**

### Step 3: Set Environment Variables

After initial deployment, add environment variables:

```bash
vercel env add HF_TOKEN
# Paste your Hugging Face token when prompted
# Select Production, Preview, and Development

vercel env add DATABASE_URL
# Paste your PostgreSQL connection string
# Select Production, Preview, and Development
```

Or set them in the Vercel dashboard:
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add:
   - `HF_TOKEN`: Your Hugging Face API token
   - `DATABASE_URL`: Your PostgreSQL connection string
   - `NODE_ENV`: `production`

### Step 4: Redeploy

```bash
vercel --prod
```

Your NOScode editor should now be live! 🎉

## Database Schema

The database tables are created automatically on first run:

- **projects**: Stores project names
- **files**: Stores file content for each project
- **chat_history**: Stores AI conversation history per project

## Troubleshooting

### Database Connection Issues

If you get database connection errors:

1. Check your `DATABASE_URL` is correct
2. Ensure your database is publicly accessible (or use Vercel's internal connection)
3. For Vercel Postgres, use the connection string from the "Connection String" tab

### "Cannot find module 'pg'" Error

Run:
```bash
npm install pg
```

### Serverless Function Timeout

Vercel has a 10-second timeout for Hobby plan. If AI responses take too long:
- Upgrade to Pro plan (60-second timeout)
- Or optimize AI prompts to be shorter

### Database Tables Not Created

The tables are created automatically on first request. If they're not created:
1. Check server logs for errors
2. Verify DATABASE_URL is correct
3. Manually run the schema from `database.js`

## Features Preserved

✅ All projects and files stored in PostgreSQL
✅ Chat history persisted across sessions
✅ AI file operations (create, edit, delete)
✅ Terminal commands (Note: Some commands may not work in serverless)
✅ Auto-fix functionality
✅ Image upload and vision AI

## Limitations on Vercel

⚠️ **Terminal commands**: Limited functionality in serverless environment
⚠️ **File execution**: Cannot run Python/Java/etc. files directly
⚠️ **Long-running processes**: 10-second timeout (60s on Pro)

## Support

For issues or questions, create an issue on GitHub or contact support.
