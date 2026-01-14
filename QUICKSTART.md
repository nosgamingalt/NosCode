# 🚀 Quick Start Guide - NOScode with PostgreSQL

## ⚡ Fastest Way to Get Started

### Option 1: Use Free Cloud Database (5 minutes)

1. **Get a free PostgreSQL database from Neon**:
   - Go to https://neon.tech
   - Sign up (GitHub login available)
   - Click "Create Project"
   - Copy the connection string (looks like: `postgresql://user:pass@host.neon.tech/dbname`)

2. **Set up environment**:
   ```bash
   copy .env.example .env
   ```
   
   Open `.env` and paste:
   ```
   DATABASE_URL=postgresql://user:pass@host.neon.tech/dbname
   HF_TOKEN=your_huggingface_token_from_hf.co
   ```

3. **Initialize and run**:
   ```bash
   node setup-db.js
   node server.js
   ```

4. **Open browser**:
   ```
   http://localhost:8080
   ```

Done! ✅

### Option 2: Local PostgreSQL (if already installed)

```bash
# Create database
createdb noscode

# Configure
copy .env.example .env
# Edit .env: DATABASE_URL=postgresql://postgres:password@localhost:5432/noscode

# Run
node setup-db.js
node server.js
```

## 📦 What You Need

- **Node.js** (already have it ✅)
- **PostgreSQL Database** (cloud or local)
- **HF Token** from https://huggingface.co/settings/tokens

## 🔧 Troubleshooting

**"Cannot connect to database"**
→ Check your DATABASE_URL in .env file

**"HF_TOKEN missing"**
→ Get token from https://huggingface.co/settings/tokens and add to .env

**"Module 'pg' not found"**
→ Run `npm install`

## 🌐 Deploy to Vercel

```bash
vercel
vercel env add DATABASE_URL
vercel env add HF_TOKEN
vercel --prod
```

## 📚 Full Documentation

- **MIGRATION-SUMMARY.md** - Complete overview
- **DEPLOYMENT.md** - Vercel deployment guide
- **DATABASE-README.md** - Database details

## 💡 Tips

- Use **Neon** for easiest cloud database (free tier)
- Get HF token from your Hugging Face settings
- Database initializes automatically on first run
- Old projects? Run `node migrate-to-db.js` to import them

---

**Need help?** Check the documentation files or reach out!
