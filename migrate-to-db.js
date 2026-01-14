require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const db = require('./database');

async function migrateExistingData() {
    try {
        console.log('🔄 Starting migration from file system to database...\n');
        
        // Initialize database
        await db.initDatabase();
        console.log('✅ Database initialized\n');
        
        let totalProjects = 0;
        let totalFiles = 0;
        let totalChats = 0;
        
        // Migrate projects and files
        const projectsDir = path.join(__dirname, 'projects');
        try {
            const projects = await fs.readdir(projectsDir, { withFileTypes: true });
            
            for (const dir of projects) {
                if (!dir.isDirectory()) continue;
                
                const projectName = dir.name;
                console.log(`📁 Migrating project: ${projectName}`);
                
                try {
                    await db.createProject(projectName);
                    totalProjects++;
                    
                    // Recursive file scan
                    async function scanFiles(dirPath, basePath = '') {
                        const items = await fs.readdir(dirPath, { withFileTypes: true });
                        
                        for (const item of items) {
                            const itemPath = path.join(dirPath, item.name);
                            const relativePath = basePath ? `${basePath}/${item.name}` : item.name;
                            
                            if (item.isDirectory()) {
                                // Skip common directories
                                if (!['node_modules', '.git', 'venv', '__pycache__', 'dist', 'build', '.next'].includes(item.name)) {
                                    await scanFiles(itemPath, relativePath);
                                }
                            } else {
                                try {
                                    const content = await fs.readFile(itemPath, 'utf8');
                                    await db.writeFile(projectName, relativePath, content);
                                    console.log(`  ✓ ${relativePath}`);
                                    totalFiles++;
                                } catch (readErr) {
                                    console.log(`  ⚠️  Skipped binary file: ${relativePath}`);
                                }
                            }
                        }
                    }
                    
                    await scanFiles(path.join(projectsDir, projectName));
                } catch (projectErr) {
                    console.error(`  ❌ Error migrating project ${projectName}:`, projectErr.message);
                }
                
                console.log('');
            }
        } catch (err) {
            console.log('⚠️  No projects folder found - skipping project migration\n');
        }
        
        // Migrate chat history
        const historyDir = path.join(__dirname, 'chat_history');
        try {
            const histories = await fs.readdir(historyDir);
            
            console.log('💬 Migrating chat histories...');
            
            for (const file of histories) {
                if (!file.endsWith('.json')) continue;
                
                const projectName = file.replace('.json', '');
                
                try {
                    const historyData = JSON.parse(
                        await fs.readFile(path.join(historyDir, file), 'utf8')
                    );
                    
                    console.log(`  📝 ${projectName}: ${historyData.length} messages`);
                    
                    for (const entry of historyData) {
                        await db.saveChatHistory(projectName, entry.user, entry.ai);
                        totalChats++;
                    }
                } catch (historyErr) {
                    console.error(`  ❌ Error migrating history for ${projectName}:`, historyErr.message);
                }
            }
            
            console.log('');
        } catch (err) {
            console.log('⚠️  No chat history folder found - skipping chat migration\n');
        }
        
        console.log('✅ Migration complete!\n');
        console.log('📊 Summary:');
        console.log(`   Projects: ${totalProjects}`);
        console.log(`   Files: ${totalFiles}`);
        console.log(`   Chat messages: ${totalChats}`);
        console.log('\n🚀 You can now start the server with: node server.js');
        console.log('   Old folders (projects/, chat_history/) can be safely deleted or backed up.\n');
        
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error('\nFull error:', error);
        process.exit(1);
    }
}

migrateExistingData();
