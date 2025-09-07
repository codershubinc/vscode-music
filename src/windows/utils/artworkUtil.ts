import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

/**
 * Utility class for handling music artwork downloads and caching
 */
export class ArtworkUtil {
    private static artworkCache = new Map<string, string>();
    private static extensionContext: vscode.ExtensionContext;

    public static initialize(context: vscode.ExtensionContext) {
        this.extensionContext = context;
    }

    /**
     * Downloads and caches artwork from URL or copies from file:// path
     * @param artUrl The artwork URL (file://, http://, or https://)
     * @returns Promise<string | null> Local file URI or null if failed
     */
    public static async downloadArtwork(artUrl: string): Promise<string | null> {
        if (!artUrl || !this.extensionContext) {
            return null;
        }

        try {
            // Check cache first
            if (this.artworkCache.has(artUrl)) {
                return this.artworkCache.get(artUrl)!;
            }

            // Handle file:// URLs by copying to extension storage
            if (artUrl.startsWith('file://')) {
                console.log('Handling file URL for artwork:', artUrl);

                return this.handleFileUrl(artUrl);
            }

            // Handle HTTP/HTTPS URLs
            if (artUrl.startsWith('http://') || artUrl.startsWith('https://')) {
                return this.handleHttpUrl(artUrl);
            }

            // Skip unsupported URLs
            return null;

        } catch (error) {
            console.error('Error downloading artwork:', error);
            return null;
        }
    }

    private static async handleFileUrl(artUrl: string): Promise<string | null> {
        const sourcePath = artUrl.replace('file://', '');

        // Check if source file exists
        if (!fs.existsSync(sourcePath)) {
            return null;
        }

        // Create artwork directory in extension's global storage
        const artworkDir = this.getArtworkDirectory();

        // Generate filename from source path hash
        const pathHash = Buffer.from(sourcePath).toString('base64').replace(/[/+=]/g, '_');
        const extension = path.extname(sourcePath) || '.jpg';
        const filename = `artwork_${pathHash}${extension}`;
        const localPath = path.join(artworkDir, filename);

        // Copy file if not already copied
        if (!fs.existsSync(localPath)) {
            fs.copyFileSync(sourcePath, localPath);
        }

        const vscodeUri = vscode.Uri.file(localPath).toString();
        console.log('Copied artwork from file URL:', vscodeUri);

        this.artworkCache.set(artUrl, vscodeUri);
        console.log('Cached artwork URI for', artUrl, ':', vscodeUri);

        return vscodeUri;
    }

    private static async handleHttpUrl(artUrl: string): Promise<string | null> {
        // Create artwork directory in extension's global storage
        const artworkDir = this.getArtworkDirectory();

        // Generate filename from URL hash
        const urlHash = Buffer.from(artUrl).toString('base64').replace(/[/+=]/g, '_');
        const filename = `artwork_${urlHash}.jpg`;
        const localPath = path.join(artworkDir, filename);

        // Check if already downloaded
        if (fs.existsSync(localPath)) {
            const vscodeUri = vscode.Uri.file(localPath).toString();
            this.artworkCache.set(artUrl, vscodeUri);
            return vscodeUri;
        }

        // Download the artwork
        return new Promise((resolve) => {
            const protocol = artUrl.startsWith('https://') ? https : http;

            protocol.get(artUrl, (response) => {
                if (response.statusCode === 200) {
                    const fileStream = fs.createWriteStream(localPath);
                    response.pipe(fileStream);

                    fileStream.on('finish', () => {
                        fileStream.close();
                        const vscodeUri = vscode.Uri.file(localPath).toString();
                        this.artworkCache.set(artUrl, vscodeUri);
                        resolve(vscodeUri);
                    });
                } else {
                    resolve(null);
                }
            }).on('error', () => {
                resolve(null);
            });
        });
    }

    private static getArtworkDirectory(): string {
        const artworkDir = path.join(this.extensionContext.globalStorageUri.fsPath, 'artwork');
        if (!fs.existsSync(artworkDir)) {
            fs.mkdirSync(artworkDir, { recursive: true });
        }
        return artworkDir;
    }

    /**
     * Clear artwork cache
     */
    public static clearCache(): void {
        this.artworkCache.clear();
    }

    /**
     * Get cached artwork URI if exists
     */
    public static getCachedArtwork(artUrl: string): string | null {
        return this.artworkCache.get(artUrl) || null;
    }
}