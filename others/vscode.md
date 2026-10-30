```json
// settings.json & keybindings.json
{
    "chat.agentHost.byokModels.enabled": true,
    "editor.fontFamily": "'CourierNew Nerd Font', 'Courier New', Menlo, Monaco, monospace",
    "files.exclude": {
        "**/.venv": true,
        "**/node_modules": true
    },
    "git.addAICoAuthor": "off",
    "terminal.integrated.env.osx": {
        "LANG": "zh_CN.UTF-8"
    },
    "terminal.integrated.profiles.osx": {
        "zsh": {
            "path": "zsh",
            "args": [
                "-i"
            ]
        }
    },
    "terminal.integrated.macOptionIsMeta": true,
    "terminal.integrated.macOptionClickForcesSelection": true,
    "workbench.activityBar.location": "top",
    "workbench.panel.showLabels": false,
    "python.terminal.activateEnvironment": false,
    "python.analysis.autoFormatStrings": true,
    "python.analysis.autoImportCompletions": true,
    "python.terminal.useEnvFile": true,
    "workbench.editorAssociations": {
        "*.copilotmd": "vscode.markdown.preview.editor",
        "*.md": "vscode.markdown.editor"
    },
    
    "git.enableSmartCommit": true
}

// Place your key bindings in this file to override the defaults
[
    {
        "key": "ctrl+cmd+j",
        "command": "workbench.action.positionPanelBottom"
    },
    {
        "key": "ctrl+cmd+k",
        "command": "workbench.action.positionPanelRight"
    },
    {
        "key": "shift+enter",
        "command": "workbench.action.terminal.sendSequence",
        "args": {
            "text": "\u001b\r"
        },
        "when": "terminalFocus"
    }
]
```