require('dotenv').config();
const express = require("express");
const path = require("path");
const { exec, spawn } = require('child_process');
const db = require('./database');
const app = express();
const port = process.env.PORT || 8080;

app.use(express.json({ limit: '50mb' })); // Increase limit for base64 images
app.use(express.static(path.join(__dirname)));

// Initialize database on startup
db.initDatabase().catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/guest-chat", async (req, res) => {
    const { message, model } = req.body;
    const HF_TOKEN = process.env.HF_TOKEN;
    if (!HF_TOKEN) return res.status(500).json({ response: "HF_TOKEN missing." });
    if (!model) return res.status(400).json({ response: "Model is required." });
    try {
        const resp = await fetch("https://router.huggingface.co/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: message }],
                temperature: 0.7,
                max_tokens: 2000
            })
        });
        if (!resp.ok) {
            const errorText = await resp.text();
            return res.status(resp.status).json({
                response: `Model failed. Status ${resp.status}. Error: ${errorText.substring(0, 200)}`
            });
        }
        const data = await resp.json();
        let aiResponse = data?.choices?.[0]?.message?.content?.trim() || "No response generated.";
        res.json({ response: aiResponse, model });
    } catch (err) {
        console.error("Guest chat endpoint error:", err);
        res.status(500).json({ response: "Server error. Check logs." });
    }
});

// List projects
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await db.listProjects();
        res.json({ projects });
    } catch (err) {
        console.error('Error listing projects', err);
        res.json({ projects: [] });
    }
});

// Create project
app.post('/api/projects/:name', async (req, res) => {
    try {
        const name = req.params.name;
        await db.createProject(name);
        res.json({ ok: true });
    } catch (err) {
        console.error('Create project error', err);
        res.status(500).json({ error: 'Could not create project' });
    }
});

// Delete project
app.delete('/api/projects/:name', async (req, res) => {
    try {
        const name = req.params.name;
        await db.deleteProject(name);
        res.json({ ok: true });
    } catch (err) {
        console.error('Delete project error', err);
        res.status(500).json({ error: 'Could not delete project' });
    }
});

// List files in project
app.get('/api/files/:project', async (req, res) => {
    try {
        const project = req.params.project;
        const subpath = req.query.path || '';
        const files = await db.listFiles(project, subpath);
        res.json({ files, currentPath: subpath });
    } catch (err) {
        console.error('List files error', err);
        res.json({ files: [], currentPath: '' });
    }
});

// Read a file
app.get('/api/file/:project', async (req, res) => {
    try {
        const project = req.params.project;
        const filepath = req.query.path || '';
        if (!filepath) return res.status(400).json({ error: 'path query parameter required' });
        
        const content = await db.readFile(project, filepath);
        res.json({ content });
    } catch (err) {
        console.error('Read file error', err);
        res.status(500).json({ error: 'Could not read file' });
    }
});

// Write a file
app.post('/api/file/:project', async (req, res) => {
    try {
        const project = req.params.project;
        const filepath = req.query.path || '';
        if (!filepath) return res.status(400).json({ error: 'path query parameter required' });
        
        const body = req.body || {};
        const content = body.content || '';
        
        await db.writeFile(project, filepath, content);
        res.json({ ok: true });
    } catch (err) {
        console.error('Write file error', err);
        res.status(500).json({ error: 'Could not write file: ' + err.message });
    }
});

// Get chat history for a project
app.get('/api/chat-history/:project', async (req, res) => {
    try {
        const project = req.params.project;
        const history = await db.loadChatHistory(project);
        res.json({ history });
    } catch (err) {
        console.error('Error loading chat history', err);
        res.json({ history: [] });
    }
});

// Delete chat history for a project
app.delete('/api/chat-history/:project', async (req, res) => {
    try {
        const project = req.params.project;
        await db.deleteChatHistory(project);
        res.json({ success: true, message: 'Chat history deleted' });
    } catch (err) {
        console.error('Error deleting chat history', err);
        res.status(500).json({ error: 'Could not delete chat history' });
    }
});

// Auto-fix endpoint - iteratively fixes errors by running commands and analyzing output
app.post('/api/ai/auto-fix', async (req, res) => {
    const { project, runCommand } = req.body;
    if (!project) return res.status(400).json({ error: 'Project required' });
    
    const maxAttempts = 5;
    const fixes = [];
    
    try {
        const projectFiles = await db.getAllProjectFiles(project);
        
        // Determine run command if not provided
        let command = runCommand;
        if (!command) {
            if (projectFiles.some(f => f.endsWith('.py'))) {
                const mainFile = projectFiles.find(f => f.includes('main.py') || f.includes('app.py')) || projectFiles.find(f => f.endsWith('.py'));
                command = `py ${mainFile}`;
            } else if (projectFiles.some(f => f.endsWith('.go'))) {
                command = 'go run .';
            } else if (projectFiles.some(f => f.endsWith('.js') && f.includes('server'))) {
                command = 'node server.js';
            } else if (projectFiles.some(f => f.endsWith('.java'))) {
                const mainFile = projectFiles.find(f => f.includes('Main.java'));
                command = mainFile ? `javac ${mainFile} && java ${mainFile.replace('.java', '')}` : 'javac *.java && java Main';
            }
        }
        
        if (!command) {
            return res.json({
                success: false,
                message: 'Could not determine how to run your project. Please specify a run command.',
                fixes: []
            });
        }
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // Run the command
            const output = await new Promise((resolve) => {
                exec(command, { timeout: 15000, shell: true }, (error, stdout, stderr) => {
                    resolve({
                        success: !error,
                        output: stdout || stderr || (error ? error.message : ''),
                        error: !!error
                    });
                });
            });
            
            if (output.success) {
                fixes.push({
                    attempt,
                    action: 'success',
                    message: `✅ Code runs successfully!`,
                    output: output.output
                });
                
                return res.json({
                    success: true,
                    message: `✅ **Success!** Your code runs without errors after ${attempt > 1 ? attempt - 1 + ' fix(es)' : 'no fixes needed'}.`,
                    fixes,
                    finalOutput: output.output
                });
            }
            
            // Analyze error and fix
            const errorOutput = output.output;
            fixes.push({
                attempt,
                action: 'error_detected',
                message: `❌ Attempt ${attempt}: Error detected`,
                error: errorOutput
            });
            
            // Ask AI to fix the error
            const fileContents = {};
            for (const file of projectFiles.slice(0, 10)) { // Read up to 10 files
                try {
                    const content = await db.readFile(project, file);
                    fileContents[file] = content;
                } catch {}
            }
            
            const fixPrompt = `You are a debugging expert. The code has an error. You MUST fix it.

PROJECT FILES:
${Object.entries(fileContents).map(([name, content]) => 
    `FILE: ${name}\n\`\`\`\n${content.substring(0, 3000)}\n\`\`\`\n`
).join('\n')}

RUN COMMAND: ${command}

ERROR OUTPUT:
\`\`\`
${errorOutput}
\`\`\`

YOUR TASK:
1. Identify the error from the output
2. Fix ONLY the broken file(s)
3. Respond with the FIXED files using this format:

EXPLANATION:
Brief description of what you fixed and why

FILE: filename.ext
\`\`\`
complete fixed file content
\`\`\`

Remember: Output ONLY the files that need fixing. Use the FILE: format.`;

            const aiResponse = await callHF(fixPrompt);
            
            // Parse AI response for file fixes
            const fileRegex = /FILE:\s*([^\n`]+)\s*\n\s*```[\w]*\s*\n([\s\S]*?)```/gi;
            const fixedFiles = [];
            let match;
            let explanation = '';
            
            const explanationMatch = aiResponse.match(/EXPLANATION:\s*([\s\S]*?)(?=FILE:|$)/i);
            if (explanationMatch) {
                explanation = explanationMatch[1].trim();
            }
            
            while ((match = fileRegex.exec(aiResponse)) !== null) {
                const filepath = match[1].trim().replace(/^["']|["']$/g, '');
                const content = match[2].trim();
                if (filepath && content) {
                    try {
                        await db.writeFile(project, filepath, content);
                        fixedFiles.push(filepath);
                    } catch (err) {
                        console.error('Error writing fix:', err);
                    }
                }
            }
            
            if (fixedFiles.length > 0) {
                fixes.push({
                    attempt,
                    action: 'applied_fix',
                    message: `🔧 Applied fix to: ${fixedFiles.join(', ')}`,
                    explanation: explanation || 'Fixed the error',
                    files: fixedFiles
                });
            } else {
                fixes.push({
                    attempt,
                    action: 'no_fix_found',
                    message: `⚠️ AI couldn't generate a fix`,
                    aiResponse: aiResponse.substring(0, 500)
                });
                break;
            }
        }
        
        return res.json({
            success: false,
            message: `❌ Could not fix all errors after ${maxAttempts} attempts. Review the fixes and errors above.`,
            fixes
        });
        
    } catch (err) {
        console.error('Auto-fix error:', err);
        return res.status(500).json({ error: err.message, fixes });
    }
});

// Delete a file
app.delete('/api/file/:project', async (req, res) => {
    try {
        const project = req.params.project;
        const filepath = req.query.path || '';
        if (!filepath) return res.status(400).json({ error: 'path query parameter required' });
        
        await db.deleteFile(project, filepath);
        res.json({ ok: true });
    } catch (err) {
        console.error('Delete error', err);
        res.status(500).json({ error: 'Could not delete file/folder' });
    }
});

// AI endpoints (forward to Hugging Face chat completions)
async function callHF(prompt, extra = {}) {
    const HF_TOKEN = process.env.HF_TOKEN;
    if (!HF_TOKEN) throw new Error('HF_TOKEN missing');
    
    // If image is provided, use vision model
    if (extra.image) {
        const body = {
            model: 'meta-llama/Llama-3.2-11B-Vision-Instruct',
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: extra.image } }
                ]
            }],
            temperature: 0.7,
            max_tokens: 2000
        };
        
        const resp = await fetch('https://router.huggingface.co/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${HF_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!resp.ok) {
            const errorText = await resp.text();
            throw new Error(`HF vision error ${resp.status}: ${errorText}`);
        }
        const data = await resp.json();
        const aiResponse = data?.choices?.[0]?.message?.content?.trim() || data?.choices?.[0]?.text || 'No response.';
        return aiResponse;
    }
    
    // Text-only model
    const body = Object.assign({
        model: extra.model || 'deepseek-ai/DeepSeek-V3',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 2000
    }, extra.body || {});

    const resp = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${HF_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    if (!resp.ok) {
        const errorText = await resp.text();
        throw new Error(`HF error ${resp.status}: ${errorText}`);
    }
    const data = await resp.json();
    const aiResponse = data?.choices?.[0]?.message?.content?.trim() || data?.choices?.[0]?.text || 'No response.';
    return aiResponse;
}

app.post('/api/ai/chat', async (req, res) => {
    try {
        const { prompt, code, filename, project, image } = req.body || {};
        if (!prompt) return res.status(400).json({ response: 'Prompt required' });
        
        // Check if user has a project
        if (!project) {
            if (prompt.toLowerCase().includes('create') || prompt.toLowerCase().includes('file') || prompt.toLowerCase().includes('edit')) {
                return res.json({ 
                    response: '⚠️ Please create or select a project first before I can create or edit files. Use the **Project** button in the sidebar to get started.' 
                });
            }
        }
        
        const lowerPrompt = prompt.toLowerCase();
        
        // Check if user wants to delete a file
        const deleteMatch = prompt.match(/delete\s+(?:the\s+)?(?:file\s+)?["\']?([^\s"']+\.\w+)["\']?/i);
        if (deleteMatch) {
            const filepath = deleteMatch[1];
            return res.json({
                response: `🗑️ Deleted \`${filepath}\`.`,
                action: 'delete_file',
                filepath: filepath
            });
        }
        
        // Check if user wants to read a file
        const readMatch = prompt.match(/(?:read|show|open|view|display)\s+(?:the\s+)?(?:contents?\s+(?:of\s+)?)?(?:file\s+)?["\']?([^\s"']+\.\w+)["\']?/i);
        if (readMatch) {
            const filepath = readMatch[1];
            return res.json({
                response: `📄 Reading \`${filepath}\`...`,
                action: 'read_file',
                filepath: filepath
            });
        }
        
        // Check if this is a fix command request with auto-execution
        const isFixCommand = lowerPrompt.includes('fix') && (
            lowerPrompt.includes('error') ||
            lowerPrompt.includes('run') ||
            lowerPrompt.includes('execute') ||
            lowerPrompt.includes('test') ||
            lowerPrompt.includes('console')
        );
        
        if (isFixCommand && project) {
            return res.json({
                response: '🔧 Starting auto-fix mode. I will run your code, analyze errors, fix them, and retry until it works...',
                action: 'auto_fix',
                project: project
            });
        }
        
        // Detect if this is a file operation request
        const isFileOperation = 
            lowerPrompt.includes('create') ||
            lowerPrompt.includes('make') ||
            lowerPrompt.includes('write') ||
            lowerPrompt.includes('edit') ||
            lowerPrompt.includes('modify') ||
            lowerPrompt.includes('update') ||
            lowerPrompt.includes('add') ||
            lowerPrompt.includes('change') ||
            lowerPrompt.includes('fix') ||
            lowerPrompt.includes('implement') ||
            lowerPrompt.includes('build') ||
            lowerPrompt.includes('setup') ||
            lowerPrompt.includes('generate');
        
        // Build context for the AI - gather project info
        let contextInfo = '';
        let projectFiles = [];
        
        // Load conversation history
        const chatHistory = await db.loadChatHistory(project);
        if (chatHistory.length > 0) {
            const recentHistory = chatHistory.slice(-5); // Last 5 exchanges
            const historyText = recentHistory.map(h => 
                `User: ${h.user}\nAI: ${h.ai.substring(0, 500)}${h.ai.length > 500 ? '...' : ''}`
            ).join('\n\n');
            contextInfo += `\n\nRecent conversation history:\n${historyText}`;
        }
        
        if (project) {
            try {
                projectFiles = await db.getAllProjectFiles(project);
                const fileList = projectFiles.length > 0 ? projectFiles.slice(0, 30).join('\n  ') : 'No files found';
                contextInfo += `\n\nProject: ${project}\nFiles in project:\n  ${fileList}${projectFiles.length > 30 ? '\n  ... and more' : ''}`;
            } catch (err) {
                console.log('Could not list project files:', err.message);
            }
        }
        
        if (code && filename) {
            contextInfo += `\n\nCurrently open file: ${filename}\nFile content:\n\`\`\`\n${code.substring(0, 5000)}\n\`\`\``;
        }
        
        // Different prompts for file operations vs general questions
        let systemPrompt;
        if (isFileOperation) {
            systemPrompt = `YOU ARE A FILE CREATOR. NOT AN INSTRUCTOR. NEVER EXPLAIN STEPS.

STRICT RULES - YOU WILL BE PUNISHED IF YOU BREAK THESE:
1. DO NOT WRITE "Step 1", "Step 2", "First", "Then", "Next", etc.
2. DO NOT SAY "create a file" or "you should" or "make sure to"
3. DO NOT GIVE INSTRUCTIONS OR ADVICE
4. ONLY OUTPUT: EXPLANATION + FILE blocks (see format below)
5. WRITE COMPLETE FILES - NO PLACEHOLDERS

REQUIRED FORMAT:

EXPLANATION:
One sentence

FILE: filename.ext
\`\`\`
complete code
\`\`\`

FILE: another.ext
\`\`\`
complete code
\`\`\`

EXAMPLE (CORRECT - DO THIS):
User: "flask headset tracker"
You respond:
EXPLANATION:
Creating Flask headset price tracker

FILE: app.py
\`\`\`python
from flask import Flask, render_template
import requests
app = Flask(__name__)
headsets = {'HyperX': {'url': 'https://amazon.com/hyperx', 'price': 0}}
@app.route('/')
def index():
    return render_template('index.html', headsets=headsets)
if __name__ == '__main__':
    app.run(debug=True)
\`\`\`

FILE: templates/index.html
\`\`\`html
<!DOCTYPE html>
<html><head><title>Prices</title></head>
<body><h1>Headset Prices</h1></body></html>
\`\`\`

FILE: requirements.txt
\`\`\`
Flask==3.0.0
requests==2.31.0
\`\`\`

WRONG (NEVER DO THIS):
"To run this application, follow these steps:
Step 1: Create app.py with code...
Step 2: Install dependencies...
Step 3: Run python app.py..."

IF YOU WRITE INSTRUCTIONS INSTEAD OF FILES, YOU FAILED.

User: "${prompt}"${contextInfo}

RESPOND WITH FILES ONLY:`;
        } else {
            systemPrompt = `You are an expert coding assistant with full visibility into the user's project.

CONTEXT AWARENESS:
- You can see all files in the project
- You can see the currently open file
- You MUST examine this context to answer questions
- NEVER give generic answers - be specific to their code

WHEN ASKED "HOW DO I RUN THIS":
1. Look at the files in the project
2. Identify the language (Python=.py, Go=.go, Node=.js, Java=.java, etc.)
3. Give SPECIFIC run command based on what you see:
   - Python: "Run: python app.py" or "python main.py"
   - Go: "Run: go run main.go" or "go run ."
   - Node: "Run: node server.js" or "npm start"
   - Java: "Run: javac Main.java && java Main"
4. If you see requirements.txt or go.mod, mention installing dependencies first

WHEN ASKED ABOUT THE PROJECT:
- Look at the file list and describe what you see
- Identify the project type from file extensions
- Mention key files like main.py, package.json, go.mod, etc.

NEVER SAY:
- "I need more information"
- "Could you tell me what language..."
- "Please provide the location..."

ALWAYS:
- Look at the context provided
- Give specific, actionable answers
- Reference actual filenames you see

User question: "${prompt}"${contextInfo}`;
        }
        
        // Pass image to AI if provided
        const extraOptions = {};
        if (image) {
            extraOptions.image = image;
            // For image analysis, use a more conversational system prompt
            if (!isCreateRequest) {
                systemPrompt = `You are a helpful AI assistant with vision capabilities. Analyze the image provided and answer the user's question.

User: "${prompt}"${contextInfo}`;
            }
        }
        
        const aiResponse = await callHF(systemPrompt, extraOptions);
        
        // Parse the response for file operations
        const files = [];
        let explanation = '';
        
        // Extract EXPLANATION section
        const explanationMatch = aiResponse.match(/EXPLANATION:\s*([\s\S]*?)(?=FILE:|$)/i);
        if (explanationMatch) {
            explanation = explanationMatch[1].trim();
        }
        
        // Extract all FILE: blocks - improved regex to handle various formats
        const fileRegex = /FILE:\s*([^\n`]+)\s*\n\s*```[\w]*\s*\n([\s\S]*?)```/gi;
        let match;
        while ((match = fileRegex.exec(aiResponse)) !== null) {
            const filepath = match[1].trim().replace(/^["']|["']$/g, '');
            const content = match[2].trim();
            if (filepath && content) {
                files.push({ filepath, content });
            }
        }
        
        // If no files found with FILE: format, try alternate patterns
        if (files.length === 0 && isFileOperation) {
            // Pattern 1: filename.ext\n```code```
            const altRegex1 = /(?:^|\n)([a-zA-Z0-9_\-\/\.]+\.[a-zA-Z0-9]+)\s*\n```[\w]*\n([\s\S]*?)```/gi;
            while ((match = altRegex1.exec(aiResponse)) !== null) {
                const filepath = match[1].trim();
                const content = match[2].trim();
                if (filepath && content && !filepath.includes(' ') && filepath.includes('.')) {
                    files.push({ filepath, content });
                }
            }
        }
        
        // Pattern 2: Look for code blocks after "create" or "update" mentions
        if (files.length === 0 && isFileOperation) {
            const createRegex = /(?:create|update|write|make)\s+(?:a\s+)?(?:file\s+)?(?:called\s+)?["\']?([a-zA-Z0-9_\-\/\.]+\.[a-zA-Z0-9]+)["\']?\s*[:\n]+\s*```[\w]*\n([\s\S]*?)```/gi;
            while ((match = createRegex.exec(aiResponse)) !== null) {
                const filepath = match[1].trim();
                const content = match[2].trim();
                if (filepath && content) {
                    files.push({ filepath, content });
                }
            }
        }
        
        // If we found files to write
        if (files.length > 0) {
            const filesList = files.map(f => `\`${f.filepath}\``).join(', ');
            let responseText;
            
            if (explanation) {
                responseText = `${explanation}\n\n✅ **Created/Updated ${files.length} file(s):** ${filesList}`;
            } else {
                responseText = `✅ **Created/Updated ${files.length} file(s):** ${filesList}\n\nThe files have been written to your project.`;
            }
            
            if (files.length === 1) {
                await db.saveChatHistory(project, prompt, responseText);
                return res.json({
                    response: responseText,
                    action: 'write_file',
                    filepath: files[0].filepath,
                    content: files[0].content
                });
            } else {
                await db.saveChatHistory(project, prompt, responseText);
                return res.json({
                    response: responseText,
                    action: 'write_multiple_files',
                    files: files
                });
            }
        }
        
        // Check for simple file creation with template
        const simpleCreateMatch = prompt.match(/create\s+(?:a\s+)?(?:an\s+)?(?:new\s+)?(?:file\s+)?(?:called\s+)?(?:named\s+)?["\']?([a-zA-Z0-9_\-\.\/]+\.(html|htm|js|jsx|ts|tsx|css|scss|py|java|json|md|txt|xml|yml|yaml))["\']?/i);
        if (simpleCreateMatch && !aiResponse.includes('```')) {
            const filepath = simpleCreateMatch[1];
            const ext = filepath.split('.').pop().toLowerCase();
            const content = generateFileTemplate(filepath, ext, prompt);
            
            const templateResponse = `✅ Created \`${filepath}\` with a starter template. The file is now open in the editor.`;
            await db.saveChatHistory(project, prompt, templateResponse);
            return res.json({
                response: templateResponse,
                action: 'write_file',
                filepath: filepath,
                content: content
            });
        }
        
        // Return as chat response if no files to write
        await db.saveChatHistory(project, prompt, aiResponse);
        return res.json({ response: aiResponse });
    } catch (err) {
        console.error('AI chat error', err.message || err);
        if ((err.message || '').includes('HF_TOKEN')) return res.status(500).json({ response: 'HF_TOKEN missing. Set env variable.' });
        res.status(500).json({ response: 'AI error: ' + (err.message || 'Unknown error') });
    }
});

// Helper function to generate file templates
function generateFileTemplate(filepath, ext, prompt = '') {
    const filename = filepath.split('/').pop().replace(/\.\w+$/, '');
    const titleCase = filename.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    if (ext === 'html' || ext === 'htm') {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${titleCase}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            color: #333;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        header {
            background: #007acc;
            color: white;
            padding: 20px 0;
            text-align: center;
        }
        
        main {
            padding: 40px 20px;
        }
        
        h1 {
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <h1>${titleCase}</h1>
        </div>
    </header>
    
    <main>
        <div class="container">
            <p>Welcome to ${titleCase}!</p>
        </div>
    </main>
    
    <script>
        // Your JavaScript code here
        console.log('Page loaded!');
    </script>
</body>
</html>`;
    } else if (ext === 'js' || ext === 'jsx') {
        return `/**
 * ${titleCase}
 * Created with NOS Code AI Assistant
 */

// Your code here
console.log('${titleCase} loaded!');
`;
    } else if (ext === 'ts' || ext === 'tsx') {
        return `/**
 * ${titleCase}
 * Created with NOS Code AI Assistant
 */

// Your TypeScript code here
const message: string = '${titleCase} loaded!';
console.log(message);
`;
    } else if (ext === 'css' || ext === 'scss') {
        return `/**
 * ${titleCase} Styles
 */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: #333;
    background: #f5f5f5;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
}
`;
    } else if (ext === 'py') {
        return `"""
${titleCase}
Created with NOS Code AI Assistant
"""


def main():
    """Main function"""
    print("Hello from ${filename}!")


if __name__ == "__main__":
    main()
`;
    } else if (ext === 'java') {
        const className = filename.charAt(0).toUpperCase() + filename.slice(1).replace(/[-_]/g, '');
        return `/**
 * ${titleCase}
 * Created with NOS Code AI Assistant
 */
public class ${className} {
    
    public static void main(String[] args) {
        System.out.println("Hello from ${className}!");
    }
}
`;
    } else if (ext === 'json') {
        return `{
    "name": "${filename}",
    "version": "1.0.0",
    "description": "${titleCase}"
}`;
    } else if (ext === 'md') {
        return `# ${titleCase}

Created with NOS Code AI Assistant.

## Getting Started

Add your content here.

## Features

- Feature 1
- Feature 2
- Feature 3
`;
    } else if (ext === 'yml' || ext === 'yaml') {
        return `# ${titleCase} Configuration
name: ${filename}
version: 1.0.0
`;
    } else if (ext === 'xml') {
        return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${titleCase} -->
<root>
    <name>${filename}</name>
</root>
`;
    }
    return `// ${titleCase}\n// Created with NOS Code AI Assistant\n`;
}

app.post('/api/ai/analyze', async (req, res) => {
    try {
        const { code, filename } = req.body || {};
        const prompt = `Analyze this code (${filename || 'file'}). Provide issues and suggestions:\n\n${code}`;
        const reply = await callHF(prompt);
        res.json({ analysis: reply });
    } catch (err) {
        console.error('AI analyze error', err);
        res.status(500).json({ analysis: 'AI analyze error' });
    }
});

app.post('/api/ai/explain', async (req, res) => {
    try {
        const { code, filename } = req.body || {};
        const prompt = `Explain this code (${filename || 'file'}) in plain language:\n\n${code}`;
        const reply = await callHF(prompt);
        res.json({ explanation: reply });
    } catch (err) {
        console.error('AI explain error', err);
        res.status(500).json({ explanation: 'AI explain error' });
    }
});

app.post('/api/ai/generate', async (req, res) => {
    try {
        const { prompt } = req.body || {};
        const reply = await callHF(`Generate code: ${prompt}`);
        res.json({ suggestion: reply });
    } catch (err) {
        console.error('AI generate error', err);
        res.status(500).json({ suggestion: 'AI generate error' });
    }
});
const API_URL = "http://localhost:8080"; // Change if deployed elsewhere

// --- User Auth ---
async function signup(username, password) {
    const res = await fetch(`${API_URL}/api/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
    });
    return await res.json();
}

async function login(username, password) {
    const res = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
    });
    return await res.json();
}

// --- Chat Management ---
async function createChat(userId, model) {
    const res = await fetch(`${API_URL}/api/chat/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, model })
    });
    return await res.json();
}

async function getChats(userId) {
    const res = await fetch(`${API_URL}/api/chats/${userId}`);
    return await res.json();
}

async function getChatMessages(userId, chatId) {
    const res = await fetch(`${API_URL}/api/chat/${userId}/${chatId}`);
    return await res.json();
}

// --- Send a Chat Message ---
async function sendChatMessage({ message, model, userId, chatId }) {
    const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, model, userId, chatId })
    });
    return await res.json();
}

// --- Example Usage ---
// 1. User signs up or logs in
// const user = await signup("myuser", "mypassword");
// const user = await login("myuser", "mypassword");
// const userId = user.user.id;

// 2. Create a new chat (or get existing chatId from getChats)
// const chat = await createChat(userId, "meta-llama/Meta-Llama-3-8B-Instruct:novita");
// const chatId = chat.chat.id;

// 3. Send a message
// const reply = await sendChatMessage({
//     message: "What is the capital of France?",
//     model: "meta-llama/Meta-Llama-3-8B-Instruct:novita",
//     userId,
//     chatId
// });
// console.log("Response:", reply.response);

// Terminal endpoints
// NOTE: Terminal execution has limited functionality with database storage
// Commands run in server context, not within project directories
const previewServers = new Map();
const runningProcesses = new Map();

app.post('/api/terminal/run', async (req, res) => {
    try {
        const { command, project } = req.body;
        const cwd = __dirname; // Run in server directory (no filesystem projects)
        
        // Check if this is a long-running server command
        const isServerCommand = command.includes('http.server') || 
                                command.includes('serve') || 
                                (command.includes('run') && command.includes('app.py'));
        
        if (isServerCommand) {
            // Handle long-running processes with spawn
            let cmd = command;
            
            // Fix Python command for Windows
            if (command.includes('python')) {
                cmd = command.replace(/^python/, 'py');
            }
            
            // Extract port from command
            const portMatch = command.match(/\d{4,5}$/);
            const port = portMatch ? portMatch[0] : '8000';
            
            // Use exec for server commands instead of spawn - keeps them alive longer
            const child = exec(cmd, {
                cwd,
                shell: true,
                windowsHide: false,
                maxBuffer: 1024 * 1024 * 5
            });
            
            let output = '';
            let hasOutput = false;
            
            if (child.stdout) {
                child.stdout.on('data', (data) => {
                    output += data.toString();
                    hasOutput = true;
                    console.log('Server output:', data.toString());
                });
            }
            
            if (child.stderr) {
                child.stderr.on('data', (data) => {
                    output += data.toString();
                    hasOutput = true;
                    console.log('Server stderr:', data.toString());
                });
            }
            
            // Wait longer to capture server startup message
            setTimeout(() => {
                if (child.pid) {
                    runningProcesses.set(project || 'default', child);
                    
                    const serverMsg = `✅ Server started successfully!\n\n` +
                                    `📡 Access your server at:\n` +
                                    `   • http://127.0.0.1:${port}\n` +
                                    `   • http://localhost:${port}\n\n` +
                                    `🔄 Server is running with PID: ${child.pid}\n` +
                                    `⚠️  Keep this terminal window open to keep the server running\n\n` +
                                    (hasOutput ? `Server output:\n${output}` : '');
                    
                    res.json({ 
                        output: serverMsg,
                        background: true,
                        url: `http://localhost:${port}`
                    });
                } else {
                    res.json({ output: output || 'Command failed to start', error: true });
                }
            }, 2000); // Wait 2 seconds for output
            
            child.on('error', (err) => {
                console.error('Server error:', err);
                if (!res.headersSent) {
                    res.json({ output: `Error starting server: ${err.message}`, error: true });
                }
            });
            
            child.on('exit', (code) => {
                console.log('Server exited with code:', code);
                runningProcesses.delete(project || 'default');
            });
        } else {
            // Regular commands with exec
            let cmd = command;
            
            // Fix Python command for Windows
            if (command.startsWith('python ')) {
                cmd = command.replace(/^python/, 'py');
            }
            
            exec(cmd, { 
                cwd, 
                timeout: 30000,
                shell: true,
                windowsHide: true,
                maxBuffer: 1024 * 1024 * 5
            }, (error, stdout, stderr) => {
                if (error) {
                    const output = stderr || stdout || error.message;
                    return res.json({ output, error: true });
                }
                res.json({ output: stdout || stderr || 'Command executed successfully' });
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/terminal/host', async (req, res) => {
    try {
        const { project, port: requestedPort } = req.body;
        if (!project) {
            return res.status(400).json({ error: 'Project required' });
        }
        
        // NOTE: Preview server is not available with database storage
        // Files need to be on disk to serve them
        return res.json({
            success: false,
            message: '⚠️ Preview server is not available with database storage. Deploy to Vercel to host your project.'
        });
        
        /* Original implementation commented out - requires filesystem
        const projectPath = safeProjectPath(project);
        const previewPort = requestedPort || (3000 + Math.floor(Math.random() * 1000));
        
        // Check if already hosting on this port
        if (previewServers.has(project)) {
            const existingPort = previewServers.get(project);
            return res.json({ 
                message: 'Preview server already running',
                url: `http://localhost:${existingPort}`
            });
        }
        
        // Create a simple static file server for the project
        const express2 = require('express');
        const previewApp = express2();
        previewApp.use(express2.static(projectPath));
        
        const server = previewApp.listen(previewPort, () => {
            console.log(`Preview server for ${project} on port ${previewPort}`);
        });
        
        previewServers.set(project, { port: previewPort, server });
        
        res.json({ 
            message: `Preview server started on port ${previewPort}`,
            url: `http://localhost:${previewPort}`
        });
        */
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/terminal/stop', async (req, res) => {
    try {
        const { project } = req.body;
        if (!project) {
            return res.status(400).json({ error: 'Project required' });
        }
        
        if (previewServers.has(project)) {
            const { server, port } = previewServers.get(project);
            server.close();
            previewServers.delete(project);
            res.json({ 
                success: true,
                message: `Preview server stopped (was on port ${port})`
            });
        } else {
            res.json({ 
                success: false,
                message: 'No preview server running for this project'
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/terminal/kill', async (req, res) => {
    try {
        const { pid } = req.body;
        if (!pid) {
            return res.status(400).json({ error: 'PID required' });
        }
        
        // Try to kill the process
        exec(`taskkill /F /PID ${pid}`, (error, stdout, stderr) => {
            if (error) {
                return res.json({ 
                    success: false, 
                    error: `Could not kill process: ${stderr || error.message}` 
                });
            }
            
            // Also remove from tracked processes
            for (const [key, process] of runningProcesses.entries()) {
                if (process.pid === pid) {
                    process.kill();
                    runningProcesses.delete(key);
                }
            }
            
            res.json({ 
                success: true, 
                message: `Process ${pid} killed` 
            });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/terminal/processes', async (req, res) => {
    try {
        const processes = [];
        
        // Add tracked running processes
        for (const [key, process] of runningProcesses.entries()) {
            if (process.pid) {
                processes.push({
                    pid: process.pid,
                    name: `Background process (${key})`
                });
            }
        }
        
        // Add preview servers
        for (const [project, { port }] of previewServers.entries()) {
            processes.push({
                pid: 'N/A',
                name: `Preview server: ${project} (port ${port})`
            });
        }
        
        res.json({ processes });
    } catch (err) {
        res.status(500).json({ error: err.message, processes: [] });
    }
});

// Export for Vercel serverless
module.exports = app;

// Only listen if not in Vercel (local development)
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server listening on http://localhost:${port}`);
    });
}
