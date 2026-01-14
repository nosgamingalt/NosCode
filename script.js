/* =====================================================
   NOS Code - AI-Powered Code Editor
   Main JavaScript Application
   ===================================================== */

// =====================================================
// Global State
// =====================================================
const state = {
    currentProject: null,
    currentFile: null,
    currentPath: '',
    files: [],
    openFiles: [],
    fileContents: {},
    modifiedFiles: new Set(),
    aiPanelVisible: true,
    bottomPanelVisible: true,
    bottomPanelMaximized: false,
    terminalHistory: [],
    terminalHistoryIndex: -1,
    attachedImage: null, // Store attached image data
};

// =====================================================
// Initialize Ace Editor
// =====================================================
let editor;
function initEditor() {
    editor = ace.edit("editor");
    editor.setTheme("ace/theme/one_dark");
    editor.setFontSize(14);
    editor.setShowPrintMargin(false);
    editor.getSession().setUseWrapMode(true);
    editor.getSession().setTabSize(4);
    editor.getSession().setUseSoftTabs(true);
    
    // Enable autocomplete
    editor.setOptions({
        enableBasicAutocompletion: true,
        enableLiveAutocompletion: true,
        enableSnippets: true
    });
    
    // Track cursor position
    editor.selection.on('changeCursor', updateCursorPosition);
    
    // Track content changes
    editor.getSession().on('change', () => {
        if (state.currentFile) {
            state.fileContents[state.currentFile] = editor.getValue();
            if (!state.modifiedFiles.has(state.currentFile)) {
                state.modifiedFiles.add(state.currentFile);
                updateFileTabs();
            }
        }
    });
}

function updateCursorPosition() {
    const pos = editor.getCursorPosition();
    document.getElementById('status-cursor').textContent = `Ln ${pos.row + 1}, Col ${pos.column + 1}`;
}

// =====================================================
// API Module
// =====================================================
const API = {
    async listProjects() {
        try {
            const res = await fetch('/api/projects');
            return await res.json();
        } catch (e) {
            console.error('Error fetching projects:', e);
            return { projects: [] };
        }
    },

    async createProject(name) {
        try {
            const res = await fetch(`/api/projects/${name}`, { method: 'POST' });
            return await res.json();
        } catch (e) {
            showNotification('Error creating project: ' + e.message, 'error');
            return null;
        }
    },

    async deleteProject(name) {
        try {
            const res = await fetch(`/api/projects/${name}`, { method: 'DELETE' });
            return await res.json();
        } catch (e) {
            showNotification('Error deleting project: ' + e.message, 'error');
            return null;
        }
    },

    async listFiles(project, path = '') {
        try {
            const url = path 
                ? `/api/files/${project}?path=${encodeURIComponent(path)}` 
                : `/api/files/${project}`;
            const res = await fetch(url);
            return await res.json();
        } catch (e) {
            console.error('Error fetching files:', e);
            return { files: [] };
        }
    },

    async readFile(project, filepath) {
        try {
            const res = await fetch(`/api/file/${project}?path=${encodeURIComponent(filepath)}`);
            return await res.json();
        } catch (e) {
            showNotification('Error reading file: ' + e.message, 'error');
            return { content: '' };
        }
    },

    async writeFile(project, filepath, content) {
        try {
            const res = await fetch(`/api/file/${project}?path=${encodeURIComponent(filepath)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, filename: filepath })
            });
            return await res.json();
        } catch (e) {
            showNotification('Error saving file: ' + e.message, 'error');
            return null;
        }
    },

    async deleteFile(project, filepath) {
        try {
            const res = await fetch(`/api/file/${project}?path=${encodeURIComponent(filepath)}`, { 
                method: 'DELETE' 
            });
            return await res.json();
        } catch (e) {
            showNotification('Error deleting: ' + e.message, 'error');
            return null;
        }
    },

    async chat(message) {
        try {
            const body = {
                code: editor ? editor.getValue() : '', 
                filename: state.currentFile || 'untitled.txt',
                project: state.currentProject,
                prompt: message
            };
            
            // Include image if attached
            if (state.attachedImage) {
                body.image = state.attachedImage;
            }
            
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            
            // Handle file operation actions from AI
            if (data.action === 'read_file' && data.filepath) {
                try {
                    const fileData = await API.readFile(state.currentProject, data.filepath);
                    return { 
                        response: `📄 **File content of ${data.filepath}:**\n\n\`\`\`\n${fileData.content}\n\`\`\``,
                        fileRead: true 
                    };
                } catch (e) {
                    return { response: `❌ Error reading file: ${e.message}` };
                }
            }
            
            if (data.action === 'write_file' && data.filepath && data.content !== undefined) {
                try {
                    await API.writeFile(state.currentProject, data.filepath, data.content);
                    await loadFolder(state.currentPath);
                    
                    // Open the file that was created/modified
                    await loadFile(data.filepath);
                    
                    return { 
                        response: `✅ Successfully ${data.filepath.includes('/') ? 'created' : 'updated'} \`${data.filepath}\``,
                        fileWritten: true 
                    };
                } catch (e) {
                    return { response: `❌ Error writing file: ${e.message}` };
                }
            }
            
            if (data.action === 'write_multiple_files' && data.files) {
                try {
                    for (const file of data.files) {
                        await API.writeFile(state.currentProject, file.filepath, file.content);
                    }
                    await loadFolder(state.currentPath);
                    
                    // Open the first file
                    if (data.files.length > 0) {
                        await loadFile(data.files[0].filepath);
                    }
                    
                    const filesList = data.files.map(f => `\`${f.filepath}\``).join(', ');
                    return { 
                        response: data.response || `✅ Created ${data.files.length} file(s): ${filesList}`,
                        filesWritten: true 
                    };
                } catch (e) {
                    return { response: `❌ Error creating files: ${e.message}` };
                }
            }
            
            if (data.action === 'delete_file' && data.filepath) {
                try {
                    await API.deleteFile(state.currentProject, data.filepath);
                    await loadFolder(state.currentPath);
                    return { 
                        response: `🗑️ Successfully deleted \`${data.filepath}\``,
                        fileDeleted: true 
                    };
                } catch (e) {
                    return { response: `❌ Error deleting file: ${e.message}` };
                }
            }
            
            if (data.action === 'auto_fix') {
                try {
                    addChatMessage('🔧 Starting auto-fix mode...', false);
                    
                    const fixRes = await fetch('/api/ai/auto-fix', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            project: state.currentProject,
                            runCommand: null // Let it auto-detect
                        })
                    });
                    const fixData = await fixRes.json();
                    
                    // Display each fix attempt
                    if (fixData.fixes && fixData.fixes.length > 0) {
                        for (const fix of fixData.fixes) {
                            if (fix.error) {
                                addChatMessage(`**Attempt ${fix.attempt}:**\n\`\`\`\n${fix.error.substring(0, 500)}\n\`\`\``, false);
                            }
                            if (fix.explanation) {
                                addChatMessage(`🔧 **Fix applied:** ${fix.explanation}`, false);
                            }
                        }
                    }
                    
                    // Reload files to show changes
                    await loadFolder(state.currentPath);
                    
                    return { 
                        response: fixData.message,
                        autoFixComplete: true 
                    };
                } catch (e) {
                    return { response: `❌ Auto-fix error: ${e.message}` };
                }
            }
            
            return data;
        } catch (e) {
            return { response: '❌ Error: ' + e.message, status: 'error' };
        }
    },

    async runCommand(command) {
        try {
            const res = await fetch('/api/terminal/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command, project: state.currentProject })
            });
            return await res.json();
        } catch (e) {
            return { error: e.message };
        }
    },

    async hostProject(port = 8000) {
        try {
            const res = await fetch('/api/terminal/host', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project: state.currentProject, port })
            });
            return await res.json();
        } catch (e) {
            return { error: e.message };
        }
    },

    async stopServer() {
        try {
            const res = await fetch('/api/terminal/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project: state.currentProject })
            });
            return await res.json();
        } catch (e) {
            return { error: e.message };
        }
    },

    async killProcess(pid) {
        try {
            const res = await fetch('/api/terminal/kill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pid: parseInt(pid) })
            });
            return await res.json();
        } catch (e) {
            return { error: e.message };
        }
    },

    async listProcesses() {
        try {
            const res = await fetch('/api/terminal/processes');
            return await res.json();
        } catch (e) {
            return { processes: [] };
        }
    },

    async loadChatHistory(project) {
        try {
            const res = await fetch(`/api/chat-history/${project}`);
            const data = await res.json();
            return data.history || [];
        } catch (e) {
            console.error('Error loading chat history:', e);
            return [];
        }
    },

    async deleteChatHistory(project) {
        try {
            const res = await fetch(`/api/chat-history/${project}`, { method: 'DELETE' });
            return await res.json();
        } catch (e) {
            console.error('Error deleting chat history:', e);
            return { error: e.message };
        }
    }
};

// =====================================================
// File System Operations
// =====================================================
async function loadProject(projectName) {
    state.currentProject = projectName;
    state.currentPath = '';
    state.openFiles = [];
    state.fileContents = {};
    state.modifiedFiles.clear();
    
    document.getElementById('files-section-title').textContent = projectName.toUpperCase();
    document.getElementById('status-project-name').textContent = projectName;
    document.getElementById('welcome-screen').classList.add('hidden');
    
    await loadFolder('');
    await loadChatHistory();
    updateProjectsList();
}

async function loadChatHistory() {
    if (!state.currentProject) return;
    
    const history = await API.loadChatHistory(state.currentProject);
    const chatArea = document.getElementById('ai-chat-area');
    
    // Clear existing messages
    chatArea.innerHTML = '';
    
    // Add historical messages
    for (const entry of history) {
        addChatMessage(entry.user, true);  // true = user message
        addChatMessage(entry.ai, false);   // false = AI message
    }
}

async function loadFolder(folderPath) {
    state.currentPath = folderPath;
    const data = await API.listFiles(state.currentProject, folderPath);
    state.files = data.files || [];
    updateFilesList();
    updateBreadcrumb();
}

async function loadFile(filepath) {
    // Save current file content before switching
    if (state.currentFile && editor) {
        state.fileContents[state.currentFile] = editor.getValue();
    }
    
    // Add to open files if not already open
    if (!state.openFiles.includes(filepath)) {
        state.openFiles.push(filepath);
    }
    
    state.currentFile = filepath;
    document.getElementById('welcome-screen').classList.add('hidden');
    
    // Load from cache or fetch from server
    let content = state.fileContents[filepath];
    if (content === undefined) {
        const data = await API.readFile(state.currentProject, filepath);
        content = (data.content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        state.fileContents[filepath] = content;
    }
    
    editor.setValue(content, -1);
    editor.clearSelection();
    
    // Set editor mode based on file extension
    const mode = getLanguageMode(filepath);
    editor.getSession().setMode(mode);
    
    // Update UI
    updateFileTabs();
    updateFilesList();
    updateEditorBreadcrumb();
    updateStatusBar();
    updateAIContext();
}

async function saveFile() {
    if (!state.currentProject || !state.currentFile) {
        showNotification('No file to save', 'warning');
        return;
    }
    
    let content = editor.getValue();
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    state.fileContents[state.currentFile] = content;
    
    await API.writeFile(state.currentProject, state.currentFile, content);
    state.modifiedFiles.delete(state.currentFile);
    updateFileTabs();
    showNotification('File saved successfully', 'success');
}

function closeFileTab(filepath, event) {
    if (event) event.stopPropagation();
    
    // Check if modified
    if (state.modifiedFiles.has(filepath)) {
        showDialog(
            'Unsaved Changes',
            `Do you want to save changes to ${filepath.split('/').pop()}?`,
            'confirm',
            '',
            async (save) => {
                if (save) {
                    // Save and then close
                    state.currentFile = filepath;
                    await saveFile();
                }
                performCloseTab(filepath);
            }
        );
    } else {
        performCloseTab(filepath);
    }
}

function performCloseTab(filepath) {
    const index = state.openFiles.indexOf(filepath);
    if (index > -1) {
        state.openFiles.splice(index, 1);
    }
    delete state.fileContents[filepath];
    state.modifiedFiles.delete(filepath);
    
    if (state.currentFile === filepath) {
        if (state.openFiles.length > 0) {
            const newIndex = Math.min(index, state.openFiles.length - 1);
            loadFile(state.openFiles[newIndex]);
        } else {
            state.currentFile = null;
            editor.setValue('', -1);
            document.getElementById('welcome-screen').classList.remove('hidden');
            updateEditorBreadcrumb();
            updateStatusBar();
        }
    }
    updateFileTabs();
}

// =====================================================
// UI Update Functions
// =====================================================
function updateFileTabs() {
    const container = document.getElementById('editor-tabs');
    
    if (state.openFiles.length === 0) {
        container.innerHTML = `
            <div class="tab-placeholder">
                <span>Open a file to start editing</span>
            </div>
        `;
        return;
    }
    
    container.innerHTML = state.openFiles.map(filepath => {
        const filename = filepath.split('/').pop();
        const isActive = filepath === state.currentFile;
        const isModified = state.modifiedFiles.has(filepath);
        const icon = getFileIcon(filename);
        
        return `
            <div class="editor-tab ${isActive ? 'active' : ''}" onclick="loadFile('${filepath}')">
                <i class="${icon}"></i>
                <span class="tab-name ${isModified ? 'modified' : ''}">${filename}</span>
                <span class="tab-close" onclick="closeFileTab('${filepath}', event)">
                    <i class="fas fa-times"></i>
                </span>
            </div>
        `;
    }).join('');
}

function updateFilesList() {
    const container = document.getElementById('files-list');
    
    if (state.files.length === 0) {
        container.innerHTML = '<div class="muted-text" style="padding: 8px 20px; font-size: 12px;">No files</div>';
        return;
    }
    
    container.innerHTML = state.files.map(file => {
        const isFolder = file.type === 'folder';
        const icon = isFolder ? 'fas fa-folder' : getFileIcon(file.name);
        const isActive = !isFolder && state.currentFile === file.path;
        const onclick = isFolder 
            ? `loadFolder('${file.path}')` 
            : `loadFile('${file.path}')`;
        
        return `
            <div class="tree-item ${isActive ? 'active' : ''}" onclick="${onclick}">
                <i class="${icon}"></i>
                <span class="tree-item-name">${file.name}</span>
                <div class="tree-item-actions">
                    ${!isFolder ? `
                        <button class="icon-btn" onclick="event.stopPropagation(); showRenameDialog('${file.path}', '${file.name}')" title="Rename">
                            <i class="fas fa-pen"></i>
                        </button>
                    ` : ''}
                    <button class="icon-btn" onclick="event.stopPropagation(); showDeleteDialog('${file.path}', ${isFolder})" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function updateBreadcrumb() {
    const container = document.getElementById('breadcrumb-nav');
    
    if (!state.currentPath) {
        container.innerHTML = '';
        return;
    }
    
    const parts = state.currentPath.split('/');
    let html = `
        <button class="breadcrumb-btn" onclick="loadFolder('')" title="Root">
            <i class="fas fa-home"></i>
        </button>
    `;
    
    parts.forEach((part, idx) => {
        const path = parts.slice(0, idx + 1).join('/');
        html += `
            <span class="breadcrumb-separator"><i class="fas fa-chevron-right"></i></span>
            <button class="breadcrumb-btn" onclick="loadFolder('${path}')">${part}</button>
        `;
    });
    
    container.innerHTML = html;
}

function updateEditorBreadcrumb() {
    const container = document.getElementById('editor-breadcrumb');
    
    if (!state.currentFile) {
        container.innerHTML = '<span class="breadcrumb-item">No file selected</span>';
        return;
    }
    
    const parts = state.currentFile.split('/');
    container.innerHTML = parts.map((part, idx) => {
        return `<span class="breadcrumb-item">${part}</span>`;
    }).join('<span class="breadcrumb-separator"><i class="fas fa-chevron-right"></i></span>');
}

function updateStatusBar() {
    const lang = state.currentFile ? getLanguageName(state.currentFile) : 'Plain Text';
    document.getElementById('status-language').textContent = lang;
}

function updateAIContext() {
    const contextFile = document.getElementById('ai-context-file');
    contextFile.textContent = state.currentFile || 'No file selected';
}

async function updateProjectsList() {
    const data = await API.listProjects();
    const container = document.getElementById('projects-list');
    const modalList = document.getElementById('project-list');
    
    if (!data.projects || data.projects.length === 0) {
        container.innerHTML = '<div class="muted-text" style="padding: 8px 10px; font-size: 12px;">No projects</div>';
        if (modalList) {
            modalList.innerHTML = '<div class="muted-text" style="padding: 8px; font-size: 12px;">No projects yet. Create one above!</div>';
        }
        return;
    }
    
    // Sidebar projects list
    container.innerHTML = data.projects.map(p => `
        <div class="tree-item ${state.currentProject === p ? 'active' : ''}" onclick="loadProject('${p}')">
            <i class="fas fa-folder"></i>
            <span class="tree-item-name">${p}</span>
        </div>
    `).join('');
    
    // Modal projects list
    if (modalList) {
        modalList.innerHTML = data.projects.map(p => `
            <div class="project-item ${state.currentProject === p ? 'active' : ''}" onclick="loadProject('${p}'); document.getElementById('project-modal').classList.remove('active');">
                <i class="fas fa-folder"></i>
                <span class="project-item-name">${p}</span>
                <button class="project-item-delete" onclick="event.stopPropagation(); deleteProject('${p}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
    }
}

// =====================================================
// File Utilities
// =====================================================
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'js': 'fab fa-js-square',
        'jsx': 'fab fa-react',
        'ts': 'fab fa-js-square',
        'tsx': 'fab fa-react',
        'html': 'fab fa-html5',
        'htm': 'fab fa-html5',
        'css': 'fab fa-css3-alt',
        'scss': 'fab fa-css3-alt',
        'sass': 'fab fa-css3-alt',
        'less': 'fab fa-css3-alt',
        'py': 'fab fa-python',
        'java': 'fab fa-java',
        'php': 'fab fa-php',
        'rb': 'fas fa-gem',
        'go': 'fas fa-code',
        'rs': 'fas fa-code',
        'cpp': 'fas fa-code',
        'c': 'fas fa-code',
        'cs': 'fas fa-code',
        'json': 'fas fa-brackets-curly',
        'xml': 'fas fa-code',
        'md': 'fab fa-markdown',
        'txt': 'fas fa-file-alt',
        'sql': 'fas fa-database',
        'vue': 'fab fa-vuejs',
        'svelte': 'fas fa-code',
        'yml': 'fas fa-file-code',
        'yaml': 'fas fa-file-code',
        'sh': 'fas fa-terminal',
        'bash': 'fas fa-terminal',
        'ps1': 'fas fa-terminal',
        'gitignore': 'fab fa-git-alt',
        'env': 'fas fa-cog',
    };
    return icons[ext] || 'fas fa-file';
}

function getLanguageMode(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const modes = {
        'js': 'ace/mode/javascript',
        'jsx': 'ace/mode/jsx',
        'ts': 'ace/mode/typescript',
        'tsx': 'ace/mode/jsx',
        'html': 'ace/mode/html',
        'htm': 'ace/mode/html',
        'css': 'ace/mode/css',
        'scss': 'ace/mode/scss',
        'sass': 'ace/mode/sass',
        'less': 'ace/mode/less',
        'py': 'ace/mode/python',
        'json': 'ace/mode/json',
        'xml': 'ace/mode/xml',
        'sql': 'ace/mode/sql',
        'java': 'ace/mode/java',
        'cs': 'ace/mode/csharp',
        'php': 'ace/mode/php',
        'rb': 'ace/mode/ruby',
        'go': 'ace/mode/golang',
        'rs': 'ace/mode/rust',
        'cpp': 'ace/mode/c_cpp',
        'c': 'ace/mode/c_cpp',
        'md': 'ace/mode/markdown',
        'yml': 'ace/mode/yaml',
        'yaml': 'ace/mode/yaml',
        'sh': 'ace/mode/sh',
        'bash': 'ace/mode/sh',
    };
    return modes[ext] || 'ace/mode/text';
}

function getLanguageName(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const names = {
        'js': 'JavaScript',
        'jsx': 'JavaScript React',
        'ts': 'TypeScript',
        'tsx': 'TypeScript React',
        'html': 'HTML',
        'htm': 'HTML',
        'css': 'CSS',
        'scss': 'SCSS',
        'sass': 'Sass',
        'less': 'Less',
        'py': 'Python',
        'json': 'JSON',
        'xml': 'XML',
        'sql': 'SQL',
        'java': 'Java',
        'cs': 'C#',
        'php': 'PHP',
        'rb': 'Ruby',
        'go': 'Go',
        'rs': 'Rust',
        'cpp': 'C++',
        'c': 'C',
        'md': 'Markdown',
        'yml': 'YAML',
        'yaml': 'YAML',
        'sh': 'Shell',
        'bash': 'Bash',
        'txt': 'Plain Text',
    };
    return names[ext] || 'Plain Text';
}

// =====================================================
// Dialog System
// =====================================================
function showDialog(title, message, type = 'confirm', defaultValue = '', onConfirm = null) {
    const overlay = document.getElementById('dialog-overlay');
    const dialog = document.getElementById('custom-dialog');
    const titleEl = document.getElementById('dialog-title');
    const messageEl = document.getElementById('dialog-message');
    const inputEl = document.getElementById('dialog-input');
    const buttonsEl = document.getElementById('dialog-buttons');

    titleEl.textContent = title;
    messageEl.textContent = message;
    
    if (type === 'input') {
        inputEl.style.display = 'block';
        inputEl.value = defaultValue;
        setTimeout(() => inputEl.focus(), 100);
    } else {
        inputEl.style.display = 'none';
    }

    buttonsEl.innerHTML = '';

    if (type === 'ok') {
        buttonsEl.innerHTML = `<button class="dialog-btn dialog-btn-primary" onclick="hideDialog()">OK</button>`;
    } else if (type === 'confirm') {
        buttonsEl.innerHTML = `
            <button class="dialog-btn dialog-btn-secondary" onclick="hideDialog(); ${onConfirm ? `(${onConfirm})(false)` : ''}">Cancel</button>
            <button class="dialog-btn dialog-btn-primary" onclick="hideDialog(); ${onConfirm ? `(${onConfirm})(true)` : ''}">Confirm</button>
        `;
        
        // Use proper event handlers
        const cancelBtn = buttonsEl.querySelector('.dialog-btn-secondary');
        const confirmBtn = buttonsEl.querySelector('.dialog-btn-primary');
        
        cancelBtn.onclick = () => { hideDialog(); if (onConfirm) onConfirm(false); };
        confirmBtn.onclick = () => { hideDialog(); if (onConfirm) onConfirm(true); };
    } else if (type === 'input') {
        buttonsEl.innerHTML = `
            <button class="dialog-btn dialog-btn-secondary">Cancel</button>
            <button class="dialog-btn dialog-btn-primary">Confirm</button>
        `;
        
        const cancelBtn = buttonsEl.querySelector('.dialog-btn-secondary');
        const confirmBtn = buttonsEl.querySelector('.dialog-btn-primary');
        
        cancelBtn.onclick = () => { hideDialog(); if (onConfirm) onConfirm(null); };
        confirmBtn.onclick = () => { 
            const value = inputEl.value.trim(); 
            hideDialog(); 
            if (onConfirm) onConfirm(value); 
        };
    }

    overlay.classList.add('active');
    dialog.classList.add('active');
}

function hideDialog() {
    document.getElementById('dialog-overlay').classList.remove('active');
    document.getElementById('custom-dialog').classList.remove('active');
}

function showDeleteDialog(filepath, isFolder = false) {
    const itemType = isFolder ? 'folder' : 'file';
    showDialog(
        `Delete ${isFolder ? 'Folder' : 'File'}`,
        `Are you sure you want to delete "${filepath.split('/').pop()}"?${isFolder ? ' This will delete all contents.' : ''}`,
        'confirm',
        '',
        async (confirmed) => {
            if (confirmed) {
                await API.deleteFile(state.currentProject, filepath);
                
                if (!isFolder && state.openFiles.includes(filepath)) {
                    performCloseTab(filepath);
                }
                
                await loadFolder(state.currentPath);
                showNotification(`Deleted ${itemType} successfully`, 'success');
            }
        }
    );
}

function showRenameDialog(filepath, currentName) {
    showDialog('Rename File', 'Enter the new filename:', 'input', currentName, async (newName) => {
        if (newName && newName !== currentName) {
            const lastSlash = filepath.lastIndexOf('/');
            const dirPath = lastSlash >= 0 ? filepath.substring(0, lastSlash + 1) : '';
            const newPath = dirPath + newName;
            
            // Read current content and write to new path
            const content = state.fileContents[filepath] || '';
            await API.writeFile(state.currentProject, newPath, content);
            await API.deleteFile(state.currentProject, filepath);
            
            // Update open files
            const idx = state.openFiles.indexOf(filepath);
            if (idx > -1) {
                state.openFiles[idx] = newPath;
                state.fileContents[newPath] = state.fileContents[filepath];
                delete state.fileContents[filepath];
                
                if (state.currentFile === filepath) {
                    state.currentFile = newPath;
                }
            }
            
            await loadFolder(state.currentPath);
            updateFileTabs();
            showNotification('File renamed successfully', 'success');
        }
    });
}

// =====================================================
// Notification System
// =====================================================
function showNotification(message, type = 'info') {
    const statusMessage = document.getElementById('status-message');
    statusMessage.textContent = message;
    statusMessage.className = `status-item ${type}`;
    
    setTimeout(() => {
        statusMessage.textContent = '';
    }, 3000);
}

// =====================================================
// AI Chat Functions
// =====================================================
function addChatMessage(message, isUser = false) {
    const container = document.getElementById('ai-chat-area');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isUser ? 'user' : 'assistant'}`;
    
    if (isUser) {
        messageDiv.innerHTML = `<div class="message-content">${escapeHtml(message)}</div>`;
    } else {
        // Parse markdown for AI messages
        let formatted = message;
        try {
            formatted = marked.parse(message);
        } catch (e) {
            formatted = escapeHtml(message);
        }
        messageDiv.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="message-content">${formatted}</div>
        `;
    }
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

function addTypingIndicator() {
    const container = document.getElementById('ai-chat-area');
    const indicator = document.createElement('div');
    indicator.className = 'chat-message assistant';
    indicator.id = 'typing-indicator';
    indicator.innerHTML = `
        <div class="ai-avatar"><i class="fas fa-robot"></i></div>
        <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>
    `;
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
}

async function sendAIMessage() {
    const input = document.getElementById('ai-input');
    const message = input.value.trim();
    
    if (!message) return;
    
    if (!state.currentProject) {
        addChatMessage('⚠️ Please create or select a project first before I can help with files.', false);
        return;
    }
    
    // Display user message (with image indicator if attached)
    let userMessage = message;
    if (state.attachedImage) {
        userMessage = `🖼️ [Image attached]\n${message}`;
    }
    addChatMessage(userMessage, true);
    
    input.value = '';
    input.style.height = 'auto';
    
    addTypingIndicator();
    
    const result = await API.chat(message);
    
    // Clear attached image after sending
    if (state.attachedImage) {
        removeAttachedImage();
    }
    
    removeTypingIndicator();
    addChatMessage(result.response || 'Sorry, I encountered an error. Please try again.', false);
}

async function clearChat() {
    const container = document.getElementById('ai-chat-area');
    container.innerHTML = `
        <div class="ai-welcome-message">
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="ai-message-content">
                <strong>AI Assistant</strong>
                <p>Chat cleared. How can I help you?</p>
            </div>
        </div>
    `;
    
    // Delete backend chat history
    if (state.currentProject) {
        const result = await API.deleteChatHistory(state.currentProject);
        if (result.success) {
            console.log('Chat history deleted from backend');
        }
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function removeAttachedImage() {
    state.attachedImage = null;
    document.getElementById('ai-image-preview').style.display = 'none';
    document.getElementById('ai-preview-img').src = '';
    document.getElementById('ai-image-input').value = '';
}

// =====================================================
// Terminal Functions
// =====================================================
function addTerminalOutput(text, type = 'normal') {
    const output = document.getElementById('terminal-output');
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    
    if (type === 'command') {
        line.innerHTML = `<span class="terminal-prompt">$</span> ${escapeHtml(text)}`;
    } else {
        line.textContent = text;
    }
    
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

async function runTerminalCommand() {
    const input = document.getElementById('terminal-input');
    const command = input.value.trim();
    if (!command) return;

    // Add to history
    state.terminalHistory.push(command);
    state.terminalHistoryIndex = state.terminalHistory.length;

    addTerminalOutput(command, 'command');
    input.value = '';

    // Handle built-in commands
    if (command === 'clear' || command === 'cls') {
        document.getElementById('terminal-output').innerHTML = '';
        return;
    }

    if (command === 'help') {
        addTerminalOutput('Available commands:', 'success');
        addTerminalOutput('  clear/cls     - Clear terminal');
        addTerminalOutput('  host [port]   - Start built-in web server (default port: 8000)');
        addTerminalOutput('  stop-server   - Stop the preview server');
        addTerminalOutput('  kill <pid>    - Kill a process by PID');
        addTerminalOutput('  ps            - List running processes');
        addTerminalOutput('  help          - Show this help');
        addTerminalOutput('  Any other command will be executed on the server');
        return;
    }

    if (command === 'stop-server' || command === 'stop') {
        if (!state.currentProject) {
            addTerminalOutput('Error: No project selected', 'error');
            return;
        }
        addTerminalOutput('Stopping preview server...', 'normal');
        const result = await API.stopServer();
        if (result.success) {
            addTerminalOutput('✅ ' + result.message, 'success');
        } else {
            addTerminalOutput(result.message || 'No server to stop', 'normal');
        }
        return;
    }

    if (command.startsWith('kill ')) {
        const pid = command.split(' ')[1];
        if (!pid || isNaN(pid)) {
            addTerminalOutput('Usage: kill <pid>', 'error');
            return;
        }
        addTerminalOutput(`Killing process ${pid}...`, 'normal');
        const result = await API.killProcess(pid);
        if (result.success) {
            addTerminalOutput('✅ Process killed', 'success');
        } else {
            addTerminalOutput('Error: ' + (result.error || 'Could not kill process'), 'error');
        }
        return;
    }

    if (command === 'ps' || command === 'processes') {
        addTerminalOutput('Fetching running processes...', 'normal');
        const result = await API.listProcesses();
        if (result.processes && result.processes.length > 0) {
            addTerminalOutput('\nRunning processes:', 'success');
            result.processes.forEach(proc => {
                addTerminalOutput(`  PID ${proc.pid}: ${proc.name}`, 'normal');
            });
        } else {
            addTerminalOutput('No tracked processes running', 'normal');
        }
        return;
    }

    if (command.startsWith('host') || command === 'serve' || command === 'preview') {
        if (!state.currentProject) {
            addTerminalOutput('Error: No project selected', 'error');
            return;
        }
        
        // Extract port if provided
        const portMatch = command.match(/\d{4,5}/);
        const port = portMatch ? parseInt(portMatch[0]) : 8000;
        
        addTerminalOutput(`Starting built-in web server on port ${port}...`, 'normal');
        const result = await API.hostProject(port);
        if (result.url) {
            addTerminalOutput(`✅ Server started successfully!`, 'success');
            addTerminalOutput(`📡 Access at: ${result.url}`, 'success');
            addTerminalOutput(``, 'normal');
            addTerminalOutput(`Open your browser and navigate to the URL above`, 'normal');
        } else if (result.error) {
            addTerminalOutput('Error: ' + result.error, 'error');
        } else {
            addTerminalOutput(result.message || 'Server started', 'success');
            if (result.url) addTerminalOutput(`URL: ${result.url}`, 'success');
        }
        return;
    }

    // Run command on server
    const result = await API.runCommand(command);
    if (result.output) {
        addTerminalOutput(result.output, result.error ? 'error' : 'normal');
    } else if (result.error) {
        addTerminalOutput('Error: ' + result.error, 'error');
    }
}

function clearTerminal() {
    document.getElementById('terminal-output').innerHTML = `
        <div class="terminal-welcome">
            <span class="terminal-green">NOS Code Terminal</span> - Type 'help' for commands
        </div>
    `;
}

// =====================================================
// Panel Management
// =====================================================
function toggleSidebarPanel(panelId) {
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.activity-icon').forEach(i => i.classList.remove('active'));
    
    const panel = document.getElementById(`panel-${panelId}`);
    const icon = document.getElementById(`activity-${panelId}`);
    
    if (panel) panel.classList.add('active');
    if (icon) icon.classList.add('active');
}

function toggleAIPanel() {
    const panel = document.getElementById('ai-panel');
    const resize = document.getElementById('ai-panel-resize');
    state.aiPanelVisible = !state.aiPanelVisible;
    
    if (state.aiPanelVisible) {
        panel.classList.remove('hidden');
        resize.classList.remove('hidden');
    } else {
        panel.classList.add('hidden');
        resize.classList.add('hidden');
    }
}

function toggleBottomPanel() {
    const panel = document.getElementById('bottom-panel');
    state.bottomPanelVisible = !state.bottomPanelVisible;
    
    if (state.bottomPanelVisible) {
        panel.classList.remove('hidden');
    } else {
        panel.classList.add('hidden');
    }
}

function toggleSection(sectionId) {
    const chevron = document.getElementById(`chevron-${sectionId}`);
    const section = document.getElementById(`section-${sectionId}`);
    const header = chevron.parentElement;
    
    header.classList.toggle('collapsed');
    section.classList.toggle('collapsed');
}

function switchBottomTab(tabName) {
    document.querySelectorAll('.bottom-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bottom-panel-content').forEach(c => c.classList.remove('active'));
    
    document.querySelector(`.bottom-tab[data-panel="${tabName}"]`).classList.add('active');
    document.getElementById(`${tabName}-panel`).classList.add('active');
}

// =====================================================
// Quick Actions
// =====================================================
async function executeQuickAction(action) {
    if (!state.currentFile) {
        showNotification('Please open a file first', 'warning');
        return;
    }
    
    const prompts = {
        'explain': 'Explain this code in detail',
        'optimize': 'Optimize this code for better performance',
        'fix': 'Find and fix any bugs in this code',
        'document': 'Add comprehensive documentation and comments to this code'
    };
    
    const prompt = prompts[action];
    if (prompt) {
        document.getElementById('ai-input').value = prompt;
        sendAIMessage();
    }
}

// =====================================================
// Project Management
// =====================================================
async function createProject() {
    const input = document.getElementById('project-name-input');
    const name = input.value.trim();
    
    if (!name) {
        showNotification('Please enter a project name', 'warning');
        return;
    }
    
    await API.createProject(name);
    input.value = '';
    await loadProject(name);
    document.getElementById('project-modal').classList.remove('active');
    showNotification('Project created successfully', 'success');
}

async function deleteProject(name) {
    showDialog(
        'Delete Project',
        `Are you sure you want to delete "${name}"? This cannot be undone.`,
        'confirm',
        '',
        async (confirmed) => {
            if (confirmed) {
                await API.deleteProject(name);
                
                if (state.currentProject === name) {
                    state.currentProject = null;
                    state.currentFile = null;
                    state.openFiles = [];
                    state.fileContents = {};
                    state.modifiedFiles.clear();
                    editor.setValue('', -1);
                    document.getElementById('welcome-screen').classList.remove('hidden');
                    document.getElementById('files-section-title').textContent = 'NO FOLDER OPENED';
                    document.getElementById('status-project-name').textContent = 'No project';
                    updateFileTabs();
                }
                
                await updateProjectsList();
                showNotification('Project deleted', 'success');
            }
        }
    );
}

async function createNewFile() {
    if (!state.currentProject) {
        showNotification('Please create or select a project first', 'warning');
        return;
    }
    
    const input = document.getElementById('file-name-input');
    const name = input.value.trim();
    
    if (!name) {
        showNotification('Please enter a filename', 'warning');
        return;
    }
    
    const filepath = state.currentPath ? `${state.currentPath}/${name}` : name;
    await API.writeFile(state.currentProject, filepath, '');
    input.value = '';
    document.getElementById('file-modal').classList.remove('active');
    await loadFolder(state.currentPath);
    await loadFile(filepath);
    showNotification('File created', 'success');
}

async function createNewFolder() {
    if (!state.currentProject) {
        showNotification('Please create or select a project first', 'warning');
        return;
    }
    
    const input = document.getElementById('folder-name-input');
    const name = input.value.trim();
    
    if (!name) {
        showNotification('Please enter a folder name', 'warning');
        return;
    }
    
    const folderPath = state.currentPath ? `${state.currentPath}/${name}` : name;
    // Create a placeholder file to create the folder
    await API.writeFile(state.currentProject, `${folderPath}/.gitkeep`, '');
    input.value = '';
    document.getElementById('folder-modal').classList.remove('active');
    await loadFolder(state.currentPath);
    showNotification('Folder created', 'success');
}

// =====================================================
// Resize Handlers
// =====================================================
function initResizeHandlers() {
    // Sidebar resize
    const sidebarResize = document.getElementById('sidebar-resize');
    const sidebar = document.getElementById('sidebar');
    
    let isResizingSidebar = false;
    
    sidebarResize.addEventListener('mousedown', (e) => {
        isResizingSidebar = true;
        sidebarResize.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
    
    // AI Panel resize
    const aiPanelResize = document.getElementById('ai-panel-resize');
    const aiPanel = document.getElementById('ai-panel');
    
    let isResizingAI = false;
    
    aiPanelResize.addEventListener('mousedown', (e) => {
        isResizingAI = true;
        aiPanelResize.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
    
    // Bottom panel resize
    const bottomPanelResize = document.getElementById('bottom-panel-resize');
    const bottomPanel = document.getElementById('bottom-panel');
    
    let isResizingBottom = false;
    
    bottomPanelResize.addEventListener('mousedown', (e) => {
        isResizingBottom = true;
        bottomPanelResize.classList.add('active');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isResizingSidebar) {
            const newWidth = Math.min(Math.max(e.clientX - 48, 170), 500);
            sidebar.style.width = newWidth + 'px';
        }
        
        if (isResizingAI) {
            const newWidth = Math.min(Math.max(window.innerWidth - e.clientX, 280), 600);
            aiPanel.style.width = newWidth + 'px';
        }
        
        if (isResizingBottom) {
            const editorWrapper = document.querySelector('.editor-wrapper');
            const wrapperRect = editorWrapper.getBoundingClientRect();
            const newHeight = Math.min(Math.max(wrapperRect.bottom - e.clientY, 100), 500);
            bottomPanel.style.height = newHeight + 'px';
        }
    });
    
    document.addEventListener('mouseup', () => {
        isResizingSidebar = false;
        isResizingAI = false;
        isResizingBottom = false;
        sidebarResize.classList.remove('active');
        aiPanelResize.classList.remove('active');
        bottomPanelResize.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        // Resize editor after panel changes
        if (editor) editor.resize();
    });
}

// =====================================================
// Event Listeners
// =====================================================
function initEventListeners() {
    // Activity bar
    document.getElementById('activity-explorer').addEventListener('click', () => toggleSidebarPanel('explorer'));
    document.getElementById('activity-search').addEventListener('click', () => toggleSidebarPanel('search'));
    document.getElementById('activity-git').addEventListener('click', () => toggleSidebarPanel('git'));
    document.getElementById('activity-ai').addEventListener('click', toggleAIPanel);
    
    // Sidebar buttons
    document.getElementById('btn-new-file').addEventListener('click', () => {
        if (!state.currentProject) {
            showNotification('Please create or select a project first', 'warning');
            return;
        }
        document.getElementById('file-modal').classList.add('active');
        document.getElementById('file-name-input').focus();
    });
    
    document.getElementById('btn-new-folder').addEventListener('click', () => {
        if (!state.currentProject) {
            showNotification('Please create or select a project first', 'warning');
            return;
        }
        document.getElementById('folder-modal').classList.add('active');
        document.getElementById('folder-name-input').focus();
    });
    
    document.getElementById('btn-refresh').addEventListener('click', () => {
        if (state.currentProject) {
            loadFolder(state.currentPath);
        }
    });
    
    document.getElementById('btn-open-project').addEventListener('click', () => {
        document.getElementById('project-modal').classList.add('active');
        loadProjectList();
    });
    
    // Project modal
    document.getElementById('btn-create-project').addEventListener('click', createProject);
    document.getElementById('project-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createProject();
    });
    
    // File modal
    document.getElementById('btn-create-file').addEventListener('click', createNewFile);
    document.getElementById('file-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createNewFile();
    });
    
    // Folder modal
    document.getElementById('btn-create-folder').addEventListener('click', createNewFolder);
    document.getElementById('folder-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createNewFolder();
    });
    
    // AI Panel
    document.getElementById('btn-send-ai').addEventListener('click', sendAIMessage);
    document.getElementById('ai-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendAIMessage();
        }
    });
    
    // Auto-resize AI input
    document.getElementById('ai-input').addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 150) + 'px';
    });
    
    document.getElementById('btn-clear-chat').addEventListener('click', clearChat);
    document.getElementById('btn-toggle-ai-panel').addEventListener('click', toggleAIPanel);
    
    // Quick actions
    document.querySelectorAll('.quick-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            executeQuickAction(btn.dataset.action);
        });
    });
    
    // AI mode tabs
    document.querySelectorAll('.ai-mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.ai-mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
        });
    });
    
    // Bottom panel
    document.querySelectorAll('.bottom-tab').forEach(tab => {
        tab.addEventListener('click', () => switchBottomTab(tab.dataset.panel));
    });
    
    document.getElementById('btn-clear-terminal').addEventListener('click', clearTerminal);
    document.getElementById('btn-close-panel').addEventListener('click', toggleBottomPanel);
    document.getElementById('btn-maximize-panel').addEventListener('click', () => {
        const panel = document.getElementById('bottom-panel');
        state.bottomPanelMaximized = !state.bottomPanelMaximized;
        panel.classList.toggle('maximized');
        if (editor) editor.resize();
    });
    
    // AI image attachment handlers
    document.getElementById('btn-attach-image').addEventListener('click', () => {
        document.getElementById('ai-image-input').click();
    });
    
    document.getElementById('ai-image-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (event) => {
                state.attachedImage = event.target.result; // Base64 encoded image
                document.getElementById('ai-preview-img').src = event.target.result;
                document.getElementById('ai-image-preview').style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    });
    
    document.getElementById('btn-remove-image').addEventListener('click', removeAttachedImage);
    
    // Terminal input
    document.getElementById('terminal-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            runTerminalCommand();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (state.terminalHistoryIndex > 0) {
                state.terminalHistoryIndex--;
                e.target.value = state.terminalHistory[state.terminalHistoryIndex];
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (state.terminalHistoryIndex < state.terminalHistory.length - 1) {
                state.terminalHistoryIndex++;
                e.target.value = state.terminalHistory[state.terminalHistoryIndex];
            } else {
                state.terminalHistoryIndex = state.terminalHistory.length;
                e.target.value = '';
            }
        }
    });
    
    // Modal close on background click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
    
    // Dialog overlay
    document.getElementById('dialog-overlay').addEventListener('click', hideDialog);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+S - Save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveFile();
        }
        
        // Ctrl+` - Toggle terminal
        if ((e.ctrlKey || e.metaKey) && e.key === '`') {
            e.preventDefault();
            toggleBottomPanel();
        }
        
        // Ctrl+Shift+E - Explorer
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
            e.preventDefault();
            toggleSidebarPanel('explorer');
        }
        
        // Ctrl+Shift+F - Search
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            toggleSidebarPanel('search');
            document.getElementById('search-input').focus();
        }
        
        // Escape - Close modals
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
            hideDialog();
        }
    });
}

// Load project list helper
async function loadProjectList() {
    await updateProjectsList();
}

// =====================================================
// Initialize Application
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
    initEditor();
    initEventListeners();
    initResizeHandlers();
    updateProjectsList();
    initMobileHandlers();
    
    // Focus editor when clicking on editor area
    document.getElementById('editor-area').addEventListener('click', () => {
        if (editor) editor.focus();
    });
});

// =====================================================
// Mobile Responsive Handlers
// =====================================================
function initMobileHandlers() {
    const mobileToolbar = document.querySelector('.mobile-toolbar');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileAiBtn = document.getElementById('mobile-ai-btn');
    const mobileTerminalBtn = document.getElementById('mobile-terminal-btn');
    const mobileBackdrop = document.getElementById('mobile-backdrop');
    const sidebar = document.querySelector('.sidebar');
    const aiPanel = document.getElementById('ai-panel');
    const bottomPanel = document.getElementById('bottom-panel');
    const mobileTitle = document.getElementById('mobile-title');
    
    let isMobile = false;
    
    // Close all mobile panels
    function closeAllPanels() {
        sidebar.classList.remove('mobile-open');
        aiPanel.classList.remove('mobile-open');
        bottomPanel.classList.remove('mobile-open');
        mobileBackdrop.classList.remove('active');
    }
    
    // Show mobile toolbar on small screens
    function checkMobile() {
        isMobile = window.innerWidth <= 768;
        if (isMobile) {
            mobileToolbar.style.display = 'flex';
        } else {
            mobileToolbar.style.display = 'none';
            closeAllPanels();
        }
    }
    
    // Update mobile title with current file
    function updateMobileTitle() {
        if (currentProject && currentFile) {
            mobileTitle.textContent = currentFile.split('/').pop();
        } else if (currentProject) {
            mobileTitle.textContent = currentProject;
        } else {
            mobileTitle.textContent = 'NOS Code';
        }
    }
    
    // Toggle sidebar
    mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = sidebar.classList.contains('mobile-open');
        closeAllPanels();
        if (!isOpen) {
            sidebar.classList.add('mobile-open');
            mobileBackdrop.classList.add('active');
        }
    });
    
    // Toggle AI panel
    mobileAiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = aiPanel.classList.contains('mobile-open');
        closeAllPanels();
        if (!isOpen) {
            aiPanel.classList.add('mobile-open');
            mobileBackdrop.classList.add('active');
        }
    });
    
    // Toggle Terminal
    mobileTerminalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = bottomPanel.classList.contains('mobile-open');
        closeAllPanels();
        if (!isOpen) {
            bottomPanel.classList.add('mobile-open');
            mobileBackdrop.classList.add('active');
        }
    });
    
    // Close panels when backdrop clicked
    mobileBackdrop.addEventListener('click', closeAllPanels);
    
    // Swipe down to close AI panel
    let aiPanelStartY = 0;
    let aiPanelCurrentY = 0;
    let aiPanelHeight = 0;
    
    const aiPanelHeader = aiPanel.querySelector('.ai-panel-header');
    if (aiPanelHeader) {
        aiPanelHeader.addEventListener('touchstart', (e) => {
            if (!isMobile) return;
            aiPanelStartY = e.touches[0].clientY;
            aiPanelHeight = aiPanel.offsetHeight;
            aiPanel.style.transition = 'none';
        }, { passive: true });
        
        aiPanelHeader.addEventListener('touchmove', (e) => {
            if (!isMobile || aiPanelStartY === 0) return;
            aiPanelCurrentY = e.touches[0].clientY;
            const diff = aiPanelCurrentY - aiPanelStartY;
            if (diff > 0) {
                aiPanel.style.transform = `translateY(${diff}px)`;
            }
        }, { passive: true });
        
        aiPanelHeader.addEventListener('touchend', () => {
            if (!isMobile) return;
            aiPanel.style.transition = '';
            const diff = aiPanelCurrentY - aiPanelStartY;
            if (diff > 100) {
                closeAllPanels();
            }
            aiPanel.style.transform = '';
            aiPanelStartY = 0;
            aiPanelCurrentY = 0;
        });
    }
    
    // Swipe down to close terminal panel
    let terminalStartY = 0;
    let terminalCurrentY = 0;
    
    const bottomPanelHeader = bottomPanel.querySelector('.bottom-panel-header');
    if (bottomPanelHeader) {
        bottomPanelHeader.addEventListener('touchstart', (e) => {
            if (!isMobile) return;
            terminalStartY = e.touches[0].clientY;
            bottomPanel.style.transition = 'none';
        }, { passive: true });
        
        bottomPanelHeader.addEventListener('touchmove', (e) => {
            if (!isMobile || terminalStartY === 0) return;
            terminalCurrentY = e.touches[0].clientY;
            const diff = terminalCurrentY - terminalStartY;
            if (diff > 0) {
                bottomPanel.style.transform = `translateY(${diff}px)`;
            }
        }, { passive: true });
        
        bottomPanelHeader.addEventListener('touchend', () => {
            if (!isMobile) return;
            bottomPanel.style.transition = '';
            const diff = terminalCurrentY - terminalStartY;
            if (diff > 100) {
                closeAllPanels();
            }
            bottomPanel.style.transform = '';
            terminalStartY = 0;
            terminalCurrentY = 0;
        });
    }
    
    // Close sidebar when file is selected on mobile
    const originalLoadFile = window.loadFile;
    window.loadFile = function(...args) {
        if (isMobile) {
            closeAllPanels();
            setTimeout(updateMobileTitle, 100);
        }
        return originalLoadFile.apply(this, args);
    };
    
    // Update title when project changes
    const originalSwitchProject = window.switchProject;
    window.switchProject = function(...args) {
        const result = originalSwitchProject.apply(this, args);
        updateMobileTitle();
        return result;
    };
    
    // Handle escape key to close panels
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isMobile) {
            closeAllPanels();
        }
    });
    
    // Check on load and resize
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    // Initial title update
    updateMobileTitle();
    
    // Expose for external use
    window.closeMobilePanels = closeAllPanels;
    window.updateMobileTitle = updateMobileTitle;
}

