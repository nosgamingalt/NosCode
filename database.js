const { Pool } = require('pg');

// Log environment check
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

// Initialize PostgreSQL connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database schema
async function initDatabase() {
    const client = await pool.connect();
    try {
        // Create projects table
        await client.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Create files table
        await client.query(`
            CREATE TABLE IF NOT EXISTS files (
                id SERIAL PRIMARY KEY,
                project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                filepath VARCHAR(500) NOT NULL,
                content TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(project_id, filepath)
            )
        `);

        // Create chat_history table
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_history (
                id SERIAL PRIMARY KEY,
                project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                user_message TEXT NOT NULL,
                ai_response TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT NOW()
            )
        `);

        // Create index for faster queries
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_files_project 
            ON files(project_id)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_chat_project 
            ON chat_history(project_id)
        `);

        console.log('✅ Database initialized successfully');
    } catch (err) {
        console.error('❌ Database initialization error:', err);
        throw err;
    } finally {
        client.release();
    }
}

// Project operations
async function listProjects() {
    const result = await pool.query(
        'SELECT name FROM projects ORDER BY created_at DESC'
    );
    return result.rows.map(row => row.name);
}

async function createProject(name) {
    await pool.query(
        'INSERT INTO projects (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [name]
    );
}

async function deleteProject(name) {
    await pool.query('DELETE FROM projects WHERE name = $1', [name]);
}

async function getProjectId(name) {
    const result = await pool.query(
        'SELECT id FROM projects WHERE name = $1',
        [name]
    );
    return result.rows[0]?.id || null;
}

// File operations
async function listFiles(projectName, subpath = '') {
    const projectId = await getProjectId(projectName);
    if (!projectId) return [];

    let query;
    let params;
    
    if (subpath) {
        // List files in specific folder
        query = `
            SELECT filepath, content 
            FROM files 
            WHERE project_id = $1 
            AND filepath LIKE $2
            AND filepath NOT LIKE $3
            ORDER BY filepath
        `;
        params = [projectId, `${subpath}/%`, `${subpath}/%/%`];
    } else {
        // List root files only
        query = `
            SELECT filepath, content 
            FROM files 
            WHERE project_id = $1 
            AND filepath NOT LIKE '%/%'
            ORDER BY filepath
        `;
        params = [projectId];
    }

    const result = await pool.query(query, params);
    
    // Build file/folder structure
    const items = new Map();
    
    result.rows.forEach(row => {
        const relativePath = subpath ? row.filepath.substring(subpath.length + 1) : row.filepath;
        const parts = relativePath.split('/');
        
        if (parts.length === 1) {
            // Direct file
            items.set(relativePath, { type: 'file', path: row.filepath });
        } else {
            // File in subfolder - add folder
            const folderName = parts[0];
            if (!items.has(folderName)) {
                items.set(folderName, { 
                    type: 'folder', 
                    path: subpath ? `${subpath}/${folderName}` : folderName 
                });
            }
        }
    });

    return Array.from(items.entries()).map(([name, data]) => ({
        name,
        path: data.path,
        type: data.type
    })).sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'folder' ? -1 : 1;
    });
}

async function readFile(projectName, filepath) {
    const projectId = await getProjectId(projectName);
    if (!projectId) throw new Error('Project not found');

    const result = await pool.query(
        'SELECT content FROM files WHERE project_id = $1 AND filepath = $2',
        [projectId, filepath]
    );

    if (result.rows.length === 0) {
        throw new Error('File not found');
    }

    return result.rows[0].content;
}

async function writeFile(projectName, filepath, content) {
    const projectId = await getProjectId(projectName);
    if (!projectId) throw new Error('Project not found');

    await pool.query(`
        INSERT INTO files (project_id, filepath, content, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (project_id, filepath)
        DO UPDATE SET content = $3, updated_at = NOW()
    `, [projectId, filepath, content]);
}

async function deleteFile(projectName, filepath) {
    const projectId = await getProjectId(projectName);
    if (!projectId) throw new Error('Project not found');

    // Check if it's a "folder" (files starting with this path)
    const folderCheck = await pool.query(
        'SELECT COUNT(*) as count FROM files WHERE project_id = $1 AND filepath LIKE $2',
        [projectId, `${filepath}/%`]
    );

    if (parseInt(folderCheck.rows[0].count) > 0) {
        // Delete all files in folder
        await pool.query(
            'DELETE FROM files WHERE project_id = $1 AND (filepath = $2 OR filepath LIKE $3)',
            [projectId, filepath, `${filepath}/%`]
        );
    } else {
        // Delete single file
        await pool.query(
            'DELETE FROM files WHERE project_id = $1 AND filepath = $2',
            [projectId, filepath]
        );
    }
}

async function getAllProjectFiles(projectName) {
    const projectId = await getProjectId(projectName);
    if (!projectId) return [];

    const result = await pool.query(
        'SELECT filepath FROM files WHERE project_id = $1 ORDER BY filepath',
        [projectId]
    );

    return result.rows.map(row => row.filepath);
}

// Chat history operations
async function saveChatHistory(projectName, userMessage, aiResponse) {
    const projectId = await getProjectId(projectName);
    if (!projectId) return;

    await pool.query(
        'INSERT INTO chat_history (project_id, user_message, ai_response) VALUES ($1, $2, $3)',
        [projectId, userMessage, aiResponse]
    );

    // Keep only last 50 messages
    await pool.query(`
        DELETE FROM chat_history 
        WHERE project_id = $1 
        AND id NOT IN (
            SELECT id FROM chat_history 
            WHERE project_id = $1 
            ORDER BY timestamp DESC 
            LIMIT 50
        )
    `, [projectId]);
}

async function loadChatHistory(projectName) {
    const projectId = await getProjectId(projectName);
    if (!projectId) return [];

    const result = await pool.query(
        `SELECT user_message, ai_response, timestamp 
         FROM chat_history 
         WHERE project_id = $1 
         ORDER BY timestamp ASC`,
        [projectId]
    );

    return result.rows.map(row => ({
        user: row.user_message,
        ai: row.ai_response,
        timestamp: row.timestamp.toISOString()
    }));
}

async function deleteChatHistory(projectName) {
    const projectId = await getProjectId(projectName);
    if (!projectId) return;

    await pool.query('DELETE FROM chat_history WHERE project_id = $1', [projectId]);
}

module.exports = {
    initDatabase,
    pool,
    // Project operations
    listProjects,
    createProject,
    deleteProject,
    getProjectId,
    // File operations
    listFiles,
    readFile,
    writeFile,
    deleteFile,
    getAllProjectFiles,
    // Chat history operations
    saveChatHistory,
    loadChatHistory,
    deleteChatHistory
};
