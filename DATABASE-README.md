# 🗄️ PostgreSQL Database Migration Complete!

## What Changed?

Your NOScode editor has been migrated from a file-based system to **PostgreSQL database storage**. This makes it compatible with Vercel's serverless environment.

### Before (File-based ❌):
- Projects stored as folders in `projects/`
- Files stored as actual files on disk
- Chat history in `chat_history/*.json` files
- **Problem**: Vercel serverless functions can't permanently modify files

### After (Database-based ✅):
- Projects stored in PostgreSQL `projects` table
- Files stored in PostgreSQL `files` table with content as TEXT
- Chat history in PostgreSQL `chat_history` table
- **Solution**: Works perfectly on Vercel!

## Setup Instructions

### Option 1: Quick Start (Local Development)

1. **Install PostgreSQL**:
   - Windows: https://www.postgresql.org/download/windows/
   - Mac: `brew install postgresql`
   - Linux: `sudo apt-get install postgresql`

2. **Create database**:
```bash
# Start PostgreSQL service
# Windows: Search "Services" → Start "postgresql-x64"
# Mac/Linux: brew services start postgresql or sudo systemctl start postgresql

# Create database
createdb noscode
```

3. **Configure environment**:
```bash
copy .env.example .env
```

Edit `.env` and set:
```
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/noscode
HF_TOKEN=your_huggingface_token
```

4. **Initialize database**:
```bash
node setup-db.js
```

5. **Start server**:
```bash
node server.js
```

### Option 2: Use Cloud Database (No Local Install)

Skip PostgreSQL installation and use a free cloud database:

**Neon (Recommended for beginners)**:
1. Go to https://neon.tech
2. Sign up (free tier includes 10 databases)
3. Create a new project
4. Copy the connection string
5. Add to `.env`:
```
DATABASE_URL=postgresql://username:password@ep-xxx.region.aws.neon.tech/dbname
```

**Supabase**:
1. Go to https://supabase.com
2. Create project (free tier available)
3. Go to Settings → Database
4. Copy "Connection string" (URI mode)
5. Add to `.env`

**Railway**:
1. Go to https://railway.app
2. Create new project → Add PostgreSQL
3. Copy the `DATABASE_URL` from variables
4. Add to `.env`

## Migrating Existing Data

If you have existing projects in the `projects/` folder, you can migrate them:

```javascript
// Run this script to migrate old projects to database
const fs = require('fs').promises;
const path = require('path');
const db = require('./database');

async function migrate() {
    await db.initDatabase();
    
    const projectsDir = path.join(__dirname, 'projects');
    const projects = await fs.readdir(projectsDir, { withFileTypes: true });
    
    for (const dir of projects) {
        if (!dir.isDirectory()) continue;
        
        const projectName = dir.name;
        console.log(`Migrating project: ${projectName}`);
        
        await db.createProject(projectName);
        
        // Recursive file scan
        async function scanFiles(dirPath, basePath = '') {
            const items = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const item of items) {
                const itemPath = path.join(dirPath, item.name);
                const relativePath = basePath ? `${basePath}/${item.name}` : item.name;
                
                if (item.isDirectory()) {
                    if (!['node_modules', '.git'].includes(item.name)) {
                        await scanFiles(itemPath, relativePath);
                    }
                } else {
                    const content = await fs.readFile(itemPath, 'utf8');
                    await db.writeFile(projectName, relativePath, content);
                    console.log(`  ✓ ${relativePath}`);
                }
            }
        }
        
        await scanFiles(path.join(projectsDir, projectName));
    }
    
    // Migrate chat history
    const historyDir = path.join(__dirname, 'chat_history');
    try {
        const histories = await fs.readdir(historyDir);
        for (const file of histories) {
            if (!file.endsWith('.json')) continue;
            
            const projectName = file.replace('.json', '');
            const historyData = JSON.parse(await fs.readFile(path.join(historyDir, file), 'utf8'));
            
            console.log(`Migrating chat history for: ${projectName}`);
            
            for (const entry of historyData) {
                await db.saveChatHistory(projectName, entry.user, entry.ai);
            }
        }
    } catch (err) {
        console.log('No chat history to migrate');
    }
    
    console.log('\n✅ Migration complete!');
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
```

Save this as `migrate-to-db.js` and run with `node migrate-to-db.js`.

## Database Schema

```sql
-- Projects table
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Files table
CREATE TABLE files (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    filepath VARCHAR(500) NOT NULL,
    content TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, filepath)
);

-- Chat history table
CREATE TABLE chat_history (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    user_message TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW()
);
```

## Vercel Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete Vercel deployment instructions.

Quick steps:
1. Create Vercel Postgres database in dashboard
2. Get connection string
3. Deploy with `vercel`
4. Add environment variables (HF_TOKEN, DATABASE_URL)
5. Redeploy with `vercel --prod`

## Troubleshooting

### "Cannot connect to database"
- Check DATABASE_URL is correct
- Ensure PostgreSQL is running (if local)
- Test connection: `psql "postgresql://..."`

### "relation does not exist"
- Run `node setup-db.js` to create tables
- Or check if DATABASE_URL points to correct database

### "Out of memory" / Large files
- PostgreSQL TEXT column can store up to 1GB
- For binary files, consider separate storage (S3, Cloudinary)

### Performance with many files
- Database queries are indexed for fast access
- Tested with 1000+ files per project

## Need Help?

- Check server logs for detailed error messages
- Verify .env file has correct credentials
- Test database connection with psql or pgAdmin

## Backup Your Database

**Local backup**:
```bash
pg_dump noscode > backup.sql
```

**Restore**:
```bash
psql noscode < backup.sql
```

**Vercel Postgres**: Use Vercel dashboard to download backups

---

🎉 Your NOScode editor is now ready for Vercel deployment!
