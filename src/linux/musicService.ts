import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { TrackInfo } from '../common/interfaces/musicController';

export { TrackInfo };

export class LinuxMusicService {
    private updateInterval: NodeJS.Timeout | null = null;
    private currentTrack: TrackInfo | null = null;
    private onTrackChangedCallback?: (track: TrackInfo | null) => void;
    private onPositionChangedCallback?: (position: number) => void;
    private isPlayerctlAvailable = false;
    private extensionContext: vscode.ExtensionContext;
    private artworkCache = new Map<string, string>();

    constructor(context: vscode.ExtensionContext) {
        this.extensionContext = context;
        this.initialize();
    }

    public async initialize() {
        await this.checkPlayerctlAvailability();
        this.startPolling();
    }

    private async checkPlayerctlAvailability(): Promise<void> {
        return new Promise((resolve) => {
            const playerctl = spawn('playerctl', ['--version']);

            playerctl.on('exit', (code) => {
                this.isPlayerctlAvailable = code === 0;
                if (!this.isPlayerctlAvailable) {
                    console.warn('Linux Music Service: playerctl not available - music controls will be limited');
                }
                resolve();
            });

            playerctl.on('error', () => {
                console.warn('Linux Music Service: playerctl not found on system');
                this.isPlayerctlAvailable = false;
                resolve();
            });
        });
    }

    private startPolling() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        this.updateInterval = setInterval(async () => {
            try {
                const track = await this.getCurrentTrack();

                if (this.hasTrackChanged(track)) {
                    this.currentTrack = track;

                    // Download and cache artwork if available
                    if (track && track.artUrl) {
                        const artworkPath = await this.downloadArtwork(track.artUrl);
                        if (artworkPath) {
                            track.artUrl = artworkPath;
                        }
                    }

                    this.onTrackChangedCallback?.(track);
                }
            } catch (error) {
                // Track changed to null or error occurred
                if (this.currentTrack !== null) {
                    this.currentTrack = null;
                    this.onTrackChangedCallback?.(null);
                }
            }
        }, 1000);
    }

    private hasTrackChanged(newTrack: TrackInfo | null): boolean {
        if (!this.currentTrack && !newTrack) {
            return false;
        }

        if (!this.currentTrack || !newTrack) {
            return true;
        }

        return (
            this.currentTrack.title !== newTrack.title ||
            this.currentTrack.artist !== newTrack.artist ||
            this.currentTrack.status !== newTrack.status ||
            Math.abs((this.currentTrack.position || 0) - (newTrack.position || 0)) > 2
        );
    }

    public async getCurrentTrack(): Promise<TrackInfo | null> {
        if (!this.isPlayerctlAvailable) {
            return null;
        }

        return new Promise((resolve, reject) => {
            // Use a simpler delimiter-based approach that's more reliable
            const delimiter = '|||';
            const playerctl = spawn('playerctl', [
                'metadata',
                '--format',
                `{{title}}${delimiter}{{mpris:artUrl}}${delimiter}{{artist}}${delimiter}{{album}}${delimiter}{{duration(position)}}${delimiter}{{duration(mpris:length)}}${delimiter}{{status}}${delimiter}{{playerName}}`
            ]);

            let output = '';
            playerctl.stdout.on('data', (data) => {
                output += data.toString();
            });

            playerctl.on('close', (code) => {
                if (code === 0 && output.trim()) {
                    try {
                        const cleanedOutput = output.trim();

                        const parts = cleanedOutput.split(delimiter); if (parts.length >= 8) {
                            const track: TrackInfo = {
                                title: parts[0] || 'Unknown Title',
                                artUrl: parts[1] || '',
                                artist: parts[2] || 'Unknown Artist',
                                album: parts[3] || 'Unknown Album',
                                position: this.parseDuration(parts[4]),
                                duration: this.parseDuration(parts[5]),
                                status: (parts[6]?.toLowerCase() as any) || 'stopped',
                                player: parts[7] || 'Unknown Player'
                            };
                            resolve(track);
                        } else {
                            console.error('Unexpected playerctl output format. Expected 8 parts, got:', parts.length);
                            console.error('Parts:', parts);
                            resolve(null);
                        }
                    } catch (error) {
                        console.error('Failed to parse playerctl output:', error);
                        console.error('Raw output was:', JSON.stringify(output));
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });

            playerctl.on('error', () => {
                resolve(null);
            });
        });
    }

    private parseDuration(duration: string): number {
        if (!duration) {
            return 0;
        }
        const parts = duration.split(':');
        if (parts.length === 2) {
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        }
        return 0;
    }

    private async downloadArtwork(artworkUrl: string): Promise<string | null> {
        if (!artworkUrl) {
            return null;
        }

        // Check cache first
        if (this.artworkCache.has(artworkUrl)) {
            return this.artworkCache.get(artworkUrl)!;
        }

        try {
            // Handle file:// URLs (common with GSConnect)
            if (artworkUrl.startsWith('file://')) {
                const filePath = artworkUrl.replace('file://', '');
                if (fs.existsSync(filePath)) {
                    const uploadsDir = path.join(this.extensionContext.globalStorageUri.fsPath, 'uploads');
                    if (!fs.existsSync(uploadsDir)) {
                        fs.mkdirSync(uploadsDir, { recursive: true });
                    }

                    const fileName = path.basename(filePath);
                    const targetPath = path.join(uploadsDir, fileName);

                    // Copy file to extension storage
                    fs.copyFileSync(filePath, targetPath);

                    // Create vscode URI for webview
                    const webviewUri = vscode.Uri.file(targetPath).with({ scheme: 'vscode-resource' });
                    this.artworkCache.set(artworkUrl, webviewUri.toString());
                    return webviewUri.toString();
                }
                return null;
            }

            // Handle HTTP/HTTPS URLs
            if (artworkUrl.startsWith('http')) {
                const uploadsDir = path.join(this.extensionContext.globalStorageUri.fsPath, 'uploads');
                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }

                const fileName = `artwork_${Date.now()}.jpg`;
                const filePath = path.join(uploadsDir, fileName);

                await this.downloadFile(artworkUrl, filePath);

                const webviewUri = vscode.Uri.file(filePath).with({ scheme: 'vscode-resource' });
                this.artworkCache.set(artworkUrl, webviewUri.toString());
                return webviewUri.toString();
            }

            return null;
        } catch (error) {
            console.error('Error downloading artwork:', error);
            return null;
        }
    }

    private downloadFile(url: string, filePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;

            protocol.get(url, (response) => {
                if (response.statusCode === 200) {
                    const fileStream = fs.createWriteStream(filePath);
                    response.pipe(fileStream);

                    fileStream.on('finish', () => {
                        fileStream.close();
                        resolve();
                    });

                    fileStream.on('error', reject);
                } else {
                    reject(new Error(`HTTP ${response.statusCode}`));
                }
            }).on('error', reject);
        });
    }

    // Control methods
    public async playPause(): Promise<void> {
        if (!this.isPlayerctlAvailable) {
            vscode.window.showWarningMessage('playerctl is not available. Please install it to control music playback.');
            return;
        }

        return new Promise((resolve, reject) => {
            const playerctl = spawn('playerctl', ['play-pause']);
            playerctl.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`playerctl play-pause failed with code ${code}`));
                }
            });
        });
    }

    public async next(): Promise<void> {
        if (!this.isPlayerctlAvailable) {
            vscode.window.showWarningMessage('playerctl is not available. Please install it to control music playback.');
            return;
        }

        return new Promise((resolve, reject) => {
            const playerctl = spawn('playerctl', ['next']);
            playerctl.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`playerctl next failed with code ${code}`));
                }
            });
        });
    }

    public async previous(): Promise<void> {
        if (!this.isPlayerctlAvailable) {
            vscode.window.showWarningMessage('playerctl is not available. Please install it to control music playback.');
            return;
        }

        return new Promise((resolve, reject) => {
            const playerctl = spawn('playerctl', ['previous']);
            playerctl.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`playerctl previous failed with code ${code}`));
                }
            });
        });
    }

    public async getPosition(): Promise<number | null> {
        if (!this.isPlayerctlAvailable) {
            return null;
        }

        return new Promise((resolve) => {
            const playerctl = spawn('playerctl', ['position']);
            let stdout = '';

            playerctl.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            playerctl.on('exit', (code) => {
                if (code === 0 && stdout.trim()) {
                    const position = parseFloat(stdout.trim());
                    resolve(isNaN(position) ? null : position);
                } else {
                    resolve(null);
                }
            });

            playerctl.on('error', () => {
                resolve(null);
            });
        });
    }

    // Event handlers
    public onTrackChanged(callback: (track: TrackInfo | null) => void) {
        this.onTrackChangedCallback = callback;
    }

    public onPositionChanged(callback: (position: number) => void) {
        this.onPositionChangedCallback = callback;
    }

    // Getters
    public get currentTrackInfo(): TrackInfo | null {
        return this.currentTrack;
    }

    public get isAvailable(): boolean {
        return this.isPlayerctlAvailable;
    }

    public dispose() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.artworkCache.clear();
    }
}