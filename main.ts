import { App, MarkdownView, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { Editor } from "codemirror";

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

                let files = e.clipboardData.files;
                if (files.length === 0 || !files[0].type.startsWith("image")) {
                    return originalPasteHandler(_, e);
                }

                for (let i = 0; i < files.length; i++) {
                    this.downloadFileAndEmbedImgmanImage(files[i]).catch(console.error);
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

    async downloadFileAndEmbedImgmanImage(file: File) {
        let pasteId = (Math.random() + 1).toString(36).substr(2, 5);
        this.insertTemporaryText(pasteId);

        try {
            let resp = await this.downloadFile(file);
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

    insertTemporaryText(pasteId: string) {
        let progressText = ImgmanPlugin.progressTextFor(pasteId);
        this.getEditor().replaceSelection(progressText + "\n");
    }

    private static progressTextFor(id: string) {
        return `![Downloading file...${id}]()`
    }
/**
 * TODO 
 * @param file 
 */
    downloadFile(file: File) {
        const res = { ok: true, text: '', url: '' };
        return res;
    }

    embedMarkDownImage(pasteId: string, jsonResponse: any) {
        let imageUrl = jsonResponse.data.link;

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
