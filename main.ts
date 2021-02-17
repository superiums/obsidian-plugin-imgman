import { App, MarkdownView, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { Editor } from "codemirror";
import { RSA_NO_PADDING } from 'constants';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const regexImage = /\!\[[^\]]*\]\((http[s]?:\/\/.+?)\)/g
const regexImageURL = /http(s)?:\/\/[^\)\]]+/
const regexFileNameExtention = /\.([^\.\/#\?]+)/

interface ImgmanPluginSettings {
    // clientId: string;
    dir: string;
    saveWhenPaste: boolean;
}

const DEFAULT_SETTINGS: ImgmanPluginSettings = {
    // clientId: null,
    dir: '',
    saveWhenPaste: true
}

export default class ImgmanPlugin extends Plugin {
    settings: ImgmanPluginSettings;
    readonly cmAndHandlersMap = new Map;


    async loadSettings() {
        this.settings = Object.assign(DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        this.restoreOriginalHandlers();
        this.addCommand({
            id: "toggle-wiki-md-links",
            name: "Toggle selected wikilink to markdown link and vice versa",
            checkCallback: (checking: boolean) => {
                const currentView = this.app.workspace.getActiveViewOfType(MarkdownView)
                if ((currentView == null) || (currentView.getMode() !== 'source')) {
                    return false
                }

                if (!checking) {
                    this.toggleLink()
                }

                return true
            },
            hotkeys: [{
                modifiers: ["Mod", "Shift"],
                key: "M"
            }]
        })
    }
    toggleLink() {
        console.log('to', this.settings.dir)
        const editor = this.getEditor();


        const doc = editor.getDoc().eachLine((line: CodeMirror.LineHandle) => {
            const m = line.text.match(regexImage)
            if (m) {
                for (const link of m) {
                    const downLink = link.match(regexImageURL)[0]
                    this.downloadFileAndEmbedImgmanImage(downLink)
                }
            }
        });
    }

    restoreOriginalHandlers() {
        this.cmAndHandlersMap.forEach((originalHandler, cm) => {
            cm._handlers.paste[0] = originalHandler;
        })
    }

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ImgmanSettingTab(this.app, this));
        this.setupImgmanPasteHandler();
    }

    setupImgmanPasteHandler() {
        console.log('activefile',this.app.workspace.getActiveFile())
        console.log('activeleaf',this.app.workspace.activeLeaf)
        console.log('root',this.app.vault.getRoot())
        console.log('cache',this.app.metadataCache.getFileCache.toString())


        this.registerCodeMirror((cm: any) => {
            let originalPasteHandler = this.backupOriginalPasteHandler(cm);

            cm._handlers.paste[0] = (_: any, e: ClipboardEvent) => {
                // if (!this.settings.clientId) {
                //     console.warn("Please either set Imgman client id or disable the plugin");
                //     return originalPasteHandler(_, e);
                // }
                if (!this.settings.saveWhenPaste) {
                    return originalPasteHandler(_, e)
                }

                let urls = e.clipboardData.getData('URL');
                console.log('pasted URL :', urls)
                if (urls.length === 0) {
                    return originalPasteHandler(_, e);
                }

                for (let i = 0; i < urls.length; i++) {
                    this.downloadFileAndEmbedImgmanImage(urls[i]).catch(console.error);
                }
            };
        });
    }

    backupOriginalPasteHandler(cm: any) {
        if (!this.cmAndHandlersMap.has(cm)) {
            let originalHandler = cm._handlers.paste[0];
            this.cmAndHandlersMap.set(cm, originalHandler);
        }

        return this.cmAndHandlersMap.get(cm);
    }

    async downloadFileAndEmbedImgmanImage(link: string) {
        console.log('downloadFileAndEmbedImgmanImage', link)
        let pasteId = (Math.random() + 1).toString(36).substr(2, 5);

        try {
            let resp = await this.downloadFile(link);
            if (!resp.ok) {
                let err = { response: resp, body: resp.text };
                this.handleFailedDownload(pasteId, err)
                return
            }
            this.embedMarkDownImage(pasteId, resp.url)
        } catch (e) {
            this.handleFailedDownload(pasteId, e)
        }
    }


    private static progressTextFor(id: string) {
        return `![Downloading file...${id}]()`
    }
    /**
     * TODO 
     * @param link 
     */
    async downloadFile(link: string) {
        const res = { ok: true, text: 'null link address!', url: '' };
        if (!link) {
            console.log('skip', link)
            return res;
        }
        const fileName = Date.now() + '.png'//+ regexFileNameExtention.exec(link); 

        const dest = path.join('/', this.settings.dir)
        console.log('downloading', link, 'to', dest)
        const down = await this.downloadFileAsync(link, dest, fileName)
        if (down) {
            res.url = dest
            res.ok = true;
        }
        return res;
    }

    embedMarkDownImage(pasteId: string, imageUrl: string) {
        let progressText = ImgmanPlugin.progressTextFor(pasteId);
        let markDownImage = `![](${imageUrl})`;

        ImgmanPlugin.replaceFirstOccurrence(this.getEditor(), progressText, markDownImage);
    };

    handleFailedDownload(pasteId: string, reason: any) {
        console.error("Failed Imgman request: ", reason);
        let progressText = ImgmanPlugin.progressTextFor(pasteId);
        ImgmanPlugin.replaceFirstOccurrence(this.getEditor(), progressText, "⚠️Imgman download failed, check dev console");
    };

    static replaceFirstOccurrence(editor: Editor, target: string, replacement: string) {
        let lines = editor.getValue().split('\n');
        for (let i = 0; i < lines.length; i++) {
            let ch = lines[i].indexOf(target);
            if (ch != -1) {
                let from = { line: i, ch: ch };
                let to = { line: i, ch: ch + target.length };
                editor.replaceRange(replacement, from, to);
                break;
            }
        }
    }

    getEditor(): Editor {
        let view = this.app.workspace.activeLeaf.view as MarkdownView;
        return view.sourceMode.cmEditor;
    }



    downloadFileAsync(uri: string, dir: string, fileName: string) {
        return new Promise((resolve, reject) => {
            // 确保dest路径存在
            if (!fs.existsSync(dir)) {
                console.log('making dir',dir)
                fs.mkdirSync(dir)
            }
            const dest = path.join(dir, fileName)
            const file = fs.createWriteStream(dest);
            const req = uri.startsWith('https') ? https : http;
            req.request(uri,{method:'get'}, (res: any) => {
                console.log('res',res)
                if (res.statusCode !== 200) {
                    console.log('request failed',res.statusCode)
                    reject(res.statusCode);
                    return;
                }

                file.on('end', () => {
                    console.log('download end');
                });

                // 进度、超时等

                file.on('finish', () => {
                    console.log('finish write file', uri)
                    file.close(resolve);
                }).on('error', (err: any) => {
                    console.log('while use file write stream, error:',err)
                    fs.unlink(dest);
                    reject(err.message);
                })

                res.pipe(file);
            });

        });
    }

}

class ImgmanSettingTab extends PluginSettingTab {
    plugin: ImgmanPlugin;

    constructor(app: App, plugin: ImgmanPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let { containerEl } = this;

        containerEl.empty();
        containerEl.createEl('h2', { text: 'image manager plugin settings' });
        new Setting(containerEl)
            .setName('auto')
            .setDesc('Save image while paste')
            .addToggle(r => r
                .setValue(this.plugin.settings.saveWhenPaste)
                .onChange(async (value) => {
                    this.plugin.settings.saveWhenPaste = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Directory')
            .setDesc('Directory to save image')
            .addText(text => text.setPlaceholder('current directory')
                .setValue(this.plugin.settings.dir)
                .onChange(async (value) => {
                    this.plugin.settings.dir = value;
                    await this.plugin.saveSettings();
                }));
    }

}
